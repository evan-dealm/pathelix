import { cachedDist } from './distanceCache'
import type { OsrmMatrix } from './osrmMatrix'
import { createLogger } from '@/lib/logger'

const log = createLogger('vrp/externalRoutingApi')

const ROUTING_API_TYPE    = (process.env.ROUTING_API_TYPE    || '').toLowerCase()
const ROUTING_API_KEY     = process.env.ROUTING_API_KEY      || ''
const ROUTING_API_URL     = process.env.ROUTING_API_URL      || ''
const ROUTING_VEHICLE     = (process.env.ROUTING_VEHICLE     || 'truck').toLowerCase()
const ROUTING_TIMEOUT_MS  = parseInt(process.env.ROUTING_API_TIMEOUT_MS || '5000', 10)

const MAX_MATRIX_CHUNK = parseInt(process.env.ROUTING_API_MAX_CHUNK || '50', 10)

interface GeoPoint {
  id:  string
  lat: number
  lng: number
}

/**
 * Matrix from a commercial truck-routing API: the organisation's own licence when given
 * (`provider`), else the server-wide ROUTING_API_* setting; null when none is configured.
 */
export async function buildExternalRoutingMatrix(
  points:    GeoPoint[],
  timeoutMs: number = ROUTING_TIMEOUT_MS,
  provider?: { type: string; apiKey: string } | null,
): Promise<OsrmMatrix | null> {
  const type = provider?.type ?? ROUTING_API_TYPE
  const key = provider?.apiKey ?? ROUTING_API_KEY
  if (!type || !key) return null
  if (points.length < 2) return null

  try {
    switch (type) {
      case 'trimble': return await buildTrimbleMatrix(points, key, timeoutMs)
      case 'here':    return await buildHereMatrix(points, key, timeoutMs)
      case 'generic': return await buildGenericMatrix(points, key, ROUTING_API_URL, timeoutMs)
      default:
        log.warn('Type de routage inconnu', { type, accepted: 'trimble, here, generic' })
        return null
    }
  } catch (err) {
    log.warn('Échec API externe — fallback OSRM/haversine', { err: (err as Error).message })
    return null
  }
}

function buildDenseMatrix(
  points: GeoPoint[],
  distances: number[][],
  durations: number[][],
  source: OsrmMatrix['source'],
): OsrmMatrix {
  const n = points.length
  const idIndex = new Map<string, number>()
  for (let i = 0; i < n; i++) idIndex.set(points[i].id, i)

  return {
    distance(i: number, j: number): number {
      if (i === j) return 0
      const d = distances[i]?.[j]
      return (d !== undefined && d >= 0)
        ? Math.round(d * 100) / 100
        : cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
    },
    duration(i: number, j: number): number {
      if (i === j) return 0
      const d = durations[i]?.[j]
      return (d !== undefined && d >= 0) ? Math.round(d * 10) / 10 : 0
    },
    size: n,
    indexOf(id: string): number { return idIndex.get(id) ?? -1 },
    source,
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

const TRIMBLE_BASE = 'https://pcmiler.alk.com/apis/rest/v1.0'

async function buildTrimbleMatrix(
  points: GeoPoint[],
  apiKey: string,
  timeoutMs: number,
): Promise<OsrmMatrix | null> {
  const base = ROUTING_API_URL || TRIMBLE_BASE
  const n    = points.length

  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(-1))
  const dur  = Array.from({ length: n }, () => new Array<number>(n).fill(-1))

  const originChunks      = chunkArray(points.map((_, i) => i), MAX_MATRIX_CHUNK)
  const destinationChunks = chunkArray(points.map((_, i) => i), MAX_MATRIX_CHUNK)

  for (const origIdxs of originChunks) {
    for (const destIdxs of destinationChunks) {
      const origins = origIdxs.map(i => ({
        Coords: { Lat: points[i].lat.toString(), Lon: points[i].lng.toString() },
      }))
      const destinations = destIdxs.map(i => ({
        Coords: { Lat: points[i].lat.toString(), Lon: points[i].lng.toString() },
      }))

      const body = {
        Origins:      origins,
        Destinations: destinations,
        RouteOptions: {
          VehicleType: ROUTING_VEHICLE === 'car' ? 'Automobile' : 'Truck',
          DistanceUnits: 'Kilometers',
        },
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch(`${base}/Service.svc/route/routeMatrix`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': apiKey,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) throw new Error(`Trimble API ${res.status}: ${await res.text()}`)

      const data = await res.json() as {
        RouteMatrixResults?: Array<{
          Errors?:   unknown[]
          Distances: Array<{ Distance?: number; Time?: number }>
        }>
      }

      const results = data.RouteMatrixResults ?? []
      for (let ri = 0; ri < results.length; ri++) {
        const oi = origIdxs[ri]
        if (oi === undefined) continue
        const row = results[ri].Distances ?? []
        for (let ci = 0; ci < row.length; ci++) {
          const di = destIdxs[ci]
          if (di === undefined) continue
          dist[oi][di] = row[ci].Distance ?? -1
          dur[oi][di]  = row[ci].Time     ?? -1
        }
      }
    }
  }

  return buildDenseMatrix(points, dist, dur, 'api')
}

const HERE_MATRIX_URL = 'https://matrix.router.hereapi.com/v8/matrix'

async function buildHereMatrix(
  points: GeoPoint[],
  apiKey: string,
  timeoutMs: number,
): Promise<OsrmMatrix | null> {
  const url  = ROUTING_API_URL || HERE_MATRIX_URL
  const n    = points.length
  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(-1))
  const dur  = Array.from({ length: n }, () => new Array<number>(n).fill(-1))

  const originChunks = chunkArray(points.map((_, i) => i), MAX_MATRIX_CHUNK)
  const destChunks   = chunkArray(points.map((_, i) => i), MAX_MATRIX_CHUNK)

  for (const origIdxs of originChunks) {
    for (const destIdxs of destChunks) {
      const origins      = origIdxs.map(i => ({ lat: points[i].lat, lng: points[i].lng }))
      const destinations = destIdxs.map(i => ({ lat: points[i].lat, lng: points[i].lng }))

      const transportMode = ROUTING_VEHICLE === 'car' ? 'car' : 'truck'

      const body = {
        origins,
        destinations,
        regionDefinition: { type: 'world' },
        matrixAttributes: ['travelTimes', 'distances'],
        routingMode: 'fast',
        transportMode,
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch(`${url}?apiKey=${encodeURIComponent(apiKey)}&async=false`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) throw new Error(`HERE API ${res.status}: ${await res.text()}`)

      const data = await res.json() as {
        matrix?: {
          travelTimes?: number[]
          distances?:   number[]
          numOrigins?:  number
          numDestinations?: number
        }
      }

      const mat  = data.matrix
      const nOri = origIdxs.length
      const nDst = destIdxs.length

      if (mat?.travelTimes && mat?.distances) {
        for (let r = 0; r < nOri; r++) {
          for (let c = 0; c < nDst; c++) {
            const idx = r * nDst + c
            const oi  = origIdxs[r]
            const di  = destIdxs[c]
            dur[oi][di]  = (mat.travelTimes[idx] ?? -1) / 60
            dist[oi][di] = (mat.distances[idx]   ?? -1) / 1000
          }
        }
      }
    }
  }

  return buildDenseMatrix(points, dist, dur, 'api')
}

async function buildGenericMatrix(
  points: GeoPoint[],
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<OsrmMatrix | null> {
  if (!baseUrl) {
    log.warn('ROUTING_API_TYPE=generic requiert ROUTING_API_URL')
    return null
  }

  const n    = points.length
  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(-1))
  const dur  = Array.from({ length: n }, () => new Array<number>(n).fill(-1))

  const chunks = chunkArray(points.map((_, i) => i), MAX_MATRIX_CHUNK)

  for (const chunkIdxs of chunks) {
    const coords = chunkIdxs.map(i => `${points[i].lng},${points[i].lat}`).join(';')
    const url    = `${baseUrl}/table/v1/driving/${coords}?annotations=distance,duration`

    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = apiKey

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) throw new Error(`Generic routing API ${res.status}`)

    const data = await res.json() as {
      code?: string
      distances?: number[][]
      durations?: number[][]
    }

    if (data.code !== 'Ok' || !data.distances || !data.durations) {
      throw new Error('Generic routing API : réponse invalide')
    }

    const cSize = chunkIdxs.length
    for (let r = 0; r < cSize; r++) {
      for (let c = 0; c < cSize; c++) {
        const oi = chunkIdxs[r]
        const di = chunkIdxs[c]
        const dv = data.distances[r]?.[c]
        const tv = data.durations[r]?.[c]
        dist[oi][di] = (dv !== null && dv !== undefined && dv < 1e8) ? dv / 1000 : -1
        dur[oi][di]  = (tv !== null && tv !== undefined && tv < 1e8) ? tv / 60   : -1
      }
    }
  }

  return buildDenseMatrix(points, dist, dur, 'api')
}
