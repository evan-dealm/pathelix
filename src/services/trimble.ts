import { haversineKm, roadDistKm } from '@/lib/algorithm'
import { fetchProtected } from '@/lib/httpClient'
import { CircuitOpenError } from '@/lib/circuitBreaker'
import { createLogger } from '@/lib/logger'

const log = createLogger('trimble')

export interface LatLng {
  lat: number
  lng: number
}

export interface RouteResult {
  distanceKm:  number
  durationMin: number
}

export interface TrimbleRouteRequest {
  origin:      LatLng
  destination: LatLng
  waypoints?:  LatLng[]
}

export interface TrimbleRouteResult {
  distanceKm:  number
  durationMin: number
  polyline?:   [number, number][]
}

export const TRIMBLE_API_URL = process.env.TRIMBLE_API_URL ?? ''
export const TRIMBLE_API_KEY = process.env.TRIMBLE_API_KEY ?? ''
export const IS_TRIMBLE_AVAILABLE = Boolean(TRIMBLE_API_URL && TRIMBLE_API_KEY)

export function haversineFallbackKm(a: LatLng, b: LatLng): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng)
}

function estimateDuration(distKm: number, speedKmh = 50): number {
  return (distKm * 1.3 * 60) / speedKmh
}

const TRIMBLE_BREAKER = 'trimble-maps'
const TRIMBLE_BREAKER_OPTS = {
  failureThreshold:  5,
  recoveryTimeMs:    30_000,
  halfOpenSuccesses: 2,
}

const TRIMBLE_RETRY_OPTS = {
  maxRetries:  2,
  baseDelayMs: 300,
  maxDelayMs:  3_000,
  timeoutMs:   5_000,
}

export async function calcTrimbleRoute(
  req: TrimbleRouteRequest,
): Promise<RouteResult | null> {
  if (!TRIMBLE_API_URL || !TRIMBLE_API_KEY) return null

  try {
    const stops      = [req.origin, ...(req.waypoints ?? []), req.destination]
    const stopsParam = stops.map(s => `${s.lng},${s.lat}`).join(';')
    const url        = `${TRIMBLE_API_URL}/route?stops=${stopsParam}&vehicleType=Truck`

    const resp = await fetchProtected(
      url,
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TRIMBLE_API_KEY}` } },
      TRIMBLE_RETRY_OPTS,
      TRIMBLE_BREAKER,
      TRIMBLE_BREAKER_OPTS,
    )

    if (!resp.ok) {
      log.warn('Trimble réponse non-OK', { status: resp.status })
      return null
    }

    const data = await resp.json() as {
      report?: { totalDistance?: number; totalTime?: number }
    }
    const report = data.report
    if (!report) return null

    return {
      distanceKm:  (report.totalDistance ?? 0) / 1000,
      durationMin: (report.totalTime ?? 0) / 60,
    }
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      log.warn('Trimble circuit OPEN — fallback haversine')
    } else {
      log.error('Trimble erreur inattendue', { err: err instanceof Error ? err.message : String(err) })
    }
    return null
  }
}

export async function calcRoute(req: TrimbleRouteRequest): Promise<RouteResult> {
  const trimble = await calcTrimbleRoute(req)
  if (trimble) return trimble

  const stops = [req.origin, ...(req.waypoints ?? []), req.destination]
  let totalKm = 0
  for (let i = 0; i < stops.length - 1; i++) {
    totalKm += haversineFallbackKm(stops[i], stops[i + 1])
  }
  return {
    distanceKm:  totalKm,
    durationMin: estimateDuration(totalKm),
  }
}

export async function calcTrimbleMatrix(
  points: Array<{ lat: number; lng: number }>,
): Promise<number[][]> {
  const n      = points.length
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))

  if (!IS_TRIMBLE_AVAILABLE) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const distKm     = roadDistKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
        matrix[i][j] = estimateDuration(distKm)
      }
    }
    return matrix
  }

  const CONCURRENCY = 10
  const tasks: Array<() => Promise<void>> = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const ci = i
      const cj = j
      tasks.push(async () => {
        const result = await calcTrimbleRoute({ origin: points[ci], destination: points[cj] })
        if (result) {
          matrix[ci][cj] = result.durationMin
        } else {
          const distKm = roadDistKm(points[ci].lat, points[ci].lng, points[cj].lat, points[cj].lng)
          matrix[ci][cj] = estimateDuration(distKm)
        }
      })
    }
  }

  let idx = 0
  async function runNext(): Promise<void> {
    while (idx < tasks.length) {
      const task = tasks[idx++]
      await task()
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => runNext()))
  return matrix
}
