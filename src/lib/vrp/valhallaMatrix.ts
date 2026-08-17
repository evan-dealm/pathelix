import type { VehicleDimensions } from '@/lib/types'
import { createLogger } from '@/lib/logger'
import { cachedDist } from './distanceCache'
import { trafficFactor } from '@/lib/algorithm'

const log = createLogger('valhallaMatrix')

// Valhalla's costmatrix action rejects a request whose sources x targets product exceeds its
// configured max_matrix_locations (2500 by default, unconfigured in this app's docker-compose
// service). A square chunk of N sources x N targets must satisfy N*N <= 2500, i.e. N <= 50.
// This was 80 (6400 pairs/chunk) — every chunk on every real request exceeded the limit and
// 400'd, so any VRP run with more than 80 combined points (any realistic multi-driver fleet)
// silently fell all the way back to haversine-only distances, defeating the real-road-network
// routing entirely. 45 leaves margin below the exact 50 boundary.
const MAX_CHUNK_SIZE       = 45
const MAX_CONCURRENT       = 4
const REDIS_CACHE_TTL_S    = 86400

function getValhallaUrl(): string {
  return process.env.VALHALLA_URL || process.env.VALHALLA_FALLBACK_URL || ''
}
function getValhallaTimeout(): number {
  return parseInt(process.env.VALHALLA_TIMEOUT_MS || '15000', 10)
}

export interface GeoPoint {
  id:  string
  lat: number
  lng: number
}

export interface ValhallaMatrix {
  source: 'valhalla' | 'valhalla-chunked' | 'haversine'

  size: number

  indexOf: (_pointId: string) => number

  distance: (_fromIdx: number, _toIdx: number) => number

  duration: (_fromIdx: number, _toIdx: number) => number
}

const DEFAULT_DIMENSIONS: VehicleDimensions = {
  weightTon: 26,
  heightM:   4.0,
  widthM:    2.55,
  lengthM:   12.0,
  axleCount: 3,
  hazmat:    false,
}

function buildCostingOptions(dims: VehicleDimensions) {
  return {
    truck: {
      weight:    dims.weightTon,
      height:    dims.heightM,
      width:     dims.widthM,
      length:    dims.lengthM,
      axle_count: dims.axleCount,
      hazmat:    dims.hazmat,
      use_highways: 0.8,
      use_tolls:    0.5,
    },
  }
}

export async function buildValhallaMatrix(
  points: GeoPoint[],
  dims?: VehicleDimensions,
): Promise<ValhallaMatrix> {
  if (!getValhallaUrl() || points.length < 2) {
    return buildHaversineMatrix(points)
  }

  const dimensions = dims ?? DEFAULT_DIMENSIONS

  try {

    const cached = await tryLoadFromCache(points, dimensions)
    if (cached) {
      log.info('Valhalla matrix loaded from cache', { points: points.length })
      return cached
    }

    let matrix: ValhallaMatrix
    if (points.length <= MAX_CHUNK_SIZE) {
      matrix = await fetchDirect(points, dimensions)
    } else {
      matrix = await fetchChunked(points, dimensions)
    }

    void cacheMatrix(points, dimensions, matrix)

    return matrix
  } catch (err) {
    log.warn('Valhalla matrix failed, falling back to haversine', {
      err: err instanceof Error ? err.message : String(err),
      points: points.length,
    })
    return buildHaversineMatrix(points)
  }
}

async function fetchDirect(points: GeoPoint[], dims: VehicleDimensions): Promise<ValhallaMatrix> {
  const locations = points.map(p => ({ lat: p.lat, lon: p.lng }))

  const body = {
    costing: 'truck',
    costing_options: buildCostingOptions(dims),
    sources: locations.map((_, i) => ({ lat: locations[i].lat, lon: locations[i].lon })),
    targets: locations.map((_, i) => ({ lat: locations[i].lat, lon: locations[i].lon })),
    date_time: { type: 0, value: 'current' },
  }

  const res = await fetch(`${getValhallaUrl()}/sources_to_targets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(getValhallaTimeout()),
  })

  if (!res.ok) {
    throw new Error(`Valhalla HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }

  const data = await res.json() as {
    sources_to_targets: Array<Array<{ distance: number; time: number }>>
  }

  return parseValhallaResponse(points, data)
}

async function fetchChunked(points: GeoPoint[], dims: VehicleDimensions): Promise<ValhallaMatrix> {
  const n = points.length
  const distMatrix = new Float32Array(n * n)
  const durMatrix  = new Float32Array(n * n)

  const idxMap = new Map<string, number>()
  for (let i = 0; i < n; i++) idxMap.set(points[i].id, i)

  const chunks: Array<{ srcStart: number; srcEnd: number; tgtStart: number; tgtEnd: number }> = []
  for (let si = 0; si < n; si += MAX_CHUNK_SIZE) {
    for (let ti = 0; ti < n; ti += MAX_CHUNK_SIZE) {
      chunks.push({
        srcStart: si,
        srcEnd: Math.min(si + MAX_CHUNK_SIZE, n),
        tgtStart: ti,
        tgtEnd: Math.min(ti + MAX_CHUNK_SIZE, n),
      })
    }
  }

  const locations = points.map(p => ({ lat: p.lat, lon: p.lng }))
  let chunkIdx = 0

  async function processNext(): Promise<void> {
    while (chunkIdx < chunks.length) {
      const chunk = chunks[chunkIdx++]

      const sources = locations.slice(chunk.srcStart, chunk.srcEnd)
      const targets = locations.slice(chunk.tgtStart, chunk.tgtEnd)

      const body = {
        costing: 'truck',
        costing_options: buildCostingOptions(dims),
        sources,
        targets,
        date_time: { type: 0, value: 'current' },
      }

      try {
        const res = await fetch(`${getValhallaUrl()}/sources_to_targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(getValhallaTimeout()),
        })

        if (!res.ok) {
          log.warn('Valhalla chunk failed', { status: res.status })

          fillHaversineChunk(points, distMatrix, durMatrix, chunk)
          continue
        }

        const data = await res.json() as {
          sources_to_targets: Array<Array<{ distance: number; time: number }>>
        }

        for (let si = 0; si < sources.length; si++) {
          for (let ti = 0; ti < targets.length; ti++) {
            const cell = data.sources_to_targets[si]?.[ti]
            const gi = chunk.srcStart + si
            const gj = chunk.tgtStart + ti
            if (cell && cell.distance < 1e8) {
              distMatrix[gi * n + gj] = cell.distance
              durMatrix[gi * n + gj]  = cell.time / 60
            } else {

              distMatrix[gi * n + gj] = cachedDist(points[gi].lat, points[gi].lng, points[gj].lat, points[gj].lng)
              durMatrix[gi * n + gj]  = distMatrix[gi * n + gj] / 50 * 60
            }
          }
        }
      } catch {
        fillHaversineChunk(points, distMatrix, durMatrix, chunk)
      }
    }
  }

  const workers = Array.from({ length: MAX_CONCURRENT }, () => processNext())
  await Promise.all(workers)

  log.info('Valhalla chunked matrix built', { points: n, chunks: chunks.length })

  return {
    source: 'valhalla-chunked', size: n,
    indexOf: (id: string) => idxMap.get(id) ?? -1,
    distance: (from: number, to: number) => distMatrix[from * n + to] || 0,
    duration: (from: number, to: number) => durMatrix[from * n + to] || 0,
  }
}

function fillHaversineChunk(
  points: GeoPoint[],
  distMatrix: Float32Array,
  durMatrix: Float32Array,
  chunk: { srcStart: number; srcEnd: number; tgtStart: number; tgtEnd: number },
): void {
  const n = points.length
  for (let si = chunk.srcStart; si < chunk.srcEnd; si++) {
    for (let ti = chunk.tgtStart; ti < chunk.tgtEnd; ti++) {
      const d = cachedDist(points[si].lat, points[si].lng, points[ti].lat, points[ti].lng)
      distMatrix[si * n + ti] = d
      durMatrix[si * n + ti]  = d / 50 * 60
    }
  }
}

function parseValhallaResponse(
  points: GeoPoint[],
  data: { sources_to_targets: Array<Array<{ distance: number; time: number }>> },
): ValhallaMatrix {
  const n = points.length
  const distMatrix = new Float32Array(n * n)
  const durMatrix  = new Float32Array(n * n)
  const idxMap = new Map<string, number>()
  for (let i = 0; i < n; i++) idxMap.set(points[i].id, i)

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = data.sources_to_targets[i]?.[j]
      if (cell && cell.distance < 1e8) {
        distMatrix[i * n + j] = cell.distance
        durMatrix[i * n + j]  = cell.time / 60
      } else {

        const d = cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
        distMatrix[i * n + j] = d
        durMatrix[i * n + j]  = d / 50 * 60
      }
    }
  }

  return {
    source: 'valhalla', size: n,
    indexOf: (id: string) => idxMap.get(id) ?? -1,
    distance: (from: number, to: number) => distMatrix[from * n + to] || 0,
    duration: (from: number, to: number) => durMatrix[from * n + to] || 0,
  }
}

function buildHaversineMatrix(points: GeoPoint[]): ValhallaMatrix {
  const idxMap = new Map<string, number>()
  for (let i = 0; i < points.length; i++) idxMap.set(points[i].id, i)

  return {
    source: 'haversine', size: points.length,
    indexOf: (id: string) => idxMap.get(id) ?? -1,
    distance: (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= points.length || to >= points.length) return 0
      return cachedDist(points[from].lat, points[from].lng, points[to].lat, points[to].lng)
    },
    duration: (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= points.length || to >= points.length) return 0
      const d = cachedDist(points[from].lat, points[from].lng, points[to].lat, points[to].lng)
      const baseMin = d / 50 * 60
      return baseMin * trafficFactor(420)
    },
  }
}

function matrixCacheKey(points: GeoPoint[], dims: VehicleDimensions): string {

  const sorted = points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).sort()
  const input = `${sorted.join('|')}:${dims.weightTon}:${dims.heightM}:${dims.widthM}:${dims.lengthM}`
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `valhalla:matrix:${(h >>> 0).toString(36)}`
}

async function tryLoadFromCache(points: GeoPoint[], dims: VehicleDimensions): Promise<ValhallaMatrix | null> {
  try {
    const { getRedisClient, REDIS_AVAILABLE } = await import('@/lib/redisClient')
    if (!REDIS_AVAILABLE) return null
    const client = await getRedisClient()
    if (!client) return null

    const key = matrixCacheKey(points, dims)
    const raw = await client.get(key)
    if (!raw) return null

    const { dist, dur } = JSON.parse(raw) as { dist: number[]; dur: number[] }
    const n = points.length
    const distMatrix = new Float32Array(dist)
    const durMatrix  = new Float32Array(dur)
    const idxMap = new Map<string, number>()
    for (let i = 0; i < n; i++) idxMap.set(points[i].id, i)

    return {
      source: 'valhalla', size: n,
      indexOf: (id: string) => idxMap.get(id) ?? -1,
      distance: (from: number, to: number) => distMatrix[from * n + to] || 0,
      duration: (from: number, to: number) => durMatrix[from * n + to] || 0,
    }
  } catch {

    return null
  }
}

async function cacheMatrix(points: GeoPoint[], dims: VehicleDimensions, matrix: ValhallaMatrix): Promise<void> {
  try {
    const { getRedisClient, REDIS_AVAILABLE } = await import('@/lib/redisClient')
    if (!REDIS_AVAILABLE) return
    const client = await getRedisClient()
    if (!client) return

    const n = points.length
    const dist: number[] = []
    const dur: number[] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        dist.push(matrix.distance(i, j))
        dur.push(matrix.duration(i, j))
      }
    }

    const key = matrixCacheKey(points, dims)
    await client.set(key, JSON.stringify({ dist, dur }), 'EX', REDIS_CACHE_TTL_S)
  } catch {

  }
}
