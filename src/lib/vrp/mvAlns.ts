import type { Driver } from '@/lib/types'
import type { VRPSolution, CostContext, ALNSParams } from './types'
import { computeRouteCost } from './routeCost'

import {
  destroyRandom,
  destroyWorst,
  destroyCluster,
  destroyRelated,
  destroyWorstRoutes,
  destroyString,
  destroyViolated,
  repairRegret2,
  repairRegret3,
  repairRegret5,
  repairGreedy,
  crossRouteOrOpt,
  crossRoute2Opt,
  relocateSearch,
  swapSearch,
  intraRoute2Opt,
  intraRouteOrOpt,
  perturbDoubleBridge,
  ejectionChainSearch,
  SeededRng,
} from './operators'
import type { Mission } from '@/lib/types'

const PAIR_SCORE_BLEND_1D = 0.6
const PAIR_SCORE_BLEND_2D = 0.4
const REHEAT_FACTOR = 1.15
const PLATEAU_COOLING = 0.80
const CONTEXTUAL_BOOST_TW = 1.5
const CONTEXTUAL_BOOST_GEO = 1.3

type DestroyOp = 'random' | 'worst' | 'cluster' | 'related' | 'worstRoutes' | 'string' | 'violated'
type RepairOp  = 'regret5' | 'regret3' | 'regret2' | 'greedy'
type PairKey   = `${DestroyOp}|${RepairOp}`

interface BanditArm {
  weight: number

  cumImprovement: number

  uses: number

  bestHits: number

  cumTimeMs: number

  cumDiversity: number
}

function computeEliteSize(totalMissions: number): number {
  return Math.max(10, Math.round(3 * Math.log2(Math.max(2, totalMissions))))
}
let ELITE_SIZE = 10
const MIN_DIVERSITY = 0.08

const FINGERPRINT_SIZE = 64

const _fpCache = new WeakMap<VRPSolution, Uint32Array>()

function popcount32(x: number): number {
  x = x - ((x >> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
  return (((x + (x >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24
}

function computeFingerprint(sol: VRPSolution): Uint32Array {
  const fp = new Uint32Array(FINGERPRINT_SIZE)
  for (const r of sol.routes) {
    for (const m of r.missions) {

      let h = 2166136261
      for (let i = 0; i < m.id.length; i++) { h ^= m.id.charCodeAt(i); h = Math.imul(h, 16777619) }
      for (let i = 0; i < r.driverId.length; i++) { h ^= r.driverId.charCodeAt(i); h = Math.imul(h, 16777619) }
      h = h >>> 0
      const wordIdx = (h >>> 5) % FINGERPRINT_SIZE
      const bitIdx = h & 31
      fp[wordIdx] |= (1 << bitIdx)
    }
  }
  return fp
}

function solutionFingerprint(sol: VRPSolution): Uint32Array {
  let fp = _fpCache.get(sol)
  if (fp) return fp
  fp = computeFingerprint(sol)
  _fpCache.set(sol, fp)
  return fp
}

function fingerprintDiversity(a: Uint32Array, b: Uint32Array): number {
  let diffBits = 0, totalBits = 0
  for (let i = 0; i < FINGERPRINT_SIZE; i++) {
    const xor = a[i] ^ b[i]
    diffBits += popcount32(xor)
    totalBits += popcount32(a[i] | b[i])
  }
  return totalBits === 0 ? 0 : diffBits / totalBits
}

function solutionDiversity(a: VRPSolution, b: VRPSolution): number {
  return fingerprintDiversity(solutionFingerprint(a), solutionFingerprint(b))
}

class ElitePool {
  private entries: Array<{ sol: VRPSolution; cost: number; iter: number }> = []
  lastImprovedIter = 0

  tryAdd(sol: VRPSolution, cost: number, iter: number): boolean {

    for (const e of this.entries) {
      if (solutionDiversity(sol, e.sol) < MIN_DIVERSITY) {
        if (cost < e.cost) {
          e.sol = sol; e.cost = cost; e.iter = iter
          this.lastImprovedIter = iter
          return true
        }
        return false
      }
    }
    if (this.entries.length < ELITE_SIZE) {
      this.entries.push({ sol, cost, iter })
      this.lastImprovedIter = iter
      return true
    }
    const worstIdx = this.entries.reduce((best, e, i) =>
      e.cost > this.entries[best].cost ? i : best, 0)
    if (cost < this.entries[worstIdx].cost) {
      this.entries[worstIdx] = { sol, cost, iter }
      this.lastImprovedIter = iter
      return true
    }
    return false
  }

  best(): { sol: VRPSolution; cost: number } | null {
    if (this.entries.length === 0) return null
    return this.entries.reduce((b, e) => e.cost < b.cost ? e : b)
  }

  mostDiverseFrom(current: VRPSolution): { sol: VRPSolution; cost: number } | null {
    if (this.entries.length === 0) return null
    let bestDiv = -1
    let bestEntry = this.entries[0]
    for (const e of this.entries) {
      const div = solutionDiversity(current, e.sol)
      if (div > bestDiv) { bestDiv = div; bestEntry = e }
    }
    return bestEntry
  }

  topK(k: number): Array<{ sol: VRPSolution; cost: number }> {
    return [...this.entries].sort((a, b) => a.cost - b.cost).slice(0, k)
  }

  size(): number { return this.entries.length }
}

const INF_SUBSTITUTE = 1_000_000

function routeCostSafe(route: VRPSolution['routes'][0], ctx: CostContext, drivers: Driver[]): number {
  const c = computeRouteCost(route, ctx, drivers)
  return isFinite(c) ? c : INF_SUBSTITUTE
}

function computeAllCosts(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
): { total: number; perRoute: Float64Array } {
  const n = solution.routes.length
  const perRoute = new Float64Array(n)
  let total = 0
  for (let i = 0; i < n; i++) {
    perRoute[i] = routeCostSafe(solution.routes[i], ctx, drivers)
    total += perRoute[i]
  }
  return { total, perRoute }
}

function incrementalCost(
  candidate: VRPSolution,
  reference: VRPSolution,
  refCosts: Float64Array,
  _refTotal: number,
  ctx: CostContext,
  drivers: Driver[],
): { total: number; perRoute: Float64Array } {
  const n = candidate.routes.length
  const perRoute = new Float64Array(n)
  let total = 0

  if (n !== reference.routes.length) {
    return computeAllCosts(candidate, ctx, drivers)
  }

  for (let i = 0; i < n; i++) {
    const cRoute = candidate.routes[i]
    const rRoute = reference.routes[i]

    if (cRoute.driverId === rRoute.driverId &&
        cRoute.missions.length === rRoute.missions.length &&
        routeUnchanged(cRoute.missions, rRoute.missions)) {

      perRoute[i] = refCosts[i]
    } else {

      perRoute[i] = routeCostSafe(cRoute, ctx, drivers)
    }
    total += perRoute[i]
  }

  return { total, perRoute }
}

function routeUnchanged(a: Mission[], b: Mission[]): boolean {

  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {

    if (a[i] !== b[i]) return false
  }
  return true
}

function totalCost(solution: VRPSolution, ctx: CostContext, drivers: Driver[]): number {
  return solution.routes.reduce((sum, route) => {
    return sum + routeCostSafe(route, ctx, drivers)
  }, 0)
}

class LandscapeTracker {
  private deltaHistory: number[] = []
  private readonly windowSize = 30

  push(delta: number): void {
    this.deltaHistory.push(delta)
    if (this.deltaHistory.length > this.windowSize) this.deltaHistory.shift()
  }

  get roughness(): number {
    if (this.deltaHistory.length < 5) return 0.5
    const mean = this.deltaHistory.reduce((s, d) => s + d, 0) / this.deltaHistory.length
    const variance = this.deltaHistory.reduce((s, d) => s + (d - mean) ** 2, 0) / this.deltaHistory.length

    const cv = mean !== 0 ? Math.sqrt(variance) / Math.abs(mean) : 1
    return Math.min(1, cv)
  }

  get improvementRate(): number {
    if (this.deltaHistory.length < 3) return 0.5
    return this.deltaHistory.filter(d => d < 0).length / this.deltaHistory.length
  }
}

export interface AlnsTelemetryEntry {
  iter: number
  cost: number
  bestCost: number
  temperature: number
  destroyOp: string
  repairOp: string
  accepted: boolean
  improved: boolean
  elitePoolSize: number
  destroyRatio: number
}

export interface AlnsTelemetry {
  entries: AlnsTelemetryEntry[]
  finalBestCost: number
  totalIterations: number
  totalTimeMs: number
}

let _lastTelemetry: AlnsTelemetry | null = null
export function getLastAlnsTelemetry(): AlnsTelemetry | null { return _lastTelemetry }

export function runMvAlns(
  initial: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  params: ALNSParams,
): VRPSolution {
  const { timeBudgetMs, seed, iterations, destroyRatio: initDestroyRatio, saT0Ratio, saTMinRatio, rhoForget } = params
  const rng = new SeededRng(seed)
  const startTime = Date.now()

  const telemetryEntries: AlnsTelemetryEntry[] = []

  let current = cloneSolution(initial)

  const currentCosts = computeAllCosts(current, ctx, drivers)
  let currentCost = currentCosts.total
  let currentPerRoute = currentCosts.perRoute

  let best = cloneSolution(current)
  let bestCost = currentCost

  if (currentCost === 0 || !isFinite(currentCost)) return best

  const totalMissions = current.routes.reduce((s, r) => s + r.missions.length, 0)
  if (totalMissions === 0) return best

  ELITE_SIZE = computeEliteSize(totalMissions)

  const nRoutes = current.routes.length

  const avgMissionsPerRoute = totalMissions / Math.max(1, nRoutes)
  const maxK = Math.max(3, Math.min(25, Math.round(avgMissionsPerRoute * 0.45)))

  const maxRoutesForRepair = Math.min(
    initial.routes.length,
    Math.max(6, Math.ceil(Math.sqrt(initial.routes.length))),
  )

  const safeT0 = Math.max(0.001, saT0Ratio * currentCost)
  const safeTmin = Math.max(0.0001, saTMinRatio * currentCost)
  let T_explore = safeT0
  const T_explore_decay = Math.pow(safeTmin / safeT0, 1 / Math.max(1, iterations * 1.2))
  let T_exploit = safeT0 * 0.3
  const T_exploit_decay = Math.pow(safeTmin / safeT0, 1 / Math.max(1, iterations * 0.6))

  const TABU_BASE = 100
  const TABU_MAX = 400
  const tabuSet = new Set<string>()
  const tabuQueue: string[] = []

  function solutionHash(sol: VRPSolution): string {
    let h = 2166136261
    for (const r of sol.routes) {

      for (let i = 0; i < r.driverId.length; i++) {
        h ^= r.driverId.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }

      h ^= r.missions.length
      h = Math.imul(h, 16777619)

      for (const m of r.missions) {
        for (let i = 0; i < m.id.length; i++) {
          h ^= m.id.charCodeAt(i)
          h = Math.imul(h, 16777619)
        }
      }

      h ^= 0xFF
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(36)
  }

  function isTabu(sol: VRPSolution): boolean { return tabuSet.has(solutionHash(sol)) }

  function addTabu(sol: VRPSolution, iter: number): void {
    const h = solutionHash(sol)
    if (tabuSet.has(h)) return
    tabuSet.add(h); tabuQueue.push(h)
    const maxSize = Math.round(TABU_BASE + (TABU_MAX - TABU_BASE) * (iter / Math.max(1, iterations)))
    while (tabuQueue.length > maxSize) { tabuSet.delete(tabuQueue.shift()!) }
  }
  addTabu(current, 0)

  const destroyOps: DestroyOp[] = ['random', 'worst', 'cluster', 'related', 'worstRoutes', 'string', 'violated']
  const repairOps: RepairOp[] = ['regret5', 'regret3', 'regret2', 'greedy']

  function makeBandit<T extends string>(ops: T[], initWeights: number[]): Record<T, BanditArm> {
    const rec = {} as Record<T, BanditArm>
    ops.forEach((op, i) => {
      rec[op] = { weight: initWeights[i], cumImprovement: 0, uses: 0, bestHits: 0, cumTimeMs: 0, cumDiversity: 0 }
    })
    return rec
  }

  const dBandit = makeBandit(destroyOps, [1, 1, 1, 1.2, 1.1, 1.0, 1.3])
  const rBandit = makeBandit(repairOps, [1.2, 1.5, 1, 0.6])

  const pairScores = new Map<PairKey, { score: number; uses: number }>()
  for (const d of destroyOps) {
    for (const r of repairOps) {
      pairScores.set(`${d}|${r}` as PairKey, { score: 1.0, uses: 0 })
    }
  }

  function selectRepairForDestroy(dOp: DestroyOp, _rng: SeededRng, iter: number): RepairOp {
    const eps = getEpsilon(iter)
    if (_rng.next() < eps) return repairOps[Math.floor(_rng.next() * repairOps.length)]

    const τ = 0.5
    const scores = repairOps.map(rOp => {
      const pair = pairScores.get(`${dOp}|${rOp}` as PairKey)
      const pairScore = pair ? pair.score : 1.0
      const armScore = Math.max(0.01, rBandit[rOp].weight)
      return armScore * PAIR_SCORE_BLEND_1D + pairScore * PAIR_SCORE_BLEND_2D
    })
    const maxScore = Math.max(...scores)
    const expScores = scores.map(s => Math.exp((s - maxScore) / τ))
    const sumExp = expScores.reduce((a, b) => a + b, 0)
    let r = _rng.next()
    for (let i = 0; i < repairOps.length; i++) {
      r -= expScores[i] / sumExp
      if (r <= 0) return repairOps[i]
    }
    return repairOps[repairOps.length - 1]
  }

  function getEpsilon(iter: number): number {
    return 0.05 + 0.25 * Math.max(0, 1 - iter / (iterations * 0.8))
  }

  function selectBandit<T extends string>(ops: T[], arms: Record<string, BanditArm>, _rng: SeededRng, iter: number): T {
    const eps = getEpsilon(iter)

    if (_rng.next() < eps) return ops[Math.floor(_rng.next() * ops.length)]

    const τ = 0.5
    const scores = ops.map(op => Math.max(0.01, arms[op].weight))
    const maxScore = Math.max(...scores)
    const expScores = scores.map(s => Math.exp((s - maxScore) / τ))
    const sumExp = expScores.reduce((a, b) => a + b, 0)
    let r = _rng.next()
    for (let i = 0; i < ops.length; i++) {
      r -= expScores[i] / sumExp
      if (r <= 0) return ops[i]
    }
    return ops[ops.length - 1]
  }

  const UPDATE_FREQ = 5
  const BLOCK_SIZE = 50

  let destroyRatio = initDestroyRatio
  const ACC_WINDOW = 20
  const accHistory: boolean[] = []

  const elitePool = new ElitePool()
  elitePool.tryAdd(cloneSolution(best), bestCost, 0)

  const allMissionsList = current.routes.flatMap(r => r.missions)
  const twRatio = allMissionsList.filter(m => m.timeWindow).length / Math.max(1, totalMissions)
  const p1Ratio = allMissionsList.filter(m => m.priority === 1).length / Math.max(1, totalMissions)

  if (twRatio > 0.5 || p1Ratio > 0.1) {

    dBandit['violated'].weight *= CONTEXTUAL_BOOST_TW
    dBandit['worst'].weight *= CONTEXTUAL_BOOST_GEO
    rBandit['regret5'].weight *= CONTEXTUAL_BOOST_GEO
  } else {

    dBandit['cluster'].weight *= CONTEXTUAL_BOOST_GEO
    dBandit['related'].weight *= 1.2
    rBandit['greedy'].weight *= 1.2
  }

  let rejectStreak = 0
  const RR_STREAK = 15
  const RR_RATIO = 0.4

  let lastBestIter = 0

  const STAGNATION_LIMIT = Math.max(30, Math.round(Math.log2(Math.max(1, iterations)) * 5 + Math.log2(Math.max(1, totalMissions)) * 4))

  const landscape = new LandscapeTracker()

  for (let iter = 0; iter < iterations; iter++) {

    if (Date.now() - startTime > timeBudgetMs) break

    if (iter - lastBestIter > STAGNATION_LIMIT && iter > iterations * 0.3) break

    const progress = iter / iterations
    if (progress < 0.4) {

      destroyRatio = Math.max(destroyRatio, 0.25)
    } else if (progress < 0.8) {

      destroyRatio = Math.min(destroyRatio, 0.18)
    } else {

      destroyRatio = Math.min(destroyRatio, 0.12)
    }

    const useExplore = (iter % 3 !== 2)
    const T = useExplore ? T_explore : T_exploit

    const tempRatio = safeT0 > safeTmin ? Math.max(0, Math.min(1, (T - safeTmin) / (safeT0 - safeTmin))) : 0
    const baseRatio = Math.min(0.45, destroyRatio * (0.6 + 0.8 * tempRatio))

    const roughness = landscape.roughness
    const impRate = landscape.improvementRate

    const landscapeMultiplier = roughness > 0.7 ? 0.7 : roughness < 0.3 ? 1.4 : 1.0

    const stagnationMultiplier = impRate < 0.1 ? 1.3 : impRate > 0.3 ? 0.8 : 1.0

    const effectiveRatio = baseRatio * landscapeMultiplier * stagnationMultiplier
    const k = Math.max(1, Math.min(Math.round(totalMissions * effectiveRatio), maxK))

    const dOp = selectBandit(destroyOps, dBandit, rng, iter)
    const rOp = selectRepairForDestroy(dOp, rng, iter)

    const opStartMs = Date.now()

    let partial: VRPSolution
    let removed: Mission[]

    if (dOp === 'random') {
      const res = destroyRandom(current, k, rng); partial = res.partial; removed = res.removed
    } else if (dOp === 'worst') {
      const res = destroyWorst(current, k, ctx, drivers); partial = res.partial; removed = res.removed
    } else if (dOp === 'related') {
      const res = destroyRelated(current, k, rng); partial = res.partial; removed = res.removed
    } else if (dOp === 'worstRoutes') {
      const res = destroyWorstRoutes(current, k, ctx, drivers, rng); partial = res.destroyed; removed = res.removed
    } else if (dOp === 'string') {
      const res = destroyString(current, k, rng); partial = res.partial; removed = res.removed
    } else if (dOp === 'violated') {
      const res = destroyViolated(current, k, ctx, drivers); partial = res.partial; removed = res.removed
    } else {
      const res = destroyCluster(current, k, rng); partial = res.partial; removed = res.removed
    }

    if (removed.length === 0) continue

    let candidate: VRPSolution
    if (rOp === 'regret5') candidate = repairRegret5(partial, removed, ctx, drivers, maxRoutesForRepair)
    else if (rOp === 'regret3') candidate = repairRegret3(partial, removed, ctx, drivers, maxRoutesForRepair)
    else if (rOp === 'regret2') candidate = repairRegret2(partial, removed, ctx, drivers, maxRoutesForRepair)
    else candidate = repairGreedy(partial, removed, ctx, drivers, maxRoutesForRepair)

    const candidateCosts = incrementalCost(
      candidate, current, currentPerRoute, currentCost, ctx, drivers,
    )
    const candidateCost = candidateCosts.total

    const noiseScale = rejectStreak > 20 ? 0.02 * currentCost * (rng.next() - 0.5) : 0
    const delta = (candidateCost + noiseScale) - currentCost
    const opTimeMs = Date.now() - opStartMs

    landscape.push(delta)

    let accepted = false
    let score = 0
    const tabu = isTabu(candidate)

    if (delta < 0 && !tabu) {
      accepted = true; score = 2
      if (candidateCost < bestCost) {
        best = cloneSolution(candidate); bestCost = candidateCost
        score = 3; lastBestIter = iter
        elitePool.tryAdd(cloneSolution(best), bestCost, iter)
      }
    } else if (candidateCost < bestCost) {
      accepted = true; score = 3
      best = cloneSolution(candidate); bestCost = candidateCost
      lastBestIter = iter
      elitePool.tryAdd(cloneSolution(best), bestCost, iter)
    } else if (T > 0 && !tabu) {
      if (rng.next() < Math.exp(-delta / T)) { accepted = true; score = 1 }
    }

    if (accepted) {
      current = candidate; currentCost = candidateCost

      currentPerRoute = candidateCosts.perRoute
      addTabu(candidate, iter); rejectStreak = 0
    } else {
      rejectStreak++
    }

    const improvement = accepted ? -delta : 0
    const diversity = accepted ? solutionDiversity(current, best) : 0

    dBandit[dOp].cumImprovement += improvement
    dBandit[dOp].uses += 1
    dBandit[dOp].cumTimeMs += opTimeMs
    dBandit[dOp].cumDiversity += diversity
    if (score === 3) dBandit[dOp].bestHits += 1

    rBandit[rOp].cumImprovement += improvement
    rBandit[rOp].uses += 1
    rBandit[rOp].cumTimeMs += opTimeMs
    rBandit[rOp].cumDiversity += diversity
    if (score === 3) rBandit[rOp].bestHits += 1

    const pairKey = `${dOp}|${rOp}` as PairKey
    const pair = pairScores.get(pairKey)!
    pair.uses++
    if (accepted) {
      pair.score = pair.score * 0.85 + 0.15 * (1 + improvement / Math.max(1, Math.abs(currentCost)) * 10)
    } else {
      pair.score = pair.score * 0.95
    }
    pair.score = Math.max(0.1, pair.score)

    if ((iter + 1) % UPDATE_FREQ === 0) {
      updateBanditWeights(destroyOps, dBandit, rhoForget, currentCost)
      updateBanditWeights(repairOps, rBandit, rhoForget, currentCost)
    }

    if ((iter + 1) % BLOCK_SIZE === 0) {
      pruneBanditWeights(destroyOps, dBandit)
      pruneBanditWeights(repairOps, rBandit)
    }

    if (telemetryEntries) {

      if (iter % 5 === 0) {
        telemetryEntries.push({
          iter, cost: currentCost, bestCost, temperature: T,
          destroyOp: dOp, repairOp: rOp, accepted, improved: score === 3,
          elitePoolSize: elitePool.size(), destroyRatio,
        })
      }
    }

    accHistory.push(accepted)
    if (accHistory.length > ACC_WINDOW) accHistory.shift()
    if (accHistory.length === ACC_WINDOW && (iter + 1) % ACC_WINDOW === 0) {
      const accRate = accHistory.filter(Boolean).length / ACC_WINDOW
      if (accRate < 0.15) destroyRatio = Math.min(0.45, destroyRatio * 1.1)
      else if (accRate > 0.40) destroyRatio = Math.max(0.10, destroyRatio * 0.95)
    }

    const itersSinceEliteImproved = iter - elitePool.lastImprovedIter

    const reheatInterval = Math.max(25, Math.round(STAGNATION_LIMIT / 2.5))
    if (itersSinceEliteImproved > 0 && itersSinceEliteImproved % reheatInterval === 0) {
      T_explore = Math.min(safeT0, T_explore * 3)

      const diverse = elitePool.mostDiverseFrom(current)
      if (diverse && diverse.cost <= currentCost * 1.08) {
        current = cloneSolution(diverse.sol)
        currentCost = diverse.cost

        const reheatCosts = computeAllCosts(current, ctx, drivers)
        currentCost = reheatCosts.total
        currentPerRoute = reheatCosts.perRoute
      }
    }

    if (rejectStreak === 5) {

      const routeIdx = Math.floor(rng.next() * current.routes.length)
      const route = current.routes[routeIdx]
      if (route.missions.length >= 2) {
        const pos = Math.floor(rng.next() * (route.missions.length - 1))
        const temp = route.missions[pos]
        route.missions[pos] = route.missions[pos + 1]
        route.missions[pos + 1] = temp

        const oldRouteCost = currentPerRoute[routeIdx]
        const newRouteCost = routeCostSafe(route, ctx, drivers)
        const newCost = currentCost - oldRouteCost + newRouteCost
        if (newCost < currentCost) {
          currentCost = newCost
          currentPerRoute[routeIdx] = newRouteCost
          if (newCost < bestCost) {
            best = cloneSolution(current); bestCost = newCost
            lastBestIter = iter
            elitePool.tryAdd(cloneSolution(best), bestCost, iter)
          }
        } else {

          route.missions[pos + 1] = route.missions[pos]
          route.missions[pos] = temp
        }
      }
    }

    if (accepted && candidateCost < bestCost * 1.02 && (iter + 1) % 10 === 0) {
      const elapsed = Date.now() - startTime
      if (elapsed < timeBudgetMs - 800) {
        const lsDeadline = Math.min(startTime + timeBudgetMs - 300, Date.now() + 400)
        let intensified = intraRoute2Opt(current, ctx, drivers, lsDeadline)
        if (Date.now() < lsDeadline) intensified = intraRouteOrOpt(intensified, ctx, drivers, lsDeadline)
        if (Date.now() < lsDeadline) intensified = relocateSearch(intensified, ctx, drivers, lsDeadline)
        if (Date.now() < lsDeadline) intensified = swapSearch(intensified, ctx, drivers, lsDeadline)

        const intensifiedCosts = computeAllCosts(intensified, ctx, drivers)
        if (intensifiedCosts.total < currentCost) {
          current = intensified; currentCost = intensifiedCosts.total
          currentPerRoute = intensifiedCosts.perRoute
          if (intensifiedCosts.total < bestCost) {
            best = cloneSolution(intensified); bestCost = intensifiedCosts.total
            lastBestIter = iter
            elitePool.tryAdd(cloneSolution(best), bestCost, iter)
          }
        }
      }
    }

    else if ((iter + 1) % 25 === 0) {
      const elapsed = Date.now() - startTime
      if (elapsed < timeBudgetMs - 600) {
        const lsDeadline = Math.min(startTime + timeBudgetMs - 200, Date.now() + 200)
        const lsResult = intraRoute2Opt(current, ctx, drivers, lsDeadline)
        const lsCosts = computeAllCosts(lsResult, ctx, drivers)
        if (lsCosts.total < currentCost) {
          current = lsResult; currentCost = lsCosts.total
          currentPerRoute = lsCosts.perRoute
          if (lsCosts.total < bestCost) {
            best = cloneSolution(lsResult); bestCost = lsCosts.total
            lastBestIter = iter
            elitePool.tryAdd(cloneSolution(best), bestCost, iter)
          }
        }
      }
    }

    if ((iter + 1) % 50 === 0 && iter > iterations * 0.2 && iter - lastBestIter > 10) {
      const extremeK = Math.max(3, Math.round(totalMissions * (0.6 + rng.next() * 0.2)))
      const extremeRes = destroyRandom(current, extremeK, rng)
      if (extremeRes.removed.length > 0) {
        const extremeCandidate = repairRegret5(extremeRes.partial, extremeRes.removed, ctx, drivers, maxRoutesForRepair)
        const extremeCost = totalCost(extremeCandidate, ctx, drivers)
        if (extremeCost < bestCost) {
          best = cloneSolution(extremeCandidate); bestCost = extremeCost
          lastBestIter = iter
          elitePool.tryAdd(cloneSolution(best), bestCost, iter)
        }

        if (extremeCost < currentCost * 1.05) {
          current = extremeCandidate; currentCost = extremeCost
          const extremeCosts = computeAllCosts(current, ctx, drivers)
          currentCost = extremeCosts.total; currentPerRoute = extremeCosts.perRoute
        }
      }
    }

    if ((iter + 1) % 100 === 0 && Date.now() - startTime < timeBudgetMs - 1000) {
      const beamCandidates = elitePool.topK(3)
      for (const bc of beamCandidates) {

        let beamSol = cloneSolution(bc.sol)
        let beamCost = bc.cost
        for (let bi = 0; bi < 5; bi++) {
          const bk = Math.max(1, Math.min(Math.round(totalMissions * 0.15), maxK))
          const bRes = destroyRelated(beamSol, bk, rng)
          const bCandidate = repairRegret3(bRes.partial, bRes.removed, ctx, drivers, maxRoutesForRepair)
          const bCost = totalCost(bCandidate, ctx, drivers)
          if (bCost < beamCost) {
            beamSol = bCandidate; beamCost = bCost
          }
        }
        if (beamCost < bestCost) {
          best = cloneSolution(beamSol); bestCost = beamCost
          lastBestIter = iter
          elitePool.tryAdd(cloneSolution(best), bestCost, iter)
        }
        elitePool.tryAdd(cloneSolution(beamSol), beamCost, iter)
      }
    }

    if (rejectStreak >= RR_STREAK) {
      rejectStreak = 0
      const rrK = Math.max(1, Math.min(Math.round(totalMissions * RR_RATIO), maxK * 2))
      const rrChoice = iter % 4
      let rrCandidate: VRPSolution
      let rrCandidateCost: number

      if (rrChoice === 3) {
        rrCandidate = perturbDoubleBridge(current, ctx, drivers, rng)

        rrCandidateCost = totalCost(rrCandidate, ctx, drivers)
      } else {
        const rrRes = rrChoice === 0 ? destroyCluster(current, rrK, rng)
          : rrChoice === 1 ? destroyRelated(current, rrK, rng)
          : destroyRandom(current, rrK, rng)
        rrCandidate = repairRegret3(rrRes.partial, rrRes.removed, ctx, drivers, maxRoutesForRepair)

        const rrCosts = incrementalCost(
          rrCandidate, current, currentPerRoute, currentCost, ctx, drivers,
        )
        rrCandidateCost = rrCosts.total
      }

      if (rrCandidateCost < bestCost) {
        best = cloneSolution(rrCandidate); bestCost = rrCandidateCost
        lastBestIter = iter
        elitePool.tryAdd(cloneSolution(best), bestCost, iter)
      }
      if (rrCandidateCost < currentCost) {
        current = rrCandidate; currentCost = rrCandidateCost

        const rrNewCosts = computeAllCosts(current, ctx, drivers)
        currentCost = rrNewCosts.total; currentPerRoute = rrNewCosts.perRoute
      } else if (rrChoice === 3) {
        if ((rrCandidateCost - currentCost) / Math.max(1, currentCost) <= 0.05) {
          current = rrCandidate; currentCost = rrCandidateCost
          const rrNewCosts = computeAllCosts(current, ctx, drivers)
          currentCost = rrNewCosts.total; currentPerRoute = rrNewCosts.perRoute
        }
      } else {
        const rrDelta = rrCandidateCost - currentCost
        if (T > 0 && Math.exp(-rrDelta / (2 * T)) > rng.next()) {
          current = rrCandidate; currentCost = rrCandidateCost
          const rrNewCosts = computeAllCosts(current, ctx, drivers)
          currentCost = rrNewCosts.total; currentPerRoute = rrNewCosts.perRoute
        }
      }
    }

    const itersSinceBest = iter - lastBestIter
    const isPlateauPhase = itersSinceBest > 15 && landscape.improvementRate < 0.05
    const isImprovingPhase = score === 3

    if (isImprovingPhase) {
      T_explore = Math.min(safeT0 * 0.8, T_explore * REHEAT_FACTOR)
      T_exploit = Math.min(safeT0 * 0.3, T_exploit * 1.10)
    } else if (isPlateauPhase) {
      T_explore = Math.max(safeTmin, T_explore * PLATEAU_COOLING)
      T_exploit = Math.max(safeTmin, T_exploit * 0.85)
    } else {
      const landscapeFactor = roughness > 0.5 ? 1.01 : 1.0
      if (accHistory.length >= 10) {
        const recentAcc = accHistory.slice(-10).filter(Boolean).length / 10
        const exploreFactor = recentAcc > 0.3 ? 0.97 : recentAcc > 0.1 ? T_explore_decay : T_explore_decay * 1.02
        const safeF = Number.isFinite(exploreFactor) ? Math.min(0.999, exploreFactor * landscapeFactor) : 0.98
        T_explore = Math.max(safeTmin, T_explore * safeF)
        T_exploit = Math.max(safeTmin, T_exploit * T_exploit_decay)
      } else {
        T_explore = Math.max(safeTmin, T_explore * T_explore_decay)
        T_exploit = Math.max(safeTmin, T_exploit * T_exploit_decay)
      }
    }
  }

  const eliteFinal = elitePool.best()
  if (eliteFinal && eliteFinal.cost < bestCost) {
    best = cloneSolution(eliteFinal.sol); bestCost = eliteFinal.cost
  }

  const finalDeadline = startTime + timeBudgetMs - 100
  if (Date.now() < finalDeadline) {
    let improved = intraRoute2Opt(best, ctx, drivers, finalDeadline)
    if (Date.now() < finalDeadline) improved = intraRouteOrOpt(improved, ctx, drivers, finalDeadline)
    if (Date.now() < finalDeadline) improved = relocateSearch(improved, ctx, drivers, finalDeadline)
    if (Date.now() < finalDeadline) improved = swapSearch(improved, ctx, drivers, finalDeadline)
    if (Date.now() < finalDeadline) improved = crossRouteOrOpt(improved, ctx, drivers, finalDeadline)
    if (Date.now() < finalDeadline) improved = crossRoute2Opt(improved, ctx, drivers, finalDeadline)

    if (Date.now() < finalDeadline) improved = ejectionChainSearch(improved, ctx, drivers, finalDeadline, 3)
    const improvedCost = totalCost(improved, ctx, drivers)
    if (improvedCost < bestCost) best = improved
  }

  _lastTelemetry = {
    entries: telemetryEntries,
    finalBestCost: bestCost,
    totalIterations: iterations,
    totalTimeMs: Date.now() - startTime,
  }

  return best
}

function cloneSolution(sol: VRPSolution): VRPSolution {

  return {
    routes: sol.routes.map(r => ({
      driverId: r.driverId,
      missions: r.missions.map(m => ({ ...m, timeWindow: m.timeWindow ? { ...m.timeWindow } : undefined })),
    })),
    cost: sol.cost,
  }
}

function updateBanditWeights<T extends string>(
  ops: T[],
  arms: Record<string, BanditArm>,
  rho: number,
  _currentCost: number,
): void {
  for (const op of ops) {
    const a = arms[op]
    if (a.uses === 0) continue

    const avgImprovement = a.cumImprovement / a.uses
    const avgDiversity = a.cumDiversity / a.uses
    const avgTimeMs = a.cumTimeMs / a.uses
    const timePenalty = avgTimeMs > 50 ? 0.1 : 0

    const compositeScore = (
      0.5 * Math.max(0, avgImprovement / Math.max(1, Math.abs(_currentCost))) * 1000 +
      0.3 * (a.bestHits / Math.max(1, a.uses)) * 10 +
      0.15 * avgDiversity * 5 -
      0.05 * timePenalty
    )

    a.weight = rho * a.weight + (1 - rho) * Math.max(0, compositeScore)
    a.weight = Math.max(0.1, a.weight)

    a.cumImprovement = 0; a.uses = 0; a.bestHits = 0; a.cumTimeMs = 0; a.cumDiversity = 0
  }
}

function pruneBanditWeights<T extends string>(ops: T[], arms: Record<string, BanditArm>): void {
  const totalBestHits = ops.reduce((s, op) => s + arms[op].bestHits, 0)
  if (totalBestHits === 0) return
  for (const op of ops) {
    const a = arms[op]
    if (a.bestHits > 0) a.weight *= 1 + 0.2 * (a.bestHits / Math.max(1, totalBestHits))
    else if (a.uses > 10) a.weight *= 0.95
    a.weight = Math.max(0.1, a.weight)
    a.bestHits = 0
  }
}
