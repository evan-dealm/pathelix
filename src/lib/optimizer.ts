import type { Mission, PlannedMission, Driver, Exutoire } from '@/lib/types'
import type { OptimizeOptions } from '@/lib/vrp/types'
import { createLogger } from '@/lib/logger'

export type { OptimizeOptions }

type ResolvedOpts = Required<Pick<OptimizeOptions,
  'timeBudgetMs' | 'seed' | 'lnsIterations' | 'lnsDestroyRatio' | 'verboseLog' | 'existingSequence' | 'weights'
>>

const log = createLogger('optimizer')
import {
  haversineKm,
  travelTimeMin,
} from '@/lib/algorithm'
import {
  MAX_WORK_MIN,
  MAX_DRIVING_MIN,
  MAX_CONTINUOUS_MIN,
  BREAK_DURATION_MIN,
  P1_DEADLINE_MIN,
  penaltyForLate,
  penaltyForP1Late,
} from '@/lib/constraints'

export interface OptimizeResult {
  orderedMissions: PlannedMission[]
  totalCostMin:    number
  warnings:        Array<{ message: string; severity: 'warning' | 'error' }>
}

class Rng {
  private state: number

  constructor(seed: number) {

    this.state = (seed >>> 0) || 0xdeadbeef
  }

  next(): number {
    let s = this.state
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    this.state = s >>> 0
    return (this.state >>> 0) / 0x100000000
  }

  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  clone(): Rng {
    const r = new Rng(this.state)
    r.state = this.state
    return r
  }
}

function parseHHMM(time: string | undefined | null): number {
  if (!time || typeof time !== 'string') return 420
  const parts = time.split(':')
  if (parts.length < 2) return 420
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (!isFinite(h) || !isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return 420
  return h * 60 + m
}

function dayOfWeek(dateStr: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d).getDay()
}

function bestExutoire(
  lat: number,
  lng: number,
  wasteType: string | undefined,
  currentTimeMin: number,
  dateStr: string,
  exutoires: Exutoire[],
): Exutoire | null {
  const dow = dayOfWeek(dateStr)
  let best: Exutoire | null = null
  let bestDist = Infinity

  for (const ex of exutoires) {

    if (ex.closedDays.includes(dow)) continue

    if (wasteType && ex.acceptedWasteTypes.length > 0) {
      if (!ex.acceptedWasteTypes.includes(wasteType)) continue
    }

    const dist = haversineKm(lat, lng, ex.lat, ex.lng)
    if (dist < bestDist) {
      bestDist = dist
      best = ex
    }
  }

  return best
}

class DistanceMatrix {

  private readonly nodes: Array<{ id: string; lat: number; lng: number }>
  private readonly dist: Float64Array
  private readonly n: number
  private readonly neighbors: number[][]
  private readonly idxMap: Map<string, number>

  constructor(
    depotLat: number,
    depotLng: number,
    missions: Mission[],
  ) {
    this.nodes = [
      { id: '__depot__', lat: depotLat, lng: depotLng },
      ...missions.map(m => ({ id: m.id, lat: m.latitude, lng: m.longitude })),
    ]
    this.n = this.nodes.length
    this.dist = new Float64Array(this.n * this.n)

    this.idxMap = new Map<string, number>()
    for (let i = 0; i < this.n; i++) {
      this.idxMap.set(this.nodes[i].id, i)
    }

    for (let i = 0; i < this.n; i++) {
      const a = this.nodes[i]
      for (let j = i; j < this.n; j++) {
        const b = this.nodes[j]
        const d = haversineKm(a.lat, a.lng, b.lat, b.lng)
        this.dist[i * this.n + j] = d
        this.dist[j * this.n + i] = d
      }
    }

    this.neighbors = []
    for (let i = 0; i < this.n; i++) {
      const others: Array<[number, number]> = []
      for (let j = 0; j < this.n; j++) {
        if (j !== i) others.push([j, this.dist[i * this.n + j]])
      }
      others.sort((a, b) => a[1] - b[1])
      this.neighbors[i] = others.map(o => o[0])
    }
  }

  idxOf(id: string): number {
    return this.idxMap.get(id) ?? -1
  }

  getByIdx(i: number, j: number): number {
    return this.dist[i * this.n + j]
  }

  get(idA: string, idB: string): number {
    const i = this.idxOf(idA)
    const j = this.idxOf(idB)
    if (i < 0 || j < 0) return 0
    return this.dist[i * this.n + j]
  }

  kNearest(id: string, k: number): string[] {
    const i = this.idxOf(id)
    if (i < 0) return []
    return this.neighbors[i]
      .filter(j => j !== 0)
      .slice(0, k)
      .map(j => this.nodes[j].id)
  }

  medianDistanceFromDepot(): number {
    const dists: number[] = []
    for (let j = 1; j < this.n; j++) {
      dists.push(this.dist[0 * this.n + j])
    }
    if (dists.length === 0) return 10
    dists.sort((a, b) => a - b)
    const mid = Math.floor(dists.length / 2)
    return dists[mid]
  }

  get size(): number {
    return this.n
  }
}

function trueRouteCostMin(
  route: Mission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
): number {
  if (route.length === 0) return 0

  let cost = 0
  let currentMin = startTimeMin
  let currentLat = depotLat
  let currentLng = depotLng

  const hasGps = (m: Mission) => m.latitude !== 0 || m.longitude !== 0

  for (const mission of route) {

    const mLat = hasGps(mission) ? mission.latitude  : currentLat
    const mLng = hasGps(mission) ? mission.longitude : currentLng

    const travel = travelTimeMin(currentLat, currentLng, mLat, mLng, speedKmh, currentMin)
    cost += travel
    currentMin += travel

    let waitMin = 0
    if (mission.timeWindow && currentMin < mission.timeWindow.openMin) {
      waitMin = mission.timeWindow.openMin - currentMin
      currentMin += waitMin
    }

    if (waitMin > 10) {
      cost += waitMin * 1.5
    } else {
      cost += waitMin * 1.2
    }

    if (mission.timeWindow && currentMin > mission.timeWindow.closeMin) {
      const late = currentMin - mission.timeWindow.closeMin
      cost += penaltyForLate(late)
    }

    if (mission.priority === 1) {
      const effectiveDeadline = Math.max(P1_DEADLINE_MIN, startTimeMin + 180)
      const p1Late = currentMin - effectiveDeadline
      cost += penaltyForP1Late(p1Late)
    }

    if (mission.priority === 2 && currentMin > 900) {
      cost += (currentMin - 900) * 0.1
    }
    if (mission.priority === 3 && currentMin < 1080) {

    }

    const onSite = mission.estimatedDurationMin + (mission.maneuverTimeMin ?? 0)
    cost += onSite
    currentMin += onSite

    if (mission.type === 'RETIRER' || mission.type === 'ECHANGER') {
      const ex = bestExutoire(mLat, mLng, mission.wasteTypeLabel, currentMin, dateStr, exutoires)
      if (!ex) {

        cost += 3.0 * 30
      }
    }

    currentLat = mLat
    currentLng = mLng
  }

  const returnTravel = travelTimeMin(currentLat, currentLng, depotLat, depotLng, speedKmh, currentMin)
  cost += returnTravel

  return cost
}

function nearestNeighbor(
  missions: Mission[],
  depotLat: number,
  depotLng: number,
  matrix: DistanceMatrix,
): Mission[] {
  if (missions.length === 0) return []

  const unvisited = new Set(missions.map(m => m.id))
  const result: Mission[] = []
  const missionById = new Map<string, Mission>(missions.map(m => [m.id, m]))

  let curId = '__depot__'

  while (unvisited.size > 0) {

    const p1Candidates = [...unvisited]
      .map(id => missionById.get(id)!)
      .filter(m => m.priority === 1)

    let nextId: string | null = null
    let bestDist = Infinity

    const candidates = p1Candidates.length > 0 ? p1Candidates.map(m => m.id) : [...unvisited]
    for (const id of candidates) {
      const d = curId === '__depot__'
        ? matrix.getByIdx(0, matrix.idxOf(id))
        : matrix.get(curId, id)
      if (d < bestDist) {
        bestDist = d
        nextId = id
      }
    }

    if (!nextId) break
    unvisited.delete(nextId)
    result.push(missionById.get(nextId)!)
    curId = nextId
  }

  return result
}

function twoOpt(
  route: Mission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
  deadline?: number,
): Mission[] {
  if (route.length < 4) return route

  let improved = true
  let best = route.slice()
  let bestCost = trueRouteCostMin(best, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)

  const MAX_STAGNATION = 3
  let stagnation = 0

  while (stagnation < MAX_STAGNATION) {
    if (deadline && Date.now() > deadline) break
    improved = false
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ]
        const c = trueRouteCostMin(candidate, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
        if (c < bestCost - 0.01) {
          best = candidate
          bestCost = c
          improved = true
          stagnation = 0
        }
      }
    }
    if (!improved) stagnation++
  }

  return best
}

function orOpt(
  route: Mission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
  segSizes: number[] = [1, 2, 3],
  deadline?: number,
): Mission[] {
  if (route.length < 3) return route

  let best = route.slice()
  let bestCost = trueRouteCostMin(best, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
  let improved = true

  while (improved) {
    if (deadline && Date.now() > deadline) break
    improved = false
    for (const seg of segSizes) {
      for (let i = 0; i <= best.length - seg; i++) {
        const segment = best.slice(i, i + seg)
        const rest    = [...best.slice(0, i), ...best.slice(i + seg)]

        const variants = seg >= 2
          ? [segment, [...segment].reverse()]
          : [segment]
        for (const sv of variants) {
          for (let j = 0; j <= rest.length; j++) {

            if (j === i) continue
            const candidate = [...rest.slice(0, j), ...sv, ...rest.slice(j)]
            if (candidate.length !== best.length) continue
            const c = trueRouteCostMin(candidate, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
            if (c < bestCost - 0.01) {
              best = candidate
              bestCost = c
              improved = true
            }
          }
        }
      }
    }
  }

  return best
}

function destroyRandom(route: Mission[], q: number, rng: Rng): { removed: Mission[]; partial: Mission[] } {
  const idx = new Set<number>()
  while (idx.size < Math.min(q, route.length)) {
    idx.add(rng.int(route.length))
  }
  const removed = route.filter((_, i) => idx.has(i))
  const partial = route.filter((_, i) => !idx.has(i))
  return { removed, partial }
}

function destroyWorst(
  route: Mission[],
  q: number,
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
): { removed: Mission[]; partial: Mission[] } {
  const baseCost = trueRouteCostMin(route, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)

  const savings: Array<{ idx: number; saving: number }> = []
  for (let i = 0; i < route.length; i++) {
    const withoutI = [...route.slice(0, i), ...route.slice(i + 1)]
    const c = trueRouteCostMin(withoutI, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
    savings.push({ idx: i, saving: baseCost - c })
  }

  savings.sort((a, b) => b.saving - a.saving)

  const toRemove = new Set(savings.slice(0, q).map(s => s.idx))
  const removed = route.filter((_, i) => toRemove.has(i))
  const partial = route.filter((_, i) => !toRemove.has(i))
  return { removed, partial }
}

function destroyCluster(
  route: Mission[],
  q: number,
  rng: Rng,
  matrix: DistanceMatrix,
): { removed: Mission[]; partial: Mission[] } {
  if (route.length === 0) return { removed: [], partial: [] }

  const seed = route[rng.int(route.length)]
  const removed = new Set<string>([seed.id])

  const relatedness = (a: Mission, b: Mission): number => {
    const geo      = matrix.get(a.id, b.id)
    const twA      = a.timeWindow?.openMin ?? (a.priority === 1 ? 360 : 480)
    const twB      = b.timeWindow?.openMin ?? (b.priority === 1 ? 360 : 480)
    const temporal = Math.abs(twA - twB) / 60
    const prio     = Math.abs((a.priority ?? 3) - (b.priority ?? 3)) * 0.3
    return geo + temporal * 0.5 + prio
  }

  while (removed.size < Math.min(q, route.length)) {

    const refs = route.filter(m => removed.has(m.id))
    const ref = refs[rng.int(refs.length)]

    let bestScore = Infinity
    let bestId: string | null = null
    for (const m of route) {
      if (removed.has(m.id)) continue
      const score = relatedness(ref, m)
      if (score < bestScore) {
        bestScore = score
        bestId = m.id
      }
    }
    if (!bestId) break
    removed.add(bestId)
  }

  const removedList = route.filter(m => removed.has(m.id))
  const partial     = route.filter(m => !removed.has(m.id))
  return { removed: removedList, partial }
}

function destroyRelated(
  route: Mission[],
  q: number,
  rng: Rng,
): { removed: Mission[]; partial: Mission[] } {
  if (route.length === 0) return { removed: [], partial: [] }

  const seed = route[rng.int(route.length)]
  const removed = new Set<string>([seed.id])

  const temporalScore = (a: Mission, b: Mission): number => {
    const twA = a.timeWindow?.openMin ?? (a.priority === 1 ? 360 : 480)
    const twB = b.timeWindow?.openMin ?? (b.priority === 1 ? 360 : 480)
    const temporal = Math.abs(twA - twB) / 60
    const prio     = Math.abs((a.priority ?? 3) - (b.priority ?? 3)) * 1.5
    return temporal + prio
  }

  while (removed.size < Math.min(q, route.length)) {
    const refs = route.filter(m => removed.has(m.id))
    const ref  = refs[rng.int(refs.length)]

    let bestScore = Infinity
    let bestId: string | null = null
    for (const m of route) {
      if (removed.has(m.id)) continue
      const score = temporalScore(ref, m)
      if (score < bestScore) { bestScore = score; bestId = m.id }
    }
    if (!bestId) break
    removed.add(bestId)
  }

  const removedList = route.filter(m => removed.has(m.id))
  const partial     = route.filter(m => !removed.has(m.id))
  return { removed: removedList, partial }
}

function repairRegretK(
  partial: Mission[],
  toInsert: Mission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
  matrix: DistanceMatrix,
  k: number = 2,
): Mission[] {
  let route = partial.slice()
  const remaining = toInsert.slice()

  while (remaining.length > 0) {
    let bestIdx    = -1
    let bestPos    = -1
    let bestRegret = -Infinity

    for (let mIdx = 0; mIdx < remaining.length; mIdx++) {
      const m = remaining[mIdx]

      const insertionCosts: Array<{ pos: number; cost: number }> = []

      for (let pos = 0; pos <= route.length; pos++) {
        const candidate = [...route.slice(0, pos), m, ...route.slice(pos)]
        const c = trueRouteCostMin(candidate, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
        insertionCosts.push({ pos, cost: c })
      }

      if (insertionCosts.length === 0) continue

      insertionCosts.sort((a, b) => a.cost - b.cost)

      const best1 = insertionCosts[0].cost
      const best2 = insertionCosts.length >= k ? insertionCosts[k - 1].cost : best1

      const regret = best2 - best1

      const regretBonus = m.priority === 1 ? 1e6 : 0

      if (regret + regretBonus > bestRegret) {
        bestRegret = regret + regretBonus
        bestIdx    = mIdx
        bestPos    = insertionCosts[0].pos
      }
    }

    if (bestIdx < 0) {

      const m = remaining[0]
      let bestPos_ = 0
      let bestC    = Infinity
      for (let pos = 0; pos <= route.length; pos++) {
        const c = trueRouteCostMin(
          [...route.slice(0, pos), m, ...route.slice(pos)],
          depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr,
        )
        if (c < bestC) { bestC = c; bestPos_ = pos }
      }
      route = [...route.slice(0, bestPos_), m, ...route.slice(bestPos_)]
      remaining.splice(0, 1)
    } else {
      route = [...route.slice(0, bestPos), remaining[bestIdx], ...route.slice(bestPos)]
      remaining.splice(bestIdx, 1)
    }
  }

  return route
}

function ruinAndRecreate(
  route: Mission[],
  rng: Rng,
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
  matrix: DistanceMatrix,
): Mission[] {
  const q = Math.max(1, Math.round(route.length * 0.5))
  const { removed, partial } = destroyCluster(route, q, rng, matrix)
  return repairRegretK(
    partial, removed,
    depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr,
    matrix,
    3,
  )
}

interface ALNSResult {
  route:    Mission[]
  costMin:  number
}

function runALNS(
  initialRoute: Mission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  exutoires: Exutoire[],
  dateStr: string,
  matrix: DistanceMatrix,
  opts: ResolvedOpts,
  rng: Rng,
  deadline: number,
): ALNSResult {
  const { lnsIterations, lnsDestroyRatio, verboseLog } = opts
  const q = Math.max(1, Math.round(initialRoute.length * lnsDestroyRatio))

  let current     = initialRoute.slice()
  let currentCost = trueRouteCostMin(current, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
  let best        = current.slice()
  let bestCost    = currentCost

  const T0   = currentCost * 0.08
  const Tmin = currentCost * 0.0005
  const Tdecay = Tmin > 0 && T0 > Tmin
    ? Math.pow(Tmin / T0, 1 / Math.max(1, lnsIterations))
    : 0.98
  let T = T0

  const RHO = 0.85
  const SCORE_NEW_BEST  = 3
  const SCORE_ACCEPTED  = 1
  const SCORE_REJECTED  = 0

  const destroyWeights  = [1, 1, 1, 1]
  const destroyScores   = [0, 0, 0, 0]
  const destroyUses     = [0, 0, 0, 0]
  const WEIGHT_UPDATE_INTERVAL = 10

  let rejectStreak = 0

  for (let iter = 0; iter < lnsIterations; iter++) {

    if (Date.now() > deadline) break

    const totalW = destroyWeights.reduce((a, b) => a + b, 0)
    let r = rng.next() * totalW
    let dOp = 0
    for (let i = 0; i < destroyWeights.length; i++) {
      r -= destroyWeights[i]
      if (r <= 0) { dOp = i; break }
    }
    destroyUses[dOp]++

    let removed: Mission[]
    let partial: Mission[]

    if (dOp === 0) {
      const res = destroyRandom(current, q, rng)
      removed = res.removed; partial = res.partial
    } else if (dOp === 1) {
      const res = destroyWorst(current, q, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)
      removed = res.removed; partial = res.partial
    } else if (dOp === 2) {
      const res = destroyCluster(current, q, rng, matrix)
      removed = res.removed; partial = res.partial
    } else {
      const res = destroyRelated(current, q, rng)
      removed = res.removed; partial = res.partial
    }

    const candidate = repairRegretK(
      partial, removed,
      depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr,
      matrix,
      3,
    )
    const candidateCost = trueRouteCostMin(candidate, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)

    const delta = candidateCost - currentCost

    const isBetterThanBest = candidateCost < bestCost - 0.01
    const accept = isBetterThanBest || delta < 0 || (T > 0 && rng.next() < Math.exp(-delta / T))

    let score = SCORE_REJECTED
    if (accept) {
      current = candidate
      currentCost = candidateCost
      rejectStreak = 0
      score = SCORE_ACCEPTED

      if (candidateCost < bestCost - 0.01) {
        best = candidate.slice()
        bestCost = candidateCost
        score = SCORE_NEW_BEST
        if (verboseLog) log.debug(`iter=${iter} new best=${bestCost.toFixed(1)}`)
      }
    } else {
      score = SCORE_REJECTED
      rejectStreak++
    }

    destroyScores[dOp] += score

    if ((iter + 1) % WEIGHT_UPDATE_INTERVAL === 0) {
      for (let i = 0; i < destroyWeights.length; i++) {
        const avgScore = destroyUses[i] > 0 ? destroyScores[i] / destroyUses[i] : 0
        destroyWeights[i] = RHO * destroyWeights[i] + (1 - RHO) * Math.max(0.1, avgScore)
        destroyScores[i] = 0
        destroyUses[i]   = 0
      }
    }

    if (rejectStreak >= 20) {
      rejectStreak = 0
      const rrRoute = ruinAndRecreate(
        current, rng,
        depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr,
        matrix,
      )
      const rrCost = trueRouteCostMin(rrRoute, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)

      if (rrCost < currentCost) {
        current = rrRoute
        currentCost = rrCost

        T = Math.max(T, currentCost * 0.02)
        if (verboseLog) log.debug(`R&R improved → reheat T=${T.toFixed(2)}`)

        if (rrCost < bestCost - 0.01) {
          best = rrRoute.slice()
          bestCost = rrCost
        }
      }
    }

    T = Math.max(Tmin, T * Tdecay)
  }

  return { route: best, costMin: bestCost }
}

function injectExutoireTrips(
  route: Mission[],
  driver: Driver,
  exutoires: Exutoire[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
  dateStr: string,
): PlannedMission[] {
  const capacity    = driver.vehicleCapacity ?? 1
  const maxM3       = driver.maxBinSizeM3 ?? Infinity
  const result: PlannedMission[] = []

  let binLoad   = 0
  let volumeM3  = 0
  let seqOrder  = 0

  const hasMoreBinMissions = (from: number): boolean => {
    for (let i = from; i < route.length; i++) {
      if (route[i].type === 'RETIRER' || route[i].type === 'ECHANGER') return true
    }
    return false
  }

  let currentMin = startTimeMin
  let currentLat = depotLat
  let currentLng = depotLng

  for (let i = 0; i < route.length; i++) {
    const m = route[i]

    const travel = travelTimeMin(currentLat, currentLng, m.latitude, m.longitude, speedKmh, currentMin)
    currentMin += travel
    if (m.timeWindow && currentMin < m.timeWindow.openMin) {
      currentMin = m.timeWindow.openMin
    }
    currentMin += m.estimatedDurationMin + (m.maneuverTimeMin ?? 0)

    const pm: PlannedMission = { ...m, sequenceOrder: seqOrder++ }
    result.push(pm)

    currentLat = m.latitude
    currentLng = m.longitude

    if (m.type === 'RETIRER' || m.type === 'ECHANGER') {
      binLoad++
      volumeM3 += m.binSizeM3 ?? 0

      const needsVider =
        binLoad >= capacity ||
        (maxM3 < Infinity && volumeM3 >= maxM3) ||
        !hasMoreBinMissions(i + 1)

      if (needsVider && binLoad > 0) {
        const ex = bestExutoire(currentLat, currentLng, m.wasteTypeLabel, currentMin, dateStr, exutoires)

        if (ex) {
          const exTravelMin = travelTimeMin(currentLat, currentLng, ex.lat, ex.lng, speedKmh, currentMin)
          let exArrival = currentMin + exTravelMin
          if (exArrival < ex.openingHoursOpen) exArrival = ex.openingHoursOpen

          const vider: PlannedMission = {
            id:                   `_vider_${ex.id}_${i}`,
            type:                 'VIDER',
            date:                 m.date,
            address:              ex.address,
            clientName:           ex.name,
            latitude:             ex.lat,
            longitude:            ex.lng,
            estimatedDurationMin: ex.serviceTimeMin,
            maneuverTimeMin:      0,
            sequenceOrder:        seqOrder++,
            isSynthetic:          true,
          }
          result.push(vider)

          currentMin = exArrival + ex.serviceTimeMin
          currentLat = ex.lat
          currentLng = ex.lng
          binLoad  = 0
          volumeM3 = 0
        }
      }
    } else if (m.type === 'VIDER') {
      binLoad  = 0
      volumeM3 = 0
    }
  }

  return result
}

function insertAutoBreaks(
  route: PlannedMission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
): PlannedMission[] {
  if (route.length === 0) return []

  const result: PlannedMission[] = []
  let continuousDrivingMin = 0
  let currentMin = startTimeMin
  let currentLat = depotLat
  let currentLng = depotLng
  let seqOrder = 0

  for (let i = 0; i < route.length; i++) {
    const m = route[i]

    const travel = travelTimeMin(currentLat, currentLng, m.latitude, m.longitude, speedKmh, currentMin)
    continuousDrivingMin += travel

    if (continuousDrivingMin > MAX_CONTINUOUS_MIN) {

      const pause: PlannedMission = {
        id:                   `_pause_${i}_${currentMin}`,
        type:                 'PAUSE',
        date:                 m.date,
        address:              'Pause réglementaire',
        latitude:             currentLat,
        longitude:            currentLng,
        estimatedDurationMin: BREAK_DURATION_MIN,
        maneuverTimeMin:      0,
        sequenceOrder:        seqOrder++,
        isSynthetic:          true,
      }
      result.push(pause)
      currentMin += BREAK_DURATION_MIN
      continuousDrivingMin = 0
    }

    currentMin += travel
    if (m.timeWindow && currentMin < m.timeWindow.openMin) {
      currentMin = m.timeWindow.openMin
    }
    currentMin += m.estimatedDurationMin + (m.maneuverTimeMin ?? 0)

    result.push({ ...m, sequenceOrder: seqOrder++ })

    currentLat = m.latitude
    currentLng = m.longitude

    if (m.type === 'PAUSE') {
      const pauseDuration = m.estimatedDurationMin + (m.maneuverTimeMin ?? 0)
      if (pauseDuration >= 45) {

        continuousDrivingMin = 0
      } else if (pauseDuration >= 15) {

        continuousDrivingMin = Math.max(0, continuousDrivingMin - pauseDuration)
      }

    }
  }

  return result
}

function generateWarnings(
  route: PlannedMission[],
  depotLat: number,
  depotLng: number,
  startTimeMin: number,
  speedKmh: number,
): Array<{ message: string; severity: 'warning' | 'error' }> {
  const warnings: Array<{ message: string; severity: 'warning' | 'error' }> = []

  let currentMin = startTimeMin
  let currentLat = depotLat
  let currentLng = depotLng
  let totalDriving = 0

  for (const m of route) {
    const travel = travelTimeMin(currentLat, currentLng, m.latitude, m.longitude, speedKmh, currentMin)
    totalDriving += travel
    currentMin += travel

    if (m.timeWindow && currentMin < m.timeWindow.openMin) {
      currentMin = m.timeWindow.openMin
    }

    if (m.timeWindow && currentMin > m.timeWindow.closeMin && !m.isSynthetic) {
      const h = Math.floor(currentMin / 60).toString().padStart(2, '0')
      const min = (currentMin % 60).toString().padStart(2, '0')
      warnings.push({
        message: `Mission "${m.address}" : arrivée à ${h}:${min} dépasse la fenêtre horaire`,
        severity: 'warning',
      })
    }

    if (m.priority === 1) {
      const effectiveDeadline = Math.max(P1_DEADLINE_MIN, startTimeMin + 180)
      if (currentMin > effectiveDeadline) {
        const dh = Math.floor(currentMin / 60).toString().padStart(2, '0')
        const dm = (currentMin % 60).toString().padStart(2, '0')
        const eh = Math.floor(effectiveDeadline / 60).toString().padStart(2, '0')
        const em = (effectiveDeadline % 60).toString().padStart(2, '0')
        warnings.push({
          message: `Mission P1 "${m.address}" : service à ${dh}:${dm} dépasse la deadline ${eh}:${em}`,
          severity: 'error',
        })
      }
    }

    currentMin += m.estimatedDurationMin + (m.maneuverTimeMin ?? 0)
    currentLat = m.latitude
    currentLng = m.longitude
  }

  const returnTravel = travelTimeMin(currentLat, currentLng, depotLat, depotLng, speedKmh, currentMin)
  totalDriving += returnTravel
  currentMin += returnTravel

  const workMin = currentMin - startTimeMin

  if (totalDriving > MAX_DRIVING_MIN) {
    warnings.push({
      message: `Durée de conduite (${Math.round(totalDriving)} min) dépasse le maximum légal ${MAX_DRIVING_MIN} min`,
      severity: 'error',
    })
  }

  if (workMin > MAX_WORK_MIN) {
    warnings.push({
      message: `Durée de travail (${Math.round(workMin)} min) dépasse le maximum légal ${MAX_WORK_MIN} min`,
      severity: 'error',
    })
  }

  return warnings
}

export function optimizeSequence(
  missions:  Mission[],
  driver:    Driver,
  exutoires: Exutoire[],
  startTime: string,
  speedKmh:  number,
  options?:  OptimizeOptions,
): OptimizeResult {

  const opts: ResolvedOpts = {
    timeBudgetMs:     options?.timeBudgetMs     ?? 8000,
    seed:             options?.seed             ?? 42,
    lnsIterations:    options?.lnsIterations    ?? 80,
    lnsDestroyRatio:  options?.lnsDestroyRatio  ?? 0.3,
    verboseLog:       options?.verboseLog       ?? false,
    existingSequence: options?.existingSequence ?? [],
    weights:          options?.weights          ?? { distance: 1, punctuality: 1, balance: 1 },
  }

  const deadline    = Date.now() + opts.timeBudgetMs
  const startTimeMin = parseHHMM(startTime)
  const depotLat    = driver.depotLat
  const depotLng    = driver.depotLng

  const activeMissions = missions.filter(m => !m.archived)

  if (activeMissions.length === 0) {
    return { orderedMissions: [], totalCostMin: 0, warnings: [] }
  }

  const dateStr = activeMissions[0].date ?? new Date().toISOString().slice(0, 10)

  const matrix = new DistanceMatrix(depotLat, depotLng, activeMissions)

  let initialRoute: Mission[]

  if (opts.existingSequence.length > 0) {

    const missionById = new Map<string, Mission>(activeMissions.map(m => [m.id, m]))
    const ordered: Mission[] = []
    const usedIds = new Set<string>()

    for (const id of opts.existingSequence) {
      const m = missionById.get(id)
      if (m) {
        ordered.push(m)
        usedIds.add(id)
      }
    }

    for (const m of activeMissions) {
      if (!usedIds.has(m.id)) ordered.push(m)
    }
    initialRoute = ordered
    if (opts.verboseLog) log.debug('Warm-start activé, skip Nearest Neighbor')
  } else {
    initialRoute = nearestNeighbor(activeMissions, depotLat, depotLng, matrix)
  }

  let localRoute = initialRoute
  if (Date.now() < deadline) {
    localRoute = twoOpt(localRoute, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr, deadline)
  }
  if (Date.now() < deadline) {
    localRoute = orOpt(localRoute, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr, [1, 2, 3], deadline)
  }

  const N_STARTS = 5
  let bestRoute  = localRoute.slice()
  let bestCost   = trueRouteCostMin(bestRoute, depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr)

  for (let run = 0; run < N_STARTS; run++) {
    if (Date.now() > deadline) break

    const rng = new Rng(opts.seed + run * 1000)

    let startRoute = localRoute.slice()
    if (run > 0) {

      const q = Math.max(1, Math.round(startRoute.length * 0.2))
      const res = destroyRandom(startRoute, q, rng)
      startRoute = repairRegretK(
        res.partial, res.removed,
        depotLat, depotLng, startTimeMin, speedKmh, exutoires, dateStr,
        matrix,
      )
    }

    const result = runALNS(
      startRoute,
      depotLat, depotLng,
      startTimeMin, speedKmh,
      exutoires, dateStr,
      matrix,
      opts,
      rng,
      deadline,
    )

    if (result.costMin < bestCost) {
      bestCost  = result.costMin
      bestRoute = result.route
      if (opts.verboseLog) log.debug(`run=${run} best cost=${bestCost.toFixed(1)}`)
    }
  }

  const withExutoires = injectExutoireTrips(
    bestRoute, driver, exutoires,
    depotLat, depotLng, startTimeMin, speedKmh, dateStr,
  )

  const withBreaks = insertAutoBreaks(
    withExutoires,
    depotLat, depotLng,
    startTimeMin, speedKmh,
  )

  const orderedMissions = withBreaks.map((m, idx) => ({ ...m, sequenceOrder: idx }))

  const warnings = generateWarnings(
    orderedMissions, depotLat, depotLng, startTimeMin, speedKmh,
  )

  return {
    orderedMissions,
    totalCostMin: bestCost,
    warnings,
  }
}
