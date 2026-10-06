import type { Exutoire } from '@/lib/types'
import { cachedDist } from './distanceCache'

let _congestionCount = new Map<string, number>()

export function resetExutoireCongestion(): Map<string, number> {
  _congestionCount = new Map<string, number>()
  return _congestionCount
}

export function getCongestionMap(): Map<string, number> {
  return _congestionCount
}

export function recordExutoireVisit(exutoireId: string, congestionMap?: Map<string, number>): void {
  const map = congestionMap ?? _congestionCount
  map.set(exutoireId, (map.get(exutoireId) ?? 0) + 1)
}

const _wasteNormCache = new WeakMap<Exutoire[], Map<string, string[]>>()

function getNormalizedWasteTypes(exutoires: Exutoire[]): Map<string, string[]> {
  let cached = _wasteNormCache.get(exutoires)
  if (cached) return cached
  cached = new Map<string, string[]>()
  for (const ex of exutoires) {
    cached.set(ex.id, ex.acceptedWasteTypes.map(w => w.toLowerCase().trim()))
  }
  _wasteNormCache.set(exutoires, cached)
  return cached
}

function estimateQueueDelay(n: number, serviceTimeMin: number, c: number = 1): number {
  if (serviceTimeMin <= 0) return 0
  if (n <= 0) return 0

  const lambda = n / 600
  const mu = 1 / Math.max(1, serviceTimeMin)
  const rho = lambda / (c * mu)

  if (rho >= 0.95) return serviceTimeMin * n * 0.5
  if (rho < 0.01) return 0

  const waitMin = (rho * rho / (1 - rho)) * serviceTimeMin
  if (!isFinite(waitMin)) return serviceTimeMin * 3
  return Math.min(waitMin, serviceTimeMin * 3)
}

/**
 * Picks the exutoire for a dump trip. `record` adds the visit to the congestion count: only the
 * final plan formatting should do that — cost evaluation calls this thousands of times per run,
 * and recording there made the count grow with the number of evaluations, so the same route's
 * cost drifted over the search and every exutoire ended up looking saturated.
 */
export function findBestExutoire(
  missionLat: number,
  missionLng: number,
  linkedExutoireId: string | undefined,
  wasteTypeLabel: string | undefined,
  exutoires: Exutoire[],
  dow: number,
  currentMin?: number,
  congestionMap?: Map<string, number>,
  record = true,
): Exutoire | undefined {
  const congestion = congestionMap ?? _congestionCount
  const wasteNorm = wasteTypeLabel ? wasteTypeLabel.toLowerCase().trim() : undefined
  const normalizedTypes = wasteNorm ? getNormalizedWasteTypes(exutoires) : undefined

  const candidates = exutoires.filter(ex => {
    if (ex.closedDays.includes(dow)) return false

    if (wasteNorm && normalizedTypes && ex.acceptedWasteTypes.length > 0) {
      const exTypes = normalizedTypes.get(ex.id) ?? []
      const accepted = exTypes.some(w => w === wasteNorm)
      if (!accepted) return false
    }

    if (currentMin !== undefined) {
      const speedKmh = 50
      const travelEst = cachedDist(missionLat, missionLng, ex.lat, ex.lng) / speedKmh * 60
      const arrivalEst = currentMin + travelEst

      if (arrivalEst > ex.openingHoursClose + 30) return false
    }
    return true
  })

  if (candidates.length === 0) return undefined

  const W_DIST       = 0.60
  const W_SERVICE    = 0.15
  const W_CONGESTION = 0.25
  const LINKED_BONUS = -0.20

  const distances = candidates.map(ex => cachedDist(missionLat, missionLng, ex.lat, ex.lng))
  const maxDist = Math.max(...distances, 1)
  const maxService = Math.max(...candidates.map(ex => ex.serviceTimeMin), 1)
  const MAX_EXPECTED_DELAY = 30

  let best: Exutoire | undefined
  let bestScore = Infinity

  for (let i = 0; i < candidates.length; i++) {
    const ex = candidates[i]
    const dist = distances[i]
    const count = congestion.get(ex.id) ?? 0
    const queueDelay = estimateQueueDelay(count, ex.serviceTimeMin)
    const congestionNorm = Math.min(queueDelay / MAX_EXPECTED_DELAY, 1)

    let score = W_DIST * (dist / maxDist)
      + W_SERVICE * (ex.serviceTimeMin / maxService)
      + W_CONGESTION * congestionNorm

    if (linkedExutoireId && ex.id === linkedExutoireId) {
      score += LINKED_BONUS
    }

    if (score < bestScore) {
      bestScore = score
      best = ex
    }
  }

  if (best && record) recordExutoireVisit(best.id, congestion)
  return best
}
