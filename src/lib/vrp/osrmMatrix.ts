import { cachedDist } from './distanceCache'
import { getRedisClient } from '@/lib/redisClient'

const OSRM_BASE = process.env.OSRM_URL || ''

const OSRM_MAX_TABLE_SIZE = parseInt(process.env.OSRM_MAX_TABLE_SIZE || '100', 10)
const OSRM_TIMEOUT_MS = parseInt(process.env.OSRM_TIMEOUT_MS || '3000', 10)

const OSRM_CHUNK_SIZE = Math.max(10, OSRM_MAX_TABLE_SIZE - 5)

interface GeoPoint {
  id: string
  lat: number
  lng: number
}

export interface OsrmMatrix {

  distance(_i: number, _j: number): number

  duration(_i: number, _j: number): number

  size: number

  indexOf(_id: string): number

  source: 'api' | 'osrm' | 'osrm-chunked' | 'valhalla' | 'valhalla-chunked' | 'haversine'
}

export async function buildOsrmMatrix(
  points: GeoPoint[],
  timeoutMs: number = OSRM_TIMEOUT_MS,
): Promise<OsrmMatrix> {
  const n = points.length
  const idIndex = new Map<string, number>()
  for (let i = 0; i < n; i++) idIndex.set(points[i].id, i)

  if (!OSRM_BASE || n < 2) {
    return buildHaversineMatrix(points, idIndex)
  }

  if (n <= OSRM_MAX_TABLE_SIZE) {
    return fetchOsrmDirect(points, idIndex, timeoutMs)
  }

  return fetchOsrmChunked(points, idIndex, timeoutMs)
}

const OSRM_CACHE_TTL_S = 86400

function chunkCacheKey(points: GeoPoint[]): string {

  let h = 2166136261
  for (const p of points) {
    const lat = Math.round(p.lat * 1e4)
    const lng = Math.round(p.lng * 1e4)
    h ^= lat; h = Math.imul(h, 16777619)
    h ^= lng; h = Math.imul(h, 16777619)
  }
  return `osrm:chunk:${(h >>> 0).toString(36)}:${points.length}`
}

interface CachedChunkData {
  distances: number[][]
  durations: number[][]
}

async function getOsrmCacheEntry(key: string): Promise<CachedChunkData | null> {
  try {
    const redis = await getRedisClient()
    if (!redis) return null
    const raw = await redis.get(key)
    if (!raw) return null
    return JSON.parse(raw) as CachedChunkData
  } catch {

    return null
  }
}

async function setOsrmCacheEntry(key: string, data: CachedChunkData): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) return
    await redis.set(key, JSON.stringify(data), 'EX', OSRM_CACHE_TTL_S)
  } catch {

  }
}

async function fetchOsrmDirect(
  points: GeoPoint[],
  idIndex: Map<string, number>,
  timeoutMs: number,
): Promise<OsrmMatrix> {
  const n = points.length

  try {

    const cacheKey = chunkCacheKey(points)
    const cached = await getOsrmCacheEntry(cacheKey)

    let distances: number[][]
    let durations: number[][]

    if (cached) {
      distances = cached.distances
      durations = cached.durations
    } else {
      const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
      const url = `${OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Pathelix/1.0' },
      })
      clearTimeout(timeout)

      if (!res.ok) throw new Error(`OSRM ${res.status}`)

      const data = await res.json()
      if (data.code !== 'Ok' || !data.distances || !data.durations) {
        throw new Error('OSRM response invalid')
      }

      distances = data.distances as number[][]
      durations = data.durations as number[][]

      void setOsrmCacheEntry(cacheKey, { distances, durations })
    }

    return {
      distance(i: number, j: number): number {
        if (i === j) return 0
        const d = distances[i]?.[j]
        return d !== null && d !== undefined && d < 1e8
          ? Math.round((d / 1000) * 100) / 100
          : cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
      },
      duration(i: number, j: number): number {
        if (i === j) return 0
        const d = durations[i]?.[j]
        return d !== null && d !== undefined && d < 1e8
          ? Math.round((d / 60) * 10) / 10
          : 0
      },
      size: n,
      indexOf(id: string): number {
        return idIndex.get(id) ?? -1
      },
      source: 'osrm',
    }
  } catch {
    return buildHaversineMatrix(points, idIndex)
  }
}

async function fetchOsrmChunked(
  points: GeoPoint[],
  idIndex: Map<string, number>,
  timeoutMs: number,
): Promise<OsrmMatrix> {
  const n = points.length
  const K = Math.ceil(n / OSRM_CHUNK_SIZE)

  const assignments = kmeansCluster(points, K)

  const chunks: Array<{ indices: number[]; points: GeoPoint[] }> = []
  for (let k = 0; k < K; k++) {
    const indices: number[] = []
    const chunkPoints: GeoPoint[] = []
    for (let i = 0; i < n; i++) {
      if (assignments[i] === k) {
        indices.push(i)
        chunkPoints.push(points[i])
      }
    }
    if (chunkPoints.length > 0) {
      chunks.push({ indices, points: chunkPoints })
    }
  }

  const chunkDist: Array<Float64Array | null> = new Array(chunks.length).fill(null)
  const chunkDur: Array<Float64Array | null> = new Array(chunks.length).fill(null)

  const globalToLocal = new Array<{ chunkIdx: number; localIdx: number }>(n)
  for (let ci = 0; ci < chunks.length; ci++) {
    for (let li = 0; li < chunks[ci].indices.length; li++) {
      globalToLocal[chunks[ci].indices[li]] = { chunkIdx: ci, localIdx: li }
    }
  }

  const MAX_CONCURRENT_REQUESTS = 4
  let osrmHits = 0
  let _osrmMisses = 0

  async function fetchChunk(ci: number): Promise<void> {
    const chunk = chunks[ci]
    const cSize = chunk.points.length

    if (cSize < 2) {
      chunkDist[ci] = new Float64Array(1)
      chunkDur[ci] = new Float64Array(1)
      return
    }

    if (cSize > OSRM_MAX_TABLE_SIZE) {
      _osrmMisses++
      return
    }

    try {

      const chunkKey = chunkCacheKey(chunk.points)
      const cachedChunk = await getOsrmCacheEntry(chunkKey)

      let rawDistances: number[][]
      let rawDurations: number[][]

      if (cachedChunk) {
        rawDistances = cachedChunk.distances
        rawDurations = cachedChunk.durations
      } else {
        const coords = chunk.points.map(p => `${p.lng},${p.lat}`).join(';')
        const url = `${OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Pathelix/1.0' },
        })
        clearTimeout(timeout)

        if (!res.ok) throw new Error(`OSRM ${res.status}`)

        const data = await res.json()
        if (data.code !== 'Ok' || !data.distances || !data.durations) {
          throw new Error('OSRM response invalid')
        }

        rawDistances = data.distances as number[][]
        rawDurations = data.durations as number[][]

        void setOsrmCacheEntry(chunkKey, { distances: rawDistances, durations: rawDurations })
      }

      const dist = new Float64Array(cSize * cSize)
      const dur = new Float64Array(cSize * cSize)

      for (let i = 0; i < cSize; i++) {
        for (let j = 0; j < cSize; j++) {
          const dVal = rawDistances[i]?.[j]
          dist[i * cSize + j] = dVal !== null && dVal !== undefined && dVal < 1e8
            ? dVal / 1000
            : -1
          const tVal = rawDurations[i]?.[j]
          dur[i * cSize + j] = tVal !== null && tVal !== undefined && tVal < 1e8
            ? tVal / 60
            : -1
        }
      }

      chunkDist[ci] = dist
      chunkDur[ci] = dur
      osrmHits++
    } catch {
      _osrmMisses++

    }
  }

  for (let start = 0; start < chunks.length; start += MAX_CONCURRENT_REQUESTS) {
    const batch = []
    for (let i = start; i < Math.min(start + MAX_CONCURRENT_REQUESTS, chunks.length); i++) {
      batch.push(fetchChunk(i))
    }
    await Promise.allSettled(batch)
  }

  const bridgeDist = new Map<string, number>()
  const bridgeDur  = new Map<string, number>()

  if (OSRM_BASE && chunks.length > 1 && chunks.length <= 20) {

    const bridgePairs: Array<{ gi: number; gj: number; pi: GeoPoint; pj: GeoPoint }> = []
    for (let ci = 0; ci < chunks.length; ci++) {
      for (let cj = ci + 1; cj < chunks.length; cj++) {

        let bestDist = Infinity
        let bestPi = chunks[ci].points[0]
        let bestPj = chunks[cj].points[0]
        let bestGi = chunks[ci].indices[0]
        let bestGj = chunks[cj].indices[0]
        for (let a = 0; a < chunks[ci].points.length; a++) {
          for (let b = 0; b < chunks[cj].points.length; b++) {
            const dlat = chunks[ci].points[a].lat - chunks[cj].points[b].lat
            const dlng = chunks[ci].points[a].lng - chunks[cj].points[b].lng
            const d = dlat * dlat + dlng * dlng
            if (d < bestDist) {
              bestDist = d
              bestPi = chunks[ci].points[a]
              bestPj = chunks[cj].points[b]
              bestGi = chunks[ci].indices[a]
              bestGj = chunks[cj].indices[b]
            }
          }
        }
        bridgePairs.push({ gi: bestGi, gj: bestGj, pi: bestPi, pj: bestPj })
      }
    }

    const BRIDGE_BATCH = 10
    for (let start = 0; start < bridgePairs.length; start += BRIDGE_BATCH) {
      const batch = bridgePairs.slice(start, start + BRIDGE_BATCH)
      await Promise.allSettled(batch.map(async ({ gi, gj, pi, pj }) => {
        try {
          const coords = `${pi.lng},${pi.lat};${pj.lng},${pj.lat}`
          const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=false`
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), timeoutMs)
          const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Pathelix/1.0' } })
          clearTimeout(timeout)
          if (!res.ok) return
          const data = await res.json()
          if (data.code !== 'Ok' || !data.routes?.[0]) return
          const route = data.routes[0]
          const distKm = route.distance / 1000
          const durMin = route.duration / 60

          bridgeDist.set(`${gi},${gj}`, distKm)
          bridgeDist.set(`${gj},${gi}`, distKm)
          bridgeDur.set(`${gi},${gj}`, durMin)
          bridgeDur.set(`${gj},${gi}`, durMin)
        } catch {

        }
      }))
    }
  }

  return {
    distance(i: number, j: number): number {
      if (i === j) return 0
      const li = globalToLocal[i]
      const lj = globalToLocal[j]

      if (li.chunkIdx === lj.chunkIdx) {
        const mat = chunkDist[li.chunkIdx]
        if (mat) {
          const cSize = chunks[li.chunkIdx].points.length
          const val = mat[li.localIdx * cSize + lj.localIdx]
          if (val >= 0) return Math.round(val * 100) / 100
        }
      }

      if (li.chunkIdx !== lj.chunkIdx) {
        const bridgeKey = `${i},${j}`
        const bDist = bridgeDist.get(bridgeKey)
        if (bDist !== undefined) return Math.round(bDist * 100) / 100

      }

      return cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
    },

    duration(i: number, j: number): number {
      if (i === j) return 0
      const li = globalToLocal[i]
      const lj = globalToLocal[j]

      if (li.chunkIdx === lj.chunkIdx) {
        const mat = chunkDur[li.chunkIdx]
        if (mat) {
          const cSize = chunks[li.chunkIdx].points.length
          const val = mat[li.localIdx * cSize + lj.localIdx]
          if (val >= 0) return Math.round(val * 10) / 10
        }
      }

      if (li.chunkIdx !== lj.chunkIdx) {
        const bridgeKey = `${i},${j}`
        const bDur = bridgeDur.get(bridgeKey)
        if (bDur !== undefined) return Math.round(bDur * 10) / 10
      }

      const dist = cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
      return Math.round((dist / 50) * 60 * 10) / 10
    },

    size: n,
    indexOf(id: string): number {
      return idIndex.get(id) ?? -1
    },
    source: osrmHits > 0 ? 'osrm-chunked' : 'haversine',
  }
}

function kmeansCluster(points: GeoPoint[], K: number): Int32Array {
  const n = points.length
  if (K >= n) {
    const assignments = new Int32Array(n)
    for (let i = 0; i < n; i++) assignments[i] = i
    return assignments
  }

  const centroids: Array<[number, number]> = [[points[0].lat, points[0].lng]]
  const distToClosest = new Float64Array(n).fill(Infinity)

  for (let c = 1; c < K; c++) {
    for (let i = 0; i < n; i++) {
      const dlat = points[i].lat - centroids[c - 1][0]
      const dlng = points[i].lng - centroids[c - 1][1]
      const d = dlat * dlat + dlng * dlng
      if (d < distToClosest[i]) distToClosest[i] = d
    }
    let maxDist = -1, maxIdx = 0
    for (let i = 0; i < n; i++) {
      if (distToClosest[i] > maxDist) { maxDist = distToClosest[i]; maxIdx = i }
    }
    centroids.push([points[maxIdx].lat, points[maxIdx].lng])
  }

  const assignments = new Int32Array(n)
  let prevIntraDist: number | undefined
  for (let iter = 0; iter < 20; iter++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      let bestK = 0, bestD = Infinity
      for (let k = 0; k < K; k++) {
        const dlat = points[i].lat - centroids[k][0]
        const dlng = points[i].lng - centroids[k][1]
        const d = dlat * dlat + dlng * dlng
        if (d < bestD) { bestD = d; bestK = k }
      }
      if (assignments[i] !== bestK) { assignments[i] = bestK; changed = true }
    }
    if (!changed) break

    let totalIntraDist = 0
    for (let i = 0; i < n; i++) {
      const c = centroids[assignments[i]]
      const dlat = points[i].lat - c[0]
      const dlng = points[i].lng - c[1]
      totalIntraDist += dlat * dlat + dlng * dlng
    }
    if (iter > 0 && totalIntraDist >= (prevIntraDist ?? Infinity) * 0.999) break
    prevIntraDist = totalIntraDist

    const sums = Array.from({ length: K }, () => [0, 0, 0] as [number, number, number])
    for (let i = 0; i < n; i++) {
      sums[assignments[i]][0] += points[i].lat
      sums[assignments[i]][1] += points[i].lng
      sums[assignments[i]][2]++
    }
    for (let k = 0; k < K; k++) {
      if (sums[k][2] > 0) {
        centroids[k][0] = sums[k][0] / sums[k][2]
        centroids[k][1] = sums[k][1] / sums[k][2]
      }
    }
  }

  return assignments
}

function buildHaversineMatrix(
  points: GeoPoint[],
  idIndex: Map<string, number>,
): OsrmMatrix {
  const n = points.length
  return {
    distance(i: number, j: number): number {
      if (i === j) return 0
      return cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
    },
    duration(i: number, j: number): number {
      if (i === j) return 0
      const dist = cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
      return Math.round((dist / 50) * 60 * 10) / 10
    },
    size: n,
    indexOf(id: string): number {
      return idIndex.get(id) ?? -1
    },
    source: 'haversine',
  }
}

/** Plain-data form of an {@link OsrmMatrix} — structured-cloneable, so it can cross a worker_threads boundary. */
export interface SerializedMatrix {
  ids:    string[]
  dist:   Float64Array
  dur:    Float64Array
  source: OsrmMatrix['source']
}

/**
 * Copies the rows/columns of `ids` (those present in the matrix) into a dense plain-data matrix.
 * A sector only needs its own missions, depots and the exutoires, so the copy stays small.
 */
export function serializeSubMatrix(matrix: OsrmMatrix, ids: string[]): SerializedMatrix {
  const kept: string[] = []
  const src: number[] = []
  for (const id of ids) {
    const i = matrix.indexOf(id)
    if (i >= 0) { kept.push(id); src.push(i) }
  }
  const n = kept.length
  const dist = new Float64Array(n * n)
  const dur  = new Float64Array(n * n)
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue
      dist[a * n + b] = matrix.distance(src[a], src[b])
      dur[a * n + b]  = matrix.duration(src[a], src[b])
    }
  }
  return { ids: kept, dist, dur, source: matrix.source }
}

/** Rebuilds a usable {@link OsrmMatrix} from {@link serializeSubMatrix} output. */
export function deserializeMatrix(s: SerializedMatrix): OsrmMatrix {
  const n = s.ids.length
  const idIndex = new Map<string, number>()
  for (let i = 0; i < n; i++) idIndex.set(s.ids[i], i)
  return {
    distance: (i, j) => s.dist[i * n + j],
    duration: (i, j) => s.dur[i * n + j],
    size:     n,
    indexOf:  id => idIndex.get(id) ?? -1,
    source:   s.source,
  }
}
