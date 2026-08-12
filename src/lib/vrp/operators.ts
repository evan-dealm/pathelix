import type { Mission, Driver } from '@/lib/types'
import type { VRPSolution, CostContext, Route } from './types'
import { computeRouteCost, computePrefixStates, computeInsertionDelta, computeRemovalDelta, isAllerRetourCompatible } from './routeCost'
import { cachedDist } from './distanceCache'
import { isHfvrpCompatible, areAllHfvrpCompatible } from './hfvrp'
import { InsertionCache } from './insertionCache'

export class SeededRng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }

  next(): number {
    this.s = (Math.imul(1664525, this.s) + 1013904223) >>> 0
    return this.s / 0x100000000
  }

  int(n: number): number {
    return Math.floor(this.next() * n)
  }
}

class RouteGrid {
  private cells = new Map<string, number[]>()
  private depotPos: Array<{ lat: number; lng: number }>

  constructor(
    routes: VRPSolution['routes'],
    drivers: Driver[],
    // eslint-disable-next-line no-unused-vars
    private cellDeg = 0.5,
  ) {
    const depotMap = new Map<string, { lat: number; lng: number }>()
    for (const d of drivers) depotMap.set(d.id, { lat: d.depotLat, lng: d.depotLng })

    this.depotPos = routes.map(r => depotMap.get(r.driverId) ?? { lat: 0, lng: 0 })

    for (let ri = 0; ri < routes.length; ri++) {
      const key = this._cell(this.depotPos[ri].lat, this.depotPos[ri].lng)
      const arr = this.cells.get(key) ?? []
      arr.push(ri)
      this.cells.set(key, arr)
    }
  }

  private _cell(lat: number, lng: number): string {
    return `${Math.floor(lat / this.cellDeg)},${Math.floor(lng / this.cellDeg)}`
  }

  getNearestIndices(lat: number, lng: number, N: number): number[] {
    if (N >= this.depotPos.length) return this.depotPos.map((_, i) => i)

    const cl = Math.floor(lat / this.cellDeg)
    const cc = Math.floor(lng / this.cellDeg)
    const found = new Set<number>()

    for (let r = 0; r <= 4 && found.size < N; r++) {
      for (let dl = -r; dl <= r; dl++) {
        for (let dc = -r; dc <= r; dc++) {
          if (Math.abs(dl) !== r && Math.abs(dc) !== r) continue
          const key = `${cl + dl},${cc + dc}`
          for (const ri of this.cells.get(key) ?? []) found.add(ri)
        }
      }
    }

    const candidates = Array.from(found)
    if (candidates.length <= N) return candidates

    candidates.sort((a, b) => {
      const da = cachedDist(lat, lng, this.depotPos[a].lat, this.depotPos[a].lng)
      const db = cachedDist(lat, lng, this.depotPos[b].lat, this.depotPos[b].lng)
      return da - db
    })
    return candidates.slice(0, N)
  }
}

function findNearestRouteIndices(
  mission: Mission,
  routes: VRPSolution['routes'],
  drivers: Driver[],
  N: number,
  grid?: RouteGrid,
): number[] {
  if (N >= routes.length) return routes.map((_, i) => i)

  if (grid) return grid.getNearestIndices(mission.latitude, mission.longitude, N)

  const depotMap = new Map<string, { lat: number; lng: number }>()
  for (const d of drivers) depotMap.set(d.id, { lat: d.depotLat, lng: d.depotLng })

  const dists = routes.map((r, ri) => {
    const depot = depotMap.get(r.driverId) ?? { lat: 0, lng: 0 }
    return { ri, dist: cachedDist(mission.latitude, mission.longitude, depot.lat, depot.lng) }
  })
  dists.sort((a, b) => a.dist - b.dist)
  return dists.slice(0, N).map(x => x.ri)
}

export function destroyRandom(
  solution: VRPSolution,
  k: number,
  rng: SeededRng,
): { partial: VRPSolution; removed: Mission[] } {

  const all: Array<{ routeIdx: number; missionIdx: number; mission: Mission }> = []
  for (let ri = 0; ri < solution.routes.length; ri++) {
    for (let mi = 0; mi < solution.routes[ri].missions.length; mi++) {
      all.push({ routeIdx: ri, missionIdx: mi, mission: solution.routes[ri].missions[mi] })
    }
  }

  const actualK = Math.min(k, all.length)

  for (let i = 0; i < actualK; i++) {
    const j = i + rng.int(all.length - i)
    ;[all[i], all[j]] = [all[j], all[i]]
  }

  const toRemove = all.slice(0, actualK)
  const removedIds = new Set(toRemove.map(x => x.mission.id))

  const partial: VRPSolution = {
    routes: solution.routes.map(r => ({
      driverId: r.driverId,
      missions: r.missions.filter(m => !removedIds.has(m.id)),
    })),
    cost: 0,
  }

  return { partial, removed: toRemove.map(x => x.mission) }
}

export function destroyWorst(
  solution: VRPSolution,
  k: number,
  ctx: CostContext,
  drivers: Driver[],
): { partial: VRPSolution; removed: Mission[] } {

  const contributions: Array<{ routeIdx: number; missionIdx: number; mission: Mission; contrib: number }> = []

  for (let ri = 0; ri < solution.routes.length; ri++) {
    const route = solution.routes[ri]
    const baseCost = computeRouteCost(route, ctx, drivers)
    if (!isFinite(baseCost)) continue

    const prefixStates = computePrefixStates(route, ctx, drivers)

    for (let mi = 0; mi < route.missions.length; mi++) {

      const delta = computeRemovalDelta(route, mi, prefixStates, baseCost, ctx, drivers)
      contributions.push({
        routeIdx:   ri,
        missionIdx: mi,
        mission:    route.missions[mi],
        contrib:    -delta,
      })
    }
  }

  contributions.sort((a, b) => b.contrib - a.contrib)

  const actualK    = Math.min(k, contributions.length)
  const toRemove   = contributions.slice(0, actualK)
  const removedIds = new Set(toRemove.map(x => x.mission.id))

  const partial: VRPSolution = {
    routes: solution.routes.map(r => ({
      driverId: r.driverId,
      missions: r.missions.filter(m => !removedIds.has(m.id)),
    })),
    cost: 0,
  }

  return { partial, removed: toRemove.map(x => x.mission) }
}

function repairRegretK(
  partial: VRPSolution,
  removed: Mission[],
  ctx: CostContext,
  drivers: Driver[],
  k: number,
  maxRoutes?: number,
): VRPSolution {
  const solution: VRPSolution = {
    routes: partial.routes.map(r => ({
      driverId: r.driverId,
      missions: [...r.missions],
    })),
    cost: 0,
  }

  const useGrid = maxRoutes !== undefined && maxRoutes < solution.routes.length
  const grid = useGrid ? new RouteGrid(solution.routes, drivers) : undefined

  const insertionCache = new InsertionCache()

  const routeHashes: string[] = solution.routes.map(r => insertionCache.routeHash(r.missions))

  const uninserted = [...removed]

  while (uninserted.length > 0) {
    let bestMissionIdx = 0
    let bestRegret     = -Infinity
    let bestRouteIdx   = 0
    let bestPos        = 0

    for (let ui = 0; ui < uninserted.length; ui++) {
      const mission = uninserted[ui]

      const routeIndices = useGrid && maxRoutes !== undefined
        ? findNearestRouteIndices(mission, solution.routes, drivers, maxRoutes, grid)
        : solution.routes.map((_, i) => i)

      const insertionCosts: Array<{ routeIdx: number; pos: number; cost: number }> = []

      for (const ri of routeIndices) {
        const route       = solution.routes[ri]
        if (!isAllerRetourCompatible(route.missions, mission.type)) continue
        const n           = route.missions.length
        const rHash       = routeHashes[ri]

        let allCached = true
        for (let pos = 0; pos <= n; pos++) {
          const cached = insertionCache.get(ri, rHash, mission.id, pos)
          if (cached !== undefined) {
            insertionCosts.push({ routeIdx: ri, pos, cost: cached })
          } else {
            allCached = false
            break
          }
        }

        if (!allCached) {

          const startLen = insertionCosts.length - (insertionCosts.length > 0 ? insertionCosts.filter(ic => ic.routeIdx === ri).length : 0)
          while (insertionCosts.length > startLen && insertionCosts[insertionCosts.length - 1]?.routeIdx === ri) {
            insertionCosts.pop()
          }

          const costWithout = computeRouteCost(route, ctx, drivers)
          const prefixStates = computePrefixStates(route, ctx, drivers)

          for (let pos = 0; pos <= n; pos++) {
            const delta = computeInsertionDelta(route, mission, pos, prefixStates, costWithout, ctx, drivers)
            insertionCosts.push({ routeIdx: ri, pos, cost: delta })

            insertionCache.set(ri, rHash, mission.id, pos, delta)
          }
        }
      }

      if (insertionCosts.length === 0) continue

      insertionCosts.sort((a, b) => a.cost - b.cost)

      const best1 = insertionCosts[0]
      const regret = insertionCosts.length >= k
        ? Math.max(0, insertionCosts[k - 1].cost - best1.cost)
        : insertionCosts.length > 1
          ? Math.max(0, insertionCosts[insertionCosts.length - 1].cost - best1.cost)
          : 0

      if (regret > bestRegret) {
        bestRegret     = regret
        bestMissionIdx = ui
        bestRouteIdx   = best1.routeIdx
        bestPos        = best1.pos
      }
    }

    if (bestRegret === -Infinity) {
      const mission = uninserted.splice(0, 1)[0]
      const fallbackIdx = solution.routes.findIndex(r => isAllerRetourCompatible(r.missions, mission.type))
      const fallbackRoute = solution.routes[fallbackIdx >= 0 ? fallbackIdx : 0]
      if (fallbackRoute) {
        fallbackRoute.missions.push(mission)
        const fi = fallbackIdx >= 0 ? fallbackIdx : 0
        routeHashes[fi] = insertionCache.routeHash(fallbackRoute.missions)
      }
      continue
    }

    const mission = uninserted.splice(bestMissionIdx, 1)[0]
    const route   = solution.routes[bestRouteIdx]
    route.missions = [
      ...route.missions.slice(0, bestPos),
      mission,
      ...route.missions.slice(bestPos),
    ]

    routeHashes[bestRouteIdx] = insertionCache.routeHash(route.missions)
  }

  return solution
}

export function repairRegret2(
  partial: VRPSolution,
  removed: Mission[],
  ctx: CostContext,
  drivers: Driver[],
  maxRoutes?: number,
): VRPSolution {
  return repairRegretK(partial, removed, ctx, drivers, 2, maxRoutes)
}

export function repairRegret5(
  partial: VRPSolution,
  removed: Mission[],
  ctx: CostContext,
  drivers: Driver[],
  maxRoutes?: number,
): VRPSolution {
  return repairRegretK(partial, removed, ctx, drivers, 5, maxRoutes)
}

export function repairGreedy(
  partial: VRPSolution,
  removed: Mission[],
  ctx: CostContext,
  drivers: Driver[],
  maxRoutes?: number,
): VRPSolution {
  const solution: VRPSolution = {
    routes: partial.routes.map(r => ({
      driverId: r.driverId,
      missions: [...r.missions],
    })),
    cost: 0,
  }

  const useGrid = maxRoutes !== undefined && maxRoutes < solution.routes.length
  const grid = useGrid ? new RouteGrid(solution.routes, drivers) : undefined

  const sortedRemoved = [...removed].sort((a, b) => {

    const pa = a.priority ?? 4
    const pb = b.priority ?? 4
    if (pa !== pb) return pa - pb

    const twA = a.timeWindow ? (a.timeWindow.closeMin - a.timeWindow.openMin) : 1440
    const twB = b.timeWindow ? (b.timeWindow.closeMin - b.timeWindow.openMin) : 1440
    return twA - twB
  })

  for (const mission of sortedRemoved) {
    let bestCostDelta = Infinity
    let bestRouteIdx  = -1
    let bestPos       = 0

    const routeIndices = useGrid && maxRoutes !== undefined
      ? findNearestRouteIndices(mission, solution.routes, drivers, maxRoutes, grid)
      : solution.routes.map((_, i) => i)

    for (const ri of routeIndices) {
      const route = solution.routes[ri]
      if (!isAllerRetourCompatible(route.missions, mission.type)) continue
      const baseCost = computeRouteCost(route, ctx, drivers)
      const prefixStates = computePrefixStates(route, ctx, drivers)

      const balOn = (ctx.weights?.balance ?? 0.3) > 0.5
      const routeMissions = route.missions.length
      const routeLoad = route.missions.reduce(
        (s, m) => s + (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0), 0,
      )

      const loadPenalty = balOn
        ? routeMissions * routeMissions * 3 + (routeLoad > 300 ? (routeLoad - 300) * 0.5 : 0)
        : (routeLoad > 480 ? (routeLoad - 480) * 0.3 : 0)

      for (let pos = 0; pos <= route.missions.length; pos++) {
        const delta = computeInsertionDelta(route, mission, pos, prefixStates, baseCost, ctx, drivers)
        const adjustedDelta = delta + loadPenalty
        if (adjustedDelta < bestCostDelta) {
          bestCostDelta = adjustedDelta
          bestRouteIdx  = ri
          bestPos       = pos
        }
      }
    }

    if (bestRouteIdx === -1) {

      bestRouteIdx = solution.routes.findIndex(r => isAllerRetourCompatible(r.missions, mission.type))
      if (bestRouteIdx === -1) bestRouteIdx = 0
    }
    const route = solution.routes[bestRouteIdx]
    route.missions = [
      ...route.missions.slice(0, bestPos),
      mission,
      ...route.missions.slice(bestPos),
    ]
  }

  return solution
}

export function destroyCluster(
  solution: VRPSolution,
  k: number,
  rng: SeededRng,
): { partial: VRPSolution; removed: import('@/lib/types').Mission[] } {
  type M = import('@/lib/types').Mission

  const all: M[] = solution.routes.flatMap(r => r.missions)
  if (all.length === 0) {
    return {
      partial: { routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })), cost: 0 },
      removed: [],
    }
  }

  const seed = all[rng.int(all.length)]
  const removedIds = new Set<string>([seed.id])

  const relatedness = (a: M, b: M): number => {
    const geo      = cachedDist(a.latitude, a.longitude, b.latitude, b.longitude)
    const twA      = a.timeWindow?.openMin ?? (a.priority === 1 ? 360 : 480)
    const twB      = b.timeWindow?.openMin ?? (b.priority === 1 ? 360 : 480)
    const temporal = Math.abs(twA - twB) / 60
    const PRIORITY_WEIGHT = 0.5
    const prio     = Math.abs((a.priority ?? 3) - (b.priority ?? 3)) * PRIORITY_WEIGHT
    return geo + temporal * 1.5 + prio
  }

  const CLUSTER_POWER = 5
  while (removedIds.size < Math.min(k, all.length)) {
    const refs = all.filter(m => removedIds.has(m.id))
    const ref  = refs[rng.int(refs.length)]

    const cands = all
      .filter(m => !removedIds.has(m.id))
      .map(m => ({ id: m.id, score: relatedness(ref, m) }))
      .sort((a, b) => a.score - b.score)
    if (cands.length === 0) break

    const r = Math.floor(Math.pow(rng.next(), CLUSTER_POWER) * cands.length)
    removedIds.add(cands[r].id)
  }

  const partial: VRPSolution = {
    routes: solution.routes.map(r => ({
      driverId: r.driverId,
      missions: r.missions.filter(m => !removedIds.has(m.id)),
    })),
    cost: 0,
  }
  const removed = all.filter(m => removedIds.has(m.id))
  return { partial, removed }
}

export function destroyRelated(
  solution: VRPSolution,
  k: number,
  rng: SeededRng,
): { partial: VRPSolution; removed: Mission[] } {
  const all: Mission[] = solution.routes.flatMap(r => r.missions)
  if (all.length === 0) {
    return {
      partial: {
        routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
        cost: 0,
      },
      removed: [],
    }
  }

  const seed = all[rng.int(all.length)]
  const removedIds = new Set<string>([seed.id])

  const W_GEO   = 1.0
  const W_TW    = 1.2
  const W_TYPE  = 0.6
  const W_DUR   = 0.4
  const W_WASTE = 0.8

  const relatedScore = (a: Mission, b: Mission): number => {
    const geo   = cachedDist(a.latitude, a.longitude, b.latitude, b.longitude)
    const twA   = a.timeWindow?.openMin ?? (a.priority === 1 ? 360 : 480)
    const twB   = b.timeWindow?.openMin ?? (b.priority === 1 ? 360 : 480)
    const tw    = Math.abs(twA - twB) / 60
    const type  = a.type !== b.type ? W_TYPE : 0
    const dur   = Math.abs((a.estimatedDurationMin ?? 0) - (b.estimatedDurationMin ?? 0)) / 30

    const wasteA = a.wasteTypeLabel?.toLowerCase().trim() ?? ''
    const wasteB = b.wasteTypeLabel?.toLowerCase().trim() ?? ''
    const waste  = (wasteA && wasteB && wasteA !== wasteB) ? W_WASTE : 0
    return W_GEO * geo + W_TW * tw + type + W_DUR * dur + waste
  }

  const RELATED_POWER = 5
  while (removedIds.size < Math.min(k, all.length)) {
    const refs = all.filter(m => removedIds.has(m.id))
    const ref = refs[rng.int(refs.length)]

    const cands = all
      .filter(m => !removedIds.has(m.id))
      .map(m => ({ id: m.id, score: relatedScore(ref, m) }))
      .sort((a, b) => a.score - b.score)
    if (cands.length === 0) break

    const r = Math.floor(Math.pow(rng.next(), RELATED_POWER) * cands.length)
    removedIds.add(cands[r].id)
  }

  const partial: VRPSolution = {
    routes: solution.routes.map(r => ({
      driverId: r.driverId,
      missions: r.missions.filter(m => !removedIds.has(m.id)),
    })),
    cost: 0,
  }
  const removed = all.filter(m => removedIds.has(m.id))
  return { partial, removed }
}

export function crossRouteOrOpt(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: import('@/lib/types').Driver[],
  deadline?: number,
): VRPSolution {

  const driverMap = new Map(drivers.map(d => [d.id, d]))

  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost:   solution.cost,
  }

  const K_NEAREST = Math.min(8, current.routes.length)
  function routeCentroid(route: Route): { lat: number; lng: number } {
    if (route.missions.length === 0) {
      const d = driverMap.get(route.driverId)
      return { lat: d?.depotLat ?? 0, lng: d?.depotLng ?? 0 }
    }
    let sLat = 0, sLng = 0
    for (const m of route.missions) { sLat += m.latitude; sLng += m.longitude }
    return { lat: sLat / route.missions.length, lng: sLng / route.missions.length }
  }
  function nearestRoutes(ri: number): number[] {
    const ci = routeCentroid(current.routes[ri])
    const dists: Array<{ idx: number; d: number }> = []
    for (let rj = 0; rj < current.routes.length; rj++) {
      if (rj === ri) continue
      const cj = routeCentroid(current.routes[rj])
      const dLat = ci.lat - cj.lat, dLng = ci.lng - cj.lng
      dists.push({ idx: rj, d: dLat * dLat + dLng * dLng })
    }
    dists.sort((a, b) => a.d - b.d)
    return dists.slice(0, K_NEAREST).map(d => d.idx)
  }

  for (const segSize of [1, 2, 3]) {
    if (deadline !== undefined && Date.now() > deadline) break
    let improved = true
    while (improved) {
      if (deadline !== undefined && Date.now() > deadline) break
      improved = false
      outer: for (let ri = 0; ri < current.routes.length; ri++) {
        for (let mi = 0; mi + segSize <= current.routes[ri].missions.length; mi++) {
          const segment = current.routes[ri].missions.slice(mi, mi + segSize)
          const costI   = computeRouteCost(current.routes[ri], ctx, drivers)

          const candidates = nearestRoutes(ri)
          for (const rj of candidates) {

            const dJ = driverMap.get(current.routes[rj].driverId)
            if (dJ && !areAllHfvrpCompatible(segment, dJ)) continue

            if (!segment.every(m => isAllerRetourCompatible(current.routes[rj].missions, m.type))) continue

            const costJ    = computeRouteCost(current.routes[rj], ctx, drivers)
            const baseCost = costI + costJ

            const routeIWithout = {
              driverId: current.routes[ri].driverId,
              missions: [
                ...current.routes[ri].missions.slice(0, mi),
                ...current.routes[ri].missions.slice(mi + segSize),
              ],
            }
            const newCostI = computeRouteCost(routeIWithout, ctx, drivers)

            const segVariants = segSize >= 2
              ? [segment, [...segment].reverse()]
              : [segment]

            for (const seg of segVariants) {
              for (let pj = 0; pj <= current.routes[rj].missions.length; pj++) {
                const routeJWith = {
                  driverId: current.routes[rj].driverId,
                  missions: [
                    ...current.routes[rj].missions.slice(0, pj),
                    ...seg,
                    ...current.routes[rj].missions.slice(pj),
                  ],
                }
                const newCostJ = computeRouteCost(routeJWith, ctx, drivers)

                if (newCostI + newCostJ < baseCost - 0.01) {
                  current.routes[ri] = routeIWithout
                  current.routes[rj] = routeJWith
                  improved = true
                  break outer
                }
              }
            }
          }
        }
      }
    }
  }

  return current
}

export function crossRoute2Opt(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: import('@/lib/types').Driver[],
  deadline?: number,
): VRPSolution {

  const driverMap = new Map(drivers.map(d => [d.id, d]))

  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost:   solution.cost,
  }

  let improved = true
  while (improved) {
    if (deadline !== undefined && Date.now() > deadline) break
    improved = false
    outer: for (let ri = 0; ri < current.routes.length; ri++) {
      for (let rj = ri + 1; rj < current.routes.length; rj++) {
        const missionsI = current.routes[ri].missions
        const missionsJ = current.routes[rj].missions

        const baseCost =
          computeRouteCost(current.routes[ri], ctx, drivers) +
          computeRouteCost(current.routes[rj], ctx, drivers)

        const dI = driverMap.get(current.routes[ri].driverId)
        const dJ = driverMap.get(current.routes[rj].driverId)

        for (let pi = 0; pi <= missionsI.length; pi++) {
          for (let pj = 0; pj <= missionsJ.length; pj++) {

            if (pi === missionsI.length && pj === missionsJ.length) continue
            if (pi === 0 && pj === 0) continue

            const tailIOnJ = missionsI.slice(pi)
            const tailJOnI = missionsJ.slice(pj)

            if (dI && !areAllHfvrpCompatible(tailJOnI, dI)) continue
            if (dJ && !areAllHfvrpCompatible(tailIOnJ, dJ)) continue

            const prefixI = missionsI.slice(0, pi)
            const prefixJ = missionsJ.slice(0, pj)
            if (!tailJOnI.every(m => isAllerRetourCompatible(prefixI, m.type))) continue
            if (!tailIOnJ.every(m => isAllerRetourCompatible(prefixJ, m.type))) continue

            const newRouteI = { driverId: current.routes[ri].driverId, missions: [...missionsI.slice(0, pi), ...tailJOnI] }
            const newRouteJ = { driverId: current.routes[rj].driverId, missions: [...missionsJ.slice(0, pj), ...tailIOnJ] }

            const newCost =
              computeRouteCost(newRouteI, ctx, drivers) +
              computeRouteCost(newRouteJ, ctx, drivers)

            if (newCost < baseCost - 0.01) {
              current.routes[ri] = newRouteI
              current.routes[rj] = newRouteJ
              improved = true
              break outer
            }
          }
        }
      }
    }
  }

  return current
}

export function repairRegret3(
  partial: VRPSolution,
  removed: Mission[],
  ctx: CostContext,
  drivers: Driver[],
  maxRoutes?: number,
): VRPSolution {
  return repairRegretK(partial, removed, ctx, drivers, 3, maxRoutes)
}

export function relocateSearch(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  deadline?: number,
): VRPSolution {

  const driverMap = new Map(drivers.map(d => [d.id, d]))

  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  const routeCosts = current.routes.map(r => computeRouteCost(r, ctx, drivers))

  let improved = true
  while (improved) {
    if (deadline !== undefined && Date.now() > deadline) break
    improved = false
    for (let ri = 0; ri < current.routes.length; ri++) {
      if (deadline !== undefined && Date.now() > deadline) break
      const routeI = current.routes[ri]
      if (routeI.missions.length === 0) continue
      const costI = routeCosts[ri]

      const prefixI = computePrefixStates(routeI, ctx, drivers)

      for (let mi = 0; mi < routeI.missions.length; mi++) {
        const mission = routeI.missions[mi]

        const removalDelta = computeRemovalDelta(routeI, mi, prefixI, costI, ctx, drivers)
        const costIWithout = costI + removalDelta

        let bestDelta  = 0
        let bestRj     = -1
        let bestPos    = -1

        for (let rj = 0; rj < current.routes.length; rj++) {
          if (ri === rj) continue

          const dJ = driverMap.get(current.routes[rj].driverId)
          if (dJ && !isHfvrpCompatible(mission, dJ)) continue
          if (!isAllerRetourCompatible(current.routes[rj].missions, mission.type)) continue

          const routeJ = current.routes[rj]
          const costJ  = routeCosts[rj]

          const prefixJ = computePrefixStates(routeJ, ctx, drivers)

          for (let pos = 0; pos <= routeJ.missions.length; pos++) {
            const insertDelta = computeInsertionDelta(routeJ, mission, pos, prefixJ, costJ, ctx, drivers)
            const delta = (costIWithout - costI) + insertDelta

            if (delta < bestDelta - 0.01) {
              bestDelta = delta
              bestRj    = rj
              bestPos   = pos
            }
          }
        }

        if (bestRj >= 0) {

          current.routes[ri] = {
            driverId: routeI.driverId,
            missions: routeI.missions.filter((_, idx) => idx !== mi),
          }
          current.routes[bestRj] = {
            driverId: current.routes[bestRj].driverId,
            missions: [
              ...current.routes[bestRj].missions.slice(0, bestPos),
              mission,
              ...current.routes[bestRj].missions.slice(bestPos),
            ],
          }

          routeCosts[ri] = computeRouteCost(current.routes[ri], ctx, drivers)
          routeCosts[bestRj] = computeRouteCost(current.routes[bestRj], ctx, drivers)
          improved = true
          break
        }
      }
      if (improved) break
    }
  }

  return current
}

export function swapSearch(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  deadline?: number,
): VRPSolution {

  const driverMap = new Map(drivers.map(d => [d.id, d]))

  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  let improved = true
  while (improved) {
    if (deadline !== undefined && Date.now() > deadline) break
    improved = false
    outerSwap: for (let ri = 0; ri < current.routes.length; ri++) {
      const routeI = current.routes[ri]
      if (routeI.missions.length === 0) continue
      const dI = driverMap.get(routeI.driverId)

      for (let rj = ri + 1; rj < current.routes.length; rj++) {
        if (deadline !== undefined && Date.now() > deadline) break outerSwap
        const routeJ = current.routes[rj]
        if (routeJ.missions.length === 0) continue
        const dJ = driverMap.get(routeJ.driverId)

        const baseCost = computeRouteCost(routeI, ctx, drivers) +
                         computeRouteCost(routeJ, ctx, drivers)

        for (let mi = 0; mi < routeI.missions.length; mi++) {
          for (let mj = 0; mj < routeJ.missions.length; mj++) {
            const missionI = routeI.missions[mi]
            const missionJ = routeJ.missions[mj]

            if (dI && !isHfvrpCompatible(missionJ, dI)) continue
            if (dJ && !isHfvrpCompatible(missionI, dJ)) continue

            const routeIWithoutI = routeI.missions.filter((_, idx) => idx !== mi)
            const routeJWithoutJ = routeJ.missions.filter((_, idx) => idx !== mj)
            if (!isAllerRetourCompatible(routeIWithoutI, missionJ.type)) continue
            if (!isAllerRetourCompatible(routeJWithoutJ, missionI.type)) continue

            const newRouteMissionsI = [...routeI.missions]
            const newRouteMissionsJ = [...routeJ.missions]
            newRouteMissionsI[mi] = missionJ
            newRouteMissionsJ[mj] = missionI

            const newCost =
              computeRouteCost({ driverId: routeI.driverId, missions: newRouteMissionsI }, ctx, drivers) +
              computeRouteCost({ driverId: routeJ.driverId, missions: newRouteMissionsJ }, ctx, drivers)

            if (newCost < baseCost - 0.01) {
              current.routes[ri] = { driverId: routeI.driverId, missions: newRouteMissionsI }
              current.routes[rj] = { driverId: routeJ.driverId, missions: newRouteMissionsJ }
              improved = true
              break outerSwap
            }
          }
        }
      }
    }
  }

  return current
}

export function intraRoute2Opt(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  deadline?: number,
): VRPSolution {
  const MAX_SEG_LEN = 8

  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost:   solution.cost,
  }

  for (const route of current.routes) {
    const n = route.missions.length
    if (n < 3) continue

    const dontLook = new Uint8Array(n)

    let improved = true
    while (improved) {
      if (deadline !== undefined && Date.now() > deadline) return current
      improved = false
      const baseCost = computeRouteCost(route, ctx, drivers)

      outerLoop2opt: for (let i = 0; i < n - 1; i++) {
        if (dontLook[i]) continue
        const jMax = Math.min(n - 1, i + MAX_SEG_LEN)
        let foundImprovement = false

        for (let j = i + 2; j <= jMax; j++) {
          if (deadline !== undefined && Date.now() > deadline) return current

          const newMissions = [
            ...route.missions.slice(0, i),
            ...route.missions.slice(i, j + 1).reverse(),
            ...route.missions.slice(j + 1),
          ]
          const newCost = computeRouteCost(
            { driverId: route.driverId, missions: newMissions },
            ctx, drivers,
          )
          if (newCost < baseCost - 0.01) {
            route.missions = newMissions
            improved = true
            foundImprovement = true

            for (let x = Math.max(0, i - 1); x <= Math.min(n - 1, j + 1); x++) dontLook[x] = 0
            break outerLoop2opt
          }
        }

        if (!foundImprovement) dontLook[i] = 1
      }
    }
  }

  return current
}

export function intraRouteOrOpt(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  deadline?: number,
): VRPSolution {
  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost:   solution.cost,
  }

  for (const route of current.routes) {
    if (route.missions.length < 3) continue

    for (const segSize of [1, 2, 3]) {
      let improved = true
      while (improved) {
        if (deadline !== undefined && Date.now() > deadline) return current
        improved = false
        const n = route.missions.length
        if (n < segSize + 1) break
        const baseCost = computeRouteCost(route, ctx, drivers)

        outerOrOpt: for (let i = 0; i + segSize <= n; i++) {
          const segment   = route.missions.slice(i, i + segSize)
          const withoutSeg: Mission[] = [
            ...route.missions.slice(0, i),
            ...route.missions.slice(i + segSize),
          ]

          const variants: Mission[][] = segSize >= 2
            ? [segment, [...segment].reverse()]
            : [segment]

          for (const seg of variants) {
            const isSameOrder = seg === segment
            for (let j = 0; j <= withoutSeg.length; j++) {

              if (isSameOrder && j === i) continue
              if (deadline !== undefined && Date.now() > deadline) return current

              const newMissions: Mission[] = [
                ...withoutSeg.slice(0, j),
                ...seg,
                ...withoutSeg.slice(j),
              ]
              const newCost = computeRouteCost(
                { driverId: route.driverId, missions: newMissions },
                ctx, drivers,
              )
              if (newCost < baseCost - 0.01) {
                route.missions = newMissions
                improved = true
                break outerOrOpt
              }
            }
          }
        }
      }
    }
  }

  return current
}

export function perturbDoubleBridge(
  solution: VRPSolution,
  ctx:      CostContext,
  drivers:  Driver[],
  rng:      SeededRng,
): VRPSolution {

  let bestRouteIdx = -1
  let bestCost     = -Infinity

  for (let ri = 0; ri < solution.routes.length; ri++) {
    const route = solution.routes[ri]
    if (route.missions.length < 4) continue
    const cost = computeRouteCost(route, ctx, drivers)
    if (cost > bestCost) {
      bestCost     = cost
      bestRouteIdx = ri
    }
  }

  if (bestRouteIdx < 0) return solution

  const route = solution.routes[bestRouteIdx]
  const n     = route.missions.length

  const i1 = 1 + rng.int(n - 3)
  const i2 = i1 + 1 + rng.int(n - i1 - 2)
  const i3 = i2 + 1 + rng.int(n - i2 - 1)

  if (i1 >= i2 || i2 >= i3 || i3 >= n) return solution

  const A = route.missions.slice(0, i1)
  const B = route.missions.slice(i1, i2)
  const C = route.missions.slice(i2, i3)
  const D = route.missions.slice(i3)

  const newMissions = [...A, ...C, ...B, ...D]

  return {
    routes: solution.routes.map((r, ri) =>
      ri === bestRouteIdx
        ? { driverId: r.driverId, missions: newMissions }
        : { driverId: r.driverId, missions: [...r.missions] },
    ),
    cost: 0,
  }
}

export function nearestDriverIdx(
  lat: number,
  lng: number,
  drivers: Driver[],
): number {

  if (drivers.length === 0) return -1
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < drivers.length; i++) {
    const d = cachedDist(lat, lng, drivers[i].depotLat, drivers[i].depotLng)
    if (d < bestD) {
      bestD = d
      best  = i
    }
  }
  return best
}

export function threeOptOnWorstRoutes(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  maxRoutes: number = 5,
  deadline?: number,
): VRPSolution {
  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  const routeCosts = current.routes.map((r, i) => ({
    idx: i,
    cost: computeRouteCost(r, ctx, drivers),
    n: r.missions.length,
  }))
  routeCosts.sort((a, b) => b.cost - a.cost)

  const targetRoutes = routeCosts
    .filter(r => r.n >= 4)
    .slice(0, maxRoutes)

  for (const { idx: routeIdx } of targetRoutes) {
    if (deadline && Date.now() > deadline) break

    const route = current.routes[routeIdx]
    const n = route.missions.length
    if (n < 4) continue

    let improved = true
    while (improved) {
      improved = false
      if (deadline && Date.now() > deadline) break

      for (let i = 0; i < n - 2 && !improved; i++) {
        for (let j = i + 1; j < n - 1 && !improved; j++) {
          for (let k = j + 1; k < n && !improved; k++) {
            if (deadline && Date.now() > deadline) break

            const original = [...route.missions]
            const baseCost = computeRouteCost(route, ctx, drivers)

            const candidate1 = [
              ...original.slice(0, i + 1),
              ...original.slice(i + 1, j + 1).reverse(),
              ...original.slice(j + 1),
            ]

            const candidate2 = [
              ...original.slice(0, j + 1),
              ...original.slice(j + 1, k + 1).reverse(),
              ...original.slice(k + 1),
            ]

            const candidate3 = [
              ...original.slice(0, i + 1),
              ...original.slice(j + 1, k + 1),
              ...original.slice(i + 1, j + 1),
              ...original.slice(k + 1),
            ]

            for (const candidate of [candidate1, candidate2, candidate3]) {
              route.missions = candidate
              const newCost = computeRouteCost(route, ctx, drivers)
              if (newCost < baseCost - 0.1) {

                improved = true
                break
              }
            }

            if (!improved) {
              route.missions = original
            }
          }
        }
      }
    }
  }

  current.cost = current.routes.reduce(
    (sum, r) => sum + computeRouteCost(r, ctx, drivers), 0,
  )

  return current
}

export function destroyWorstRoutes(
  solution: VRPSolution,
  k: number,
  ctx: CostContext,
  drivers: Driver[],
  rng: { next(): number },
): { destroyed: VRPSolution; removed: Mission[] } {
  const removed: Mission[] = []
  const destroyed: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  const routeScores = destroyed.routes
    .map((route, idx) => {
      if (route.missions.length === 0) return { idx, costPerMission: 0 }
      const cost = computeRouteCost(route, ctx, drivers)
      return { idx, costPerMission: cost / route.missions.length }
    })
    .filter(r => r.costPerMission > 0)
    .sort((a, b) => b.costPerMission - a.costPerMission)

  const targetCount = Math.max(1, Math.ceil(routeScores.length * 0.4))
  const targetRouteIndices = new Set(routeScores.slice(0, targetCount).map(r => r.idx))

  const candidates: { routeIdx: number; missionIdx: number; marginalCost: number }[] = []

  for (const ri of targetRouteIndices) {
    const route = destroyed.routes[ri]
    const baseCost = computeRouteCost(route, ctx, drivers)

    for (let mi = 0; mi < route.missions.length; mi++) {

      const without = { driverId: route.driverId, missions: [...route.missions.slice(0, mi), ...route.missions.slice(mi + 1)] }
      const costWithout = without.missions.length > 0 ? computeRouteCost(without, ctx, drivers) : 0
      candidates.push({
        routeIdx: ri,
        missionIdx: mi,
        marginalCost: baseCost - costWithout,
      })
    }
  }

  for (const cand of candidates) {
    const noise = (rng.next() - 0.5) * 0.3
    ;(cand as typeof cand & { noisyScore: number }).noisyScore = cand.marginalCost + cand.marginalCost * noise
  }
  candidates.sort((a, b) =>
    (b as typeof b & { noisyScore: number }).noisyScore - (a as typeof a & { noisyScore: number }).noisyScore
  )

  const toRemove = Math.min(k, candidates.length)
  const removedSet = new Set<string>()

  for (let i = 0; i < toRemove; i++) {
    const c = candidates[i]
    const route = destroyed.routes[c.routeIdx]

    const mission = route.missions[c.missionIdx]
    if (mission && !removedSet.has(mission.id)) {
      removedSet.add(mission.id)
      removed.push(mission)
    }
  }

  for (const route of destroyed.routes) {
    route.missions = route.missions.filter(m => !removedSet.has(m.id))
  }

  return { destroyed, removed }
}

export function destroyString(
  solution: VRPSolution,
  k: number,
  rng: SeededRng,
): { partial: VRPSolution; removed: Mission[] } {
  const partial: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: 0,
  }
  const removed: Mission[] = []
  let remaining = Math.min(k, solution.routes.reduce((s, r) => s + r.missions.length, 0))

  while (remaining > 0) {

    const routeWeights = partial.routes.map(r => r.missions.length)
    const totalWeight = routeWeights.reduce((a, b) => a + b, 0)
    if (totalWeight === 0) break

    let pick = rng.next() * totalWeight
    let ri = 0
    for (; ri < routeWeights.length - 1; ri++) {
      pick -= routeWeights[ri]
      if (pick <= 0) break
    }

    const route = partial.routes[ri]
    if (route.missions.length === 0) continue

    const maxSeg = Math.min(5, route.missions.length, remaining)
    const segLen = maxSeg <= 1 ? 1 : 2 + rng.int(Math.max(1, maxSeg - 1))
    const actualSeg = Math.min(segLen, route.missions.length)

    const start = rng.int(Math.max(1, route.missions.length - actualSeg + 1))

    const segment = route.missions.splice(start, actualSeg)
    removed.push(...segment)
    remaining -= segment.length
  }

  return { partial, removed }
}

export function destroyViolated(
  solution: VRPSolution,
  k: number,
  ctx: CostContext,
  drivers: Driver[],
): { partial: VRPSolution; removed: Mission[] } {
  const driverMap = new Map(drivers.map(d => [d.id, d]))
  const violations: Array<{ routeIdx: number; missionIdx: number; severity: number }> = []

  for (let ri = 0; ri < solution.routes.length; ri++) {
    const route = solution.routes[ri]
    const driver = driverMap.get(route.driverId)
    if (!driver || route.missions.length === 0) continue

    const startOverride = ctx.driverStartOverrides?.get(route.driverId)
    let currentMin = startOverride?.timeMin ?? ctx.startTimeMin
    let lat = startOverride?.lat ?? driver.depotLat
    let lng = startOverride?.lng ?? driver.depotLng
    let cumWork = 0

    for (let mi = 0; mi < route.missions.length; mi++) {
      const m = route.missions[mi]
      const dist = cachedDist(lat, lng, m.latitude, m.longitude)
      const travelMin = (dist / Math.max(10, ctx.speedKmh)) * 60
      currentMin += travelMin
      cumWork += travelMin

      let severity = 0

      if (m.timeWindow && currentMin > m.timeWindow.closeMin) {
        severity += (currentMin - m.timeWindow.closeMin) * 2
      }

      if (m.priority === 1) {
        const deadline = Math.max(600, (startOverride?.timeMin ?? ctx.startTimeMin) + 240)
        if (currentMin > deadline) {
          severity += (currentMin - deadline) * 5
        }
      }

      const onSite = (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0)
      cumWork += onSite
      if (cumWork > 600) {
        severity += (cumWork - 600) * 1
      }

      if (severity > 0) {
        violations.push({ routeIdx: ri, missionIdx: mi, severity })
      }

      currentMin += onSite
      lat = m.latitude; lng = m.longitude
    }
  }

  violations.sort((a, b) => b.severity - a.severity)
  const toRemove = violations.slice(0, k)

  const partial: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: 0,
  }
  const removed: Mission[] = []

  const byRoute = new Map<number, number[]>()
  for (const v of toRemove) {
    if (!byRoute.has(v.routeIdx)) byRoute.set(v.routeIdx, [])
    byRoute.get(v.routeIdx)!.push(v.missionIdx)
  }

  for (const [ri, indices] of byRoute) {
    indices.sort((a, b) => b - a)
    for (const mi of indices) {
      if (mi < partial.routes[ri].missions.length) {
        removed.push(...partial.routes[ri].missions.splice(mi, 1))
      }
    }
  }

  if (removed.length < k) {
    const remaining = k - removed.length
    const allMissions: Array<{ ri: number; mi: number; cost: number }> = []
    for (let ri = 0; ri < partial.routes.length; ri++) {
      for (let mi = 0; mi < partial.routes[ri].missions.length; mi++) {
        const m = partial.routes[ri].missions[mi]

        allMissions.push({ ri, mi, cost: (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0) })
      }
    }

    allMissions.sort((a, b) => b.cost - a.cost)
    const toRemoveExtra = allMissions.slice(0, remaining)

    const byRouteExtra = new Map<number, number[]>()
    for (const { ri, mi } of toRemoveExtra) {
      if (!byRouteExtra.has(ri)) byRouteExtra.set(ri, [])
      byRouteExtra.get(ri)!.push(mi)
    }
    for (const [ri, indices] of byRouteExtra) {
      indices.sort((a, b) => b - a)
      for (const mi of indices) {
        if (mi < partial.routes[ri].missions.length) {
          removed.push(...partial.routes[ri].missions.splice(mi, 1))
        }
      }
    }
  }

  return { partial, removed }
}

export function ejectionChainSearch(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  deadline?: number,
  maxDepth = 3,
): VRPSolution {
  const current: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  const driverMap = new Map(drivers.map(d => [d.id, d]))
  let improved = true

  while (improved) {
    if (deadline !== undefined && Date.now() > deadline) break
    improved = false

    for (let ri = 0; ri < current.routes.length; ri++) {
      if (deadline !== undefined && Date.now() > deadline) break
      const routeI = current.routes[ri]
      if (routeI.missions.length === 0) continue

      const costI = computeRouteCost(routeI, ctx, drivers)

      for (let mi = 0; mi < routeI.missions.length; mi++) {
        if (deadline !== undefined && Date.now() > deadline) break

        const missionToEject = routeI.missions[mi]

        for (let rj = 0; rj < current.routes.length; rj++) {
          if (ri === rj) continue
          if (deadline !== undefined && Date.now() > deadline) break

          const routeJ = current.routes[rj]
          const dJ = driverMap.get(routeJ.driverId)
          if (dJ && !isHfvrpCompatible(missionToEject, dJ)) continue
          if (!isAllerRetourCompatible(routeJ.missions, missionToEject.type)) continue

          const costJ = computeRouteCost(routeJ, ctx, drivers)

          const routeIWithout = {
            driverId: routeI.driverId,
            missions: routeI.missions.filter((_, idx) => idx !== mi),
          }
          const costIWithout = computeRouteCost(routeIWithout, ctx, drivers)

          for (let pos = 0; pos <= routeJ.missions.length; pos++) {
            const routeJWith = {
              driverId: routeJ.driverId,
              missions: [
                ...routeJ.missions.slice(0, pos),
                missionToEject,
                ...routeJ.missions.slice(pos),
              ],
            }
            const costJWith = computeRouteCost(routeJWith, ctx, drivers)

            if (costIWithout + costJWith < costI + costJ - 0.1) {

              current.routes[ri] = routeIWithout
              current.routes[rj] = routeJWith
              improved = true
              break
            }

            if (maxDepth >= 2 && costJWith > costJ && routeJ.missions.length > 0) {
              const _overCostJ = costJWith - costJ

              for (let mj = 0; mj < routeJ.missions.length; mj++) {
                if (deadline !== undefined && Date.now() > deadline) break
                const ejectFromJ = routeJ.missions[mj]

                for (let rk = 0; rk < current.routes.length; rk++) {
                  if (rk === ri || rk === rj) continue
                  const routeK = current.routes[rk]
                  const dK = driverMap.get(routeK.driverId)
                  if (dK && !isHfvrpCompatible(ejectFromJ, dK)) continue
                  if (!isAllerRetourCompatible(routeK.missions, ejectFromJ.type)) continue

                  const costK = computeRouteCost(routeK, ctx, drivers)

                  const tempMissions = [...routeJ.missions]
                  tempMissions.splice(pos, 0, missionToEject)

                  const ejIdx = mj >= pos ? mj + 1 : mj
                  tempMissions.splice(ejIdx, 1)

                  const routeJChain = {
                    driverId: routeJ.driverId,
                    missions: tempMissions,
                  }

                  const costJChain = computeRouteCost(routeJChain, ctx, drivers)

                  let bestKCost = Infinity
                  let bestKPos = 0
                  for (let pk = 0; pk <= routeK.missions.length; pk++) {
                    const routeKWith = {
                      driverId: routeK.driverId,
                      missions: [
                        ...routeK.missions.slice(0, pk),
                        ejectFromJ,
                        ...routeK.missions.slice(pk),
                      ],
                    }
                    const ckw = computeRouteCost(routeKWith, ctx, drivers)
                    if (ckw < bestKCost) {
                      bestKCost = ckw
                      bestKPos = pk
                    }
                  }

                  const before = costI + costJ + costK
                  const after = costIWithout + costJChain + bestKCost
                  if (after < before - 0.1) {
                    current.routes[ri] = routeIWithout
                    current.routes[rj] = routeJChain
                    current.routes[rk] = {
                      driverId: routeK.driverId,
                      missions: [
                        ...routeK.missions.slice(0, bestKPos),
                        ejectFromJ,
                        ...routeK.missions.slice(bestKPos),
                      ],
                    }
                    improved = true
                    break
                  }
                }
                if (improved) break
              }
            }
            if (improved) break
          }
          if (improved) break
        }
        if (improved) break
      }
    }
  }

  return current
}
