import { travelTimeMin } from '@/lib/algorithm'
import { getFamiliarityBonus } from '@/lib/familiarityLoader'
import { realDurationMin } from './realDistance'
import {
  penaltyForLate,
  penaltyForP1Late,
  MAX_CONTINUOUS_MIN,
  BREAK_DURATION_MIN,
  MAX_WORK_MIN,
  P1_DEADLINE_MIN,
} from '@/lib/constraints'
import type { Driver, Mission, Exutoire } from '@/lib/types'
import type { Route, RouteCache, CostContext } from './types'
import { findBestExutoire } from './exutoireSearch'
import { cachedDist } from './distanceCache'
import { isHfvrpCompatible } from './hfvrp'

function effectiveCapacity(driver: Driver): number {
  const dims = driver.capacityDimensions
  if (dims) {

    if (dims.nbBennes) return Math.max(1, dims.nbBennes)
    if (dims.volume && driver.maxBinSizeM3) {
      return Math.max(1, Math.floor(dims.volume / driver.maxBinSizeM3))
    }
  }
  return Math.max(1, driver.vehicleCapacity ?? 1)
}

const _dowCache = new Map<string, number>()
function cachedDow(date: string): number {
  let dow = _dowCache.get(date)
  if (dow !== undefined) return dow
  const [y, mo, d] = date.split('-').map(Number)
  dow = new Date(y, mo - 1, d).getDay()
  _dowCache.set(date, dow)
  if (_dowCache.size > 100) {

    const first = _dowCache.keys().next().value
    if (first !== undefined) _dowCache.delete(first)
  }
  return dow
}

export interface VrpCostConfig {
  overtimePenalty: number
  overtimePerMin: number
  closedExutoirePenalty: number
  distanceCostFactor: number
  nearmaxStartMin: number
  nearmaxPerMin: number
  balancePenaltyWeight: number

  fixedRouteCost: number

  lunchBreakStartMin: number

  lunchBreakEndMin: number

  lunchBreakDurationMin: number

  lunchBreakPenalty: number
}

const DEFAULT_VRP_COST_CONFIG: VrpCostConfig = {
  overtimePenalty:       30_000,
  overtimePerMin:        300,
  closedExutoirePenalty: 800,
  distanceCostFactor:    1.5,
  nearmaxStartMin:       540,
  nearmaxPerMin:         20,
  balancePenaltyWeight:  0.8,
  fixedRouteCost:        50,
  lunchBreakStartMin:    720,
  lunchBreakEndMin:      810,
  lunchBreakDurationMin: 30,
  lunchBreakPenalty:     80,
}

export function createVrpCostConfig(config?: Partial<VrpCostConfig>): VrpCostConfig {
  if (!config) return { ...DEFAULT_VRP_COST_CONFIG }
  return {
    overtimePenalty:       config.overtimePenalty       ?? DEFAULT_VRP_COST_CONFIG.overtimePenalty,
    overtimePerMin:        config.overtimePerMin        ?? DEFAULT_VRP_COST_CONFIG.overtimePerMin,
    closedExutoirePenalty: config.closedExutoirePenalty  ?? DEFAULT_VRP_COST_CONFIG.closedExutoirePenalty,
    distanceCostFactor:    config.distanceCostFactor     ?? DEFAULT_VRP_COST_CONFIG.distanceCostFactor,
    nearmaxStartMin:       config.nearmaxStartMin        ?? DEFAULT_VRP_COST_CONFIG.nearmaxStartMin,
    nearmaxPerMin:         config.nearmaxPerMin           ?? DEFAULT_VRP_COST_CONFIG.nearmaxPerMin,
    balancePenaltyWeight:  config.balancePenaltyWeight    ?? DEFAULT_VRP_COST_CONFIG.balancePenaltyWeight,
    fixedRouteCost:        config.fixedRouteCost          ?? DEFAULT_VRP_COST_CONFIG.fixedRouteCost,
    lunchBreakStartMin:    config.lunchBreakStartMin      ?? DEFAULT_VRP_COST_CONFIG.lunchBreakStartMin,
    lunchBreakEndMin:      config.lunchBreakEndMin        ?? DEFAULT_VRP_COST_CONFIG.lunchBreakEndMin,
    lunchBreakDurationMin: config.lunchBreakDurationMin   ?? DEFAULT_VRP_COST_CONFIG.lunchBreakDurationMin,
    lunchBreakPenalty:     config.lunchBreakPenalty        ?? DEFAULT_VRP_COST_CONFIG.lunchBreakPenalty,
  }
}

function cfg(costCfg?: VrpCostConfig, ctx?: CostContext): VrpCostConfig {
  if (costCfg) return costCfg
  if (ctx?.costConfig) return createVrpCostConfig(ctx.costConfig)
  return DEFAULT_VRP_COST_CONFIG
}

export function computeSolutionCost(
  routes: Route[],
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): number {
  if (routes.length === 0) return 0

  const c = cfg(costCfg, ctx)

  const driverMap = new Map<string, Driver>()
  for (const d of drivers) driverMap.set(d.id, d)

  let totalCost = 0
  const routeWorkMins: number[] = []
  let activeRouteCount = 0

  for (const route of routes) {
    const cost = computeRouteCost(route, ctx, drivers, costCfg)
    totalCost += cost
    if (route.missions.length > 0) activeRouteCount++

    const driver = driverMap.get(route.driverId)
    if (!driver || route.missions.length === 0) {
      routeWorkMins.push(0)
      continue
    }
    let workEst = 0
    let lat = driver.depotLat, lng = driver.depotLng
    for (const m of route.missions) {
      const dist = cachedDist(lat, lng, m.latitude, m.longitude)
      workEst += (dist / Math.max(10, ctx.speedKmh)) * 60 + (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0)
      lat = m.latitude; lng = m.longitude
    }
    routeWorkMins.push(workEst)
  }

  const wBal = Math.max(0, ctx.weights?.balance ?? 0.3)
  const activeRoutes = routeWorkMins.filter(wk => wk > 0)
  if (activeRoutes.length >= 2 && wBal > 0) {
    const mean = activeRoutes.reduce((a, b) => a + b, 0) / activeRoutes.length
    if (mean > 0.001) {
      const variance = activeRoutes.reduce((s, v) => s + (v - mean) ** 2, 0) / activeRoutes.length
      const cv = Math.sqrt(variance) / mean

      totalCost += cv * mean * c.balancePenaltyWeight * activeRoutes.length * (1 + wBal)

      const maxWork = Math.max(...activeRoutes)
      const minWork = Math.min(...activeRoutes)
      const ratio = maxWork / Math.max(1, minWork)
      if (ratio > 2) {
        totalCost += (ratio - 2) ** 2 * 50 * c.balancePenaltyWeight * (1 + wBal)
      }

      const inactiveCount = routeWorkMins.filter(wk => wk === 0).length
      if (inactiveCount > 0 && routeWorkMins.some(wk => wk > 60)) {
        totalCost += inactiveCount * 200 * c.balancePenaltyWeight * (1 + wBal * 2)
      }
    }
  }

  totalCost += activeRouteCount * c.fixedRouteCost

  return totalCost
}

function isBinMission(type: string): boolean {
  return type === 'RETIRER' || type === 'ECHANGER' || type === 'CHARGER_IMMEDIAT'
}

export function isAllerRetourCompatible(
  routeMissions: { type: string }[],
  missionType: string,
): boolean {
  if (missionType === 'ALLER_RETOUR') return routeMissions.length === 0
  return !routeMissions.some(m => m.type === 'ALLER_RETOUR')
}

function lastBinIndex(missions: { type: string }[]): number {
  for (let j = missions.length - 1; j >= 0; j--) {
    if (isBinMission(missions[j].type)) return j
  }
  return -1
}

const _driverMapWeakCache = new WeakMap<Driver[], Map<string, Driver>>()

function getDriverMap(drivers: Driver[]): Map<string, Driver> {
  let cached = _driverMapWeakCache.get(drivers)
  if (cached) return cached
  cached = new Map(drivers.map(d => [d.id, d]))
  _driverMapWeakCache.set(drivers, cached)
  return cached
}

/** Everything a route simulation needs that does not change from one mission to the next. */
interface SimEnv {
  ctx:                 CostContext
  c:                   VrpCostConfig
  driver:              Driver
  driverId:            string
  dow:                 number
  wPunct:              number
  wDistance:           number
  skillWeight:         number
  driverSkills:        Set<string>
  stabilityW:          number
  effectiveP1Deadline: number
  capacity:            number
  startLat:            number
  startLng:            number
  startTimeMin:        number
  hasStartOverride:    boolean
}

function makeEnv(driverId: string, ctx: CostContext, drivers: Driver[], costCfg?: VrpCostConfig): SimEnv | null {
  const driver = getDriverMap(drivers).get(driverId)
  if (!driver) return null
  const startOverride = ctx.driverStartOverrides?.get(driverId)
  const startTimeMin  = startOverride?.timeMin ?? ctx.startTimeMin
  const w = ctx.weights ?? { distance: 0.5, punctuality: 0.5, balance: 0.3 }
  const wPunct = Math.max(0.1, w.punctuality)
  return {
    ctx,
    c:                   cfg(costCfg, ctx),
    driver,
    driverId,
    dow:                 cachedDow(ctx.date),
    wPunct,
    wDistance:           Math.max(0.1, w.distance),
    skillWeight:         Math.max(0.5, wPunct),
    driverSkills:        new Set(driver.skills ?? []),
    stabilityW:          ctx.weights?.stability ?? 0,
    effectiveP1Deadline: Math.min(1320, Math.max(P1_DEADLINE_MIN, startTimeMin + 240)),
    capacity:            effectiveCapacity(driver),
    startLat:            startOverride?.lat ?? driver.depotLat,
    startLng:            startOverride?.lng ?? driver.depotLng,
    startTimeMin,
    hasStartOverride:    !!startOverride,
  }
}

/**
 * Simulation state of a route before a given mission (index k = state once missions 0..k-1 are
 * done). `partialCost` is everything accrued so far except the skill penalty and the end-of-route
 * terms (return trip, driving cost, work-time, lunch) — see {@link finishRoute}.
 */
export interface RoutePrefixState {
  currentMin:        number
  currentLat:        number
  currentLng:        number
  currentId?:        string
  continuousDriving: number
  cumWorkMin:        number
  cumDrivingMin:     number
  partialCost:       number
  binsUsed:          number
  emptyBins:         number
  echangersPending:  number
  prevDirLat:        number
  prevDirLng:        number
  started:           boolean
}

function initialState(env: SimEnv): RoutePrefixState {
  return {
    currentMin:        env.startTimeMin,
    currentLat:        env.startLat,
    currentLng:        env.startLng,
    // A mid-day start is the driver's live position, not the depot: no matrix id for it.
    currentId:         env.hasStartOverride ? undefined : `depot:${env.driverId}`,
    continuousDriving: 0,
    cumWorkMin:        0,
    cumDrivingMin:     0,
    partialCost:       0,
    binsUsed:          0,
    emptyBins:         env.capacity,
    echangersPending:  0,
    prevDirLat:        0,
    prevDirLng:        0,
    started:           false,
  }
}

/** Per-mission penalties that do not depend on the position in the route: missing skills, a bin the truck cannot carry. */
function skillPenalty(env: SimEnv, m: Mission): number {
  let p = isHfvrpCompatible(m, env.driver) ? 0 : 50_000
  if (!m.requiredSkills || m.requiredSkills.length === 0) return p
  for (const skill of m.requiredSkills) if (!env.driverSkills.has(skill)) p += 10_000 * env.skillWeight
  return p
}

function dependencyIndex(missions: Mission[]): Map<string, number> | null {
  if (!missions.some(m => m.dependsOnId)) return null
  const idx = new Map<string, number>()
  for (let i = 0; i < missions.length; i++) idx.set(missions[i].id, i)
  return idx
}

/** Drives to an exutoire, waits for opening, unloads. Returns the cost incurred. */
function visitExutoire(s: RoutePrefixState, env: SimEnv, ex: Exutoire): void {
  const exId = `exu:${ex.id}`
  const travel = realDurationMin(env.ctx, s.currentId, s.currentLat, s.currentLng, exId, ex.lat, ex.lng, s.currentMin)
  let brk = 0
  if (s.continuousDriving + travel > MAX_CONTINUOUS_MIN) {
    brk = BREAK_DURATION_MIN
    s.continuousDriving = 0
  }
  s.currentMin        += travel + brk
  s.continuousDriving += travel
  s.cumDrivingMin     += travel
  s.cumWorkMin        += travel + brk
  if (s.currentMin < ex.openingHoursOpen) {
    s.cumWorkMin += ex.openingHoursOpen - s.currentMin
    s.currentMin  = ex.openingHoursOpen
  }
  if (ex.closedDays.includes(env.dow)) {
    s.partialCost += env.c.closedExutoirePenalty
  } else if (s.currentMin > ex.openingHoursClose) {
    s.partialCost += penaltyForLate(s.currentMin - ex.openingHoursClose)
  }
  s.cumWorkMin += ex.serviceTimeMin
  s.currentMin += ex.serviceTimeMin
  s.continuousDriving = 0
}

/** Advances `s` over missions[i] (travel, waits, windows, service, bins, exutoire trips). */
function stepMission(
  s: RoutePrefixState,
  env: SimEnv,
  missions: Mission[],
  i: number,
  lastBinIdx: number,
  depIdx: Map<string, number> | null,
): void {
  const mission = missions[i]
  const { ctx } = env

  if (s.started) {
    const dirLat = mission.latitude - s.currentLat
    const dirLng = mission.longitude - s.currentLng
    if (s.prevDirLat !== 0 || s.prevDirLng !== 0) {
      const dot = dirLat * s.prevDirLat + dirLng * s.prevDirLng
      const mag1 = Math.sqrt(dirLat * dirLat + dirLng * dirLng)
      const mag2 = Math.sqrt(s.prevDirLat * s.prevDirLat + s.prevDirLng * s.prevDirLng)
      if (mag1 > 0.001 && mag2 > 0.001) {
        const cosAngle = dot / (mag1 * mag2)
        if (cosAngle < -0.5) s.partialCost += 15
        else if (cosAngle < 0) s.partialCost += 5
      }
    }
    s.prevDirLat = dirLat
    s.prevDirLng = dirLng
  }
  s.started = true

  if (mission.dependsOnId && depIdx) {
    const d = depIdx.get(mission.dependsOnId) ?? -1
    if (d >= 0 && d > i) s.partialCost += 5000
  }

  const travelMin = realDurationMin(ctx, s.currentId, s.currentLat, s.currentLng, mission.id, mission.latitude, mission.longitude, s.currentMin)
  let breakMin = 0
  if (s.continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {
    breakMin = BREAK_DURATION_MIN
    s.continuousDriving = 0
  }
  s.currentMin        += travelMin + breakMin
  s.continuousDriving += travelMin
  s.cumDrivingMin     += travelMin
  s.cumWorkMin        += travelMin + breakMin

  const tw = mission.timeWindow && mission.timeWindow.closeMin >= mission.timeWindow.openMin ? mission.timeWindow : undefined
  if (tw && s.currentMin < tw.openMin) {
    const waitMin = tw.openMin - s.currentMin
    if (waitMin > 15) s.partialCost += (waitMin - 15) * 0.5
    s.cumWorkMin += waitMin
    s.currentMin  = tw.openMin
  }
  const arrivalMin = s.currentMin

  if (tw) {
    const windowDuration = tw.closeMin - tw.openMin
    if (arrivalMin <= tw.closeMin) {
      const slackRatio = windowDuration > 0 ? (tw.closeMin - arrivalMin) / windowDuration : 0
      s.partialCost -= Math.min(10, slackRatio * 20)
    } else {
      const lateMin = arrivalMin - tw.closeMin
      if (lateMin <= 15) {
        s.partialCost += lateMin * 3 * env.wPunct
      } else if (lateMin <= 60) {
        s.partialCost += (15 * 3 + penaltyForLate(lateMin - 15)) * env.wPunct
      } else {
        s.partialCost += (15 * 3 + penaltyForLate(45) + (lateMin - 60) * 15) * env.wPunct
      }
    }
  }

  if (mission.priority === 1 && arrivalMin > env.effectiveP1Deadline) {
    s.partialCost += penaltyForP1Late(arrivalMin - env.effectiveP1Deadline) * env.wPunct
  }

  if (env.stabilityW > 0 && ctx.familiarity) {
    s.partialCost += getFamiliarityBonus(ctx.familiarity, env.driverId, mission.siteId, env.stabilityW)
  }

  const onSiteMin = Math.max(0, mission.estimatedDurationMin ?? 0) + Math.max(0, mission.maneuverTimeMin ?? 0)
  s.cumWorkMin += onSiteMin
  s.currentMin += onSiteMin
  s.currentLat  = mission.latitude
  s.currentLng  = mission.longitude
  s.currentId   = mission.id

  if (mission.type === 'POSER') {
    if (s.emptyBins <= 0) s.partialCost += 50_000
    else s.emptyBins--
  }

  if (isBinMission(mission.type)) {
    s.binsUsed++
    if (mission.type === 'ECHANGER') {
      if (s.emptyBins <= 0) s.partialCost += 50_000
      else { s.emptyBins--; s.echangersPending++ }
    }

    const nextM = missions[i + 1]
    const nextNeedsEmpty = nextM && (nextM.type === 'POSER' || nextM.type === 'ECHANGER')
    const needsExutoire = s.binsUsed >= env.capacity || i >= lastBinIdx ||
      (s.emptyBins <= 0 && nextNeedsEmpty && s.echangersPending > 0)

    if (needsExutoire) {
      const ex = findBestExutoire(
        mission.latitude, mission.longitude,
        mission.linkedExutoireId,
        mission.wasteTypeLabel,
        ctx.exutoires,
        env.dow,
        undefined, undefined, false,
      )
      if (ex) {
        visitExutoire(s, env, ex)
        s.currentLat = ex.lat
        s.currentLng = ex.lng
        s.currentId  = `exu:${ex.id}`
      } else {
        s.partialCost += 500
      }
      s.binsUsed          = 0
      s.emptyBins        += s.echangersPending
      s.echangersPending  = 0
    }
  }

  if (mission.type === 'ALLER_RETOUR') {
    const ex = findBestExutoire(
      mission.latitude, mission.longitude,
      mission.linkedExutoireId,
      mission.wasteTypeLabel,
      ctx.exutoires,
      env.dow,
      undefined, undefined, false,
    )
    if (ex) {
      visitExutoire(s, env, ex)
      const fromEx = realDurationMin(ctx, `exu:${ex.id}`, ex.lat, ex.lng, mission.id, mission.latitude, mission.longitude, s.currentMin)
      let brk = 0
      if (s.continuousDriving + fromEx > MAX_CONTINUOUS_MIN) {
        brk = BREAK_DURATION_MIN
        s.continuousDriving = 0
      }
      s.currentMin        += fromEx + brk
      s.continuousDriving += fromEx
      s.cumDrivingMin     += fromEx
      s.cumWorkMin        += fromEx + brk
      s.currentLat = mission.latitude
      s.currentLng = mission.longitude
      s.currentId  = mission.id
    } else {
      s.partialCost += 500
    }
  }
}

/**
 * Closes the route: return to the depot, driving cost, near-max / overtime, lunch gap. Takes a
 * copy-free view of the state (does not mutate it) and returns the route's total cost.
 */
function finishRoute(s: RoutePrefixState, env: SimEnv, missions: Mission[], skillCost: number): number {
  const { c, driver } = env
  const returnTravel = realDurationMin(env.ctx, s.currentId, s.currentLat, s.currentLng, `depot:${env.driverId}`, driver.depotLat, driver.depotLng, s.currentMin)
  const returnBreak = s.continuousDriving + returnTravel > MAX_CONTINUOUS_MIN ? BREAK_DURATION_MIN : 0
  const cumWorkMin    = s.cumWorkMin + returnTravel + returnBreak
  const cumDrivingMin = s.cumDrivingMin + returnTravel

  let total = s.partialCost + skillCost
  total += cumDrivingMin * c.distanceCostFactor * env.wDistance

  if (cumWorkMin > c.nearmaxStartMin && cumWorkMin <= MAX_WORK_MIN) {
    total += (cumWorkMin - c.nearmaxStartMin) * c.nearmaxPerMin
  }
  if (cumWorkMin > MAX_WORK_MIN) {
    total += (MAX_WORK_MIN - c.nearmaxStartMin) * c.nearmaxPerMin
    total += c.overtimePenalty + (cumWorkMin - MAX_WORK_MIN) * c.overtimePerMin
  }

  if (cumWorkMin > 120 && s.currentMin > c.lunchBreakEndMin) {
    // Estimated (straight-line) timeline: is there a gap of lunchBreakDurationMin inside the
    // lunch window? Travel is measured from the previous stop (the start point for the first).
    let maxGapInLunch = 0
    let prevExitMin = env.startTimeMin
    let prevLat = env.startLat, prevLng = env.startLng
    const speed = Math.max(10, env.ctx.speedKmh)
    for (const m of missions) {
      const arrivalEst = prevExitMin + cachedDist(prevLat, prevLng, m.latitude, m.longitude) / speed * 60
      if (arrivalEst > c.lunchBreakStartMin && prevExitMin < c.lunchBreakEndMin) {
        const gap = Math.min(arrivalEst, c.lunchBreakEndMin) - Math.max(prevExitMin, c.lunchBreakStartMin)
        if (gap > maxGapInLunch) maxGapInLunch = gap
      }
      prevExitMin = arrivalEst + (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0)
      prevLat = m.latitude
      prevLng = m.longitude
    }
    if (maxGapInLunch < c.lunchBreakDurationMin) total += c.lunchBreakPenalty
  }

  return Math.max(0, total)
}

/** Full simulation of `missions` for `env`'s driver, optionally resumed from a prefix state. */
function simulate(env: SimEnv, missions: Mission[], from?: { index: number; state: RoutePrefixState; skillCost: number; depCorrection: number }): number {
  if (missions.length === 0) return 0
  const s = from ? { ...from.state } : initialState(env)
  const start = from?.index ?? 0
  let skillCost = from?.skillCost ?? 0
  if (from) s.partialCost += from.depCorrection
  const lastBinIdx = lastBinIndex(missions)
  const depIdx = dependencyIndex(missions)
  for (let i = start; i < missions.length; i++) {
    if (!from) skillCost += skillPenalty(env, missions[i])
    stepMission(s, env, missions, i, lastBinIdx, depIdx)
  }
  return finishRoute(s, env, missions, skillCost)
}

/**
 * Cost of one route: travel (routing matrix when available), CE 561 breaks, time windows and P1
 * deadlines, bin capacity and exutoire trips, skills, work-time limits, lunch gap. This is the
 * reference — prefix states and insertion/removal deltas reuse the very same simulation, so a
 * delta always equals the difference of two full costs.
 */
export function computeRouteCost(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): number {
  const env = makeEnv(route.driverId, ctx, drivers, costCfg)
  if (!env) return Infinity
  return simulate(env, route.missions)
}

/** Simulation states before each mission (index 0 = start of day, index n = after the last). */
export function computePrefixStates(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
): RoutePrefixState[] {
  const env = makeEnv(route.driverId, ctx, drivers)
  if (!env) return []
  const missions = route.missions
  const lastBinIdx = lastBinIndex(missions)
  const depIdx = dependencyIndex(missions)
  const s = initialState(env)
  const states: RoutePrefixState[] = [{ ...s }]
  for (let i = 0; i < missions.length; i++) {
    stepMission(s, env, missions, i, lastBinIdx, depIdx)
    states.push({ ...s })
  }
  return states
}

/**
 * Index from which the simulation must be replayed when the route changes at `pos`: the step
 * before `pos` looks ahead at the next mission, and the "last bin mission" trip moves when the
 * last bin index changes.
 */
function resumeIndex(pos: number, oldLastBin: number, newLastBin: number): number {
  let r = Math.max(0, pos - 1)
  if (oldLastBin !== newLastBin && oldLastBin >= 0 && newLastBin >= 0) r = Math.min(r, oldLastBin, newLastBin)
  return r
}

function sumSkills(env: SimEnv, missions: Mission[], end: number): number {
  let p = 0
  for (let i = 0; i < end; i++) p += skillPenalty(env, missions[i])
  return p
}

/** Missions before `end` that depend on `id` — their 5000 dependency penalty flips when `id` moves in/out after them. */
function dependentsBefore(missions: Mission[], end: number, id: string): number {
  let n = 0
  for (let i = 0; i < end; i++) if (missions[i].dependsOnId === id) n++
  return n
}

/**
 * Exact cost change of inserting `mission` at `pos`: replays the simulation from the last prefix
 * state the insertion cannot affect.
 */
export function computeInsertionDelta(
  route: Route,
  mission: Mission,
  pos: number,
  prefixStates: RoutePrefixState[],
  costWithout: number,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): number {
  const newMissions = [...route.missions.slice(0, pos), mission, ...route.missions.slice(pos)]
  const env = makeEnv(route.driverId, ctx, drivers, costCfg)
  if (!env || pos > route.missions.length || prefixStates.length !== route.missions.length + 1) {
    return computeRouteCost({ driverId: route.driverId, missions: newMissions }, ctx, drivers, costCfg) - costWithout
  }
  const r = resumeIndex(pos, lastBinIndex(route.missions), lastBinIndex(newMissions))
  const total = simulate(env, newMissions, {
    index:         r,
    state:         prefixStates[r],
    skillCost:     sumSkills(env, newMissions, newMissions.length),
    depCorrection: 5000 * dependentsBefore(newMissions, r, mission.id),
  })
  return total - costWithout
}

/** Exact cost change of removing the mission at `pos` (same replay scheme as insertion). */
export function computeRemovalDelta(
  route:        Route,
  pos:          number,
  prefixStates: RoutePrefixState[],
  costWith:     number,
  ctx:          CostContext,
  drivers:      Driver[],
  costCfg?:     VrpCostConfig,
): number {
  if (pos >= route.missions.length) return 0
  const removedId = route.missions[pos].id
  const newMissions = route.missions.filter((_, i) => i !== pos)
  const env = makeEnv(route.driverId, ctx, drivers, costCfg)
  if (!env || prefixStates.length !== route.missions.length + 1) {
    return computeRouteCost({ driverId: route.driverId, missions: newMissions }, ctx, drivers, costCfg) - costWith
  }
  const r = resumeIndex(pos, lastBinIndex(route.missions), lastBinIndex(newMissions))
  const total = simulate(env, newMissions, {
    index:         r,
    state:         prefixStates[r],
    skillCost:     sumSkills(env, newMissions, newMissions.length),
    depCorrection: -5000 * dependentsBefore(route.missions, r, removedId),
  })
  return total - costWith
}

export function computeSuffixSlacks(
  route: Route,
  prefixStates: RoutePrefixState[],
): Float64Array {
  const n = route.missions.length
  const slacks = new Float64Array(n + 1)

  slacks[n] = Infinity

  for (let i = n - 1; i >= 0; i--) {
    const m = route.missions[i]
    let localSlack = Infinity

    if (m.timeWindow && m.timeWindow.closeMin >= m.timeWindow.openMin) {

      const prefix = prefixStates[i]
      if (!prefix) { localSlack = 0; slacks[i] = 0; continue }
      const estimatedArrival = prefix.currentMin
      if (estimatedArrival <= m.timeWindow.closeMin) {
        localSlack = m.timeWindow.closeMin - estimatedArrival
      } else {
        localSlack = 0
      }
    }

    slacks[i] = Math.min(localSlack, slacks[i + 1])
  }

  return slacks
}

export function canInsertWithoutViolation(
  suffixSlacks: Float64Array,
  pos: number,
  addedDelayMin: number,
): boolean {
  return addedDelayMin <= suffixSlacks[pos]
}

export function computeRouteCostDetailed(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): RouteCache {
  const driver = drivers.find(d => d.id === route.driverId)
  if (!driver) return { entries: [], totalCost: Infinity }

  const { startTimeMin, speedKmh, exutoires, date } = ctx

  const depotLat = driver.depotLat
  const depotLng = driver.depotLng
  const missions = route.missions

  const entries: RouteCache['entries'] = []

  if (missions.length === 0) return { entries, totalCost: 0 }

  const effectiveP1Deadline = Math.min(1320, Math.max(P1_DEADLINE_MIN, startTimeMin + 240))

  let currentMin        = startTimeMin
  let currentLat        = depotLat
  let currentLng        = depotLng
  let continuousDriving = 0
  let totalCost         = 0
  let cumTravel = 0, cumWait = 0, cumBreak = 0
  let cumExutoire = 0, cumOnSite = 0, cumDriving = 0
  let cumWork = 0, cumPenalty = 0

  const capacity   = effectiveCapacity(driver)
  let binsUsed     = 0
  const lastBinIdx = lastBinIndex(missions)

  const dowDetailed = cachedDow(date)

  for (let _i = 0; _i < missions.length; _i++) {
    const mission = missions[_i]
    const travelMin = travelTimeMin(
      currentLat, currentLng,
      mission.latitude, mission.longitude,
      speedKmh,
      currentMin,
    )

    let breakBefore = false
    let breakMin = 0
    if (continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {
      breakMin    = BREAK_DURATION_MIN
      breakBefore = true
      continuousDriving = 0
    }

    currentMin        += travelMin + breakMin
    continuousDriving += travelMin
    cumDriving        += travelMin
    cumBreak          += breakMin
    cumTravel         += travelMin
    cumWork           += travelMin + breakMin

    let waitMin = 0
    if (mission.timeWindow && currentMin < mission.timeWindow.openMin) {
      waitMin     = mission.timeWindow.openMin - currentMin
      cumWait    += waitMin
      cumWork    += waitMin
      currentMin  = mission.timeWindow.openMin
    }

    const arrivalMin = currentMin

    let penalty = 0
    if (mission.timeWindow && arrivalMin > mission.timeWindow.closeMin) {
      penalty += penaltyForLate(arrivalMin - mission.timeWindow.closeMin)
    }
    if (mission.priority === 1 && arrivalMin > effectiveP1Deadline) {
      penalty += penaltyForP1Late(arrivalMin - effectiveP1Deadline)
    }
    cumPenalty += penalty
    totalCost  += penalty

    const onSiteMin    = Math.max(0, mission.estimatedDurationMin ?? 0) + Math.max(0, mission.maneuverTimeMin ?? 0)
    const departureMin = arrivalMin + onSiteMin
    cumOnSite += onSiteMin
    cumWork   += onSiteMin

    currentMin = departureMin
    currentLat = mission.latitude
    currentLng = mission.longitude

    let exId: string | undefined
    let exArrival: number | undefined
    let exDeparture: number | undefined

    if (isBinMission(mission.type)) {
      binsUsed++
      const needsExutoire = binsUsed >= capacity || _i >= lastBinIdx

      if (needsExutoire) {

        const ex = findBestExutoire(
          mission.latitude, mission.longitude,
          mission.linkedExutoireId,
          mission.wasteTypeLabel,
          exutoires,
          dowDetailed,
          undefined, undefined, false,
        )
        if (ex) {
          const exTravel = travelTimeMin(
            currentLat, currentLng,
            ex.lat, ex.lng,
            speedKmh,
            currentMin,
          )
          let exBreak = 0
          if (continuousDriving + exTravel > MAX_CONTINUOUS_MIN) {
            exBreak = BREAK_DURATION_MIN
            cumBreak += exBreak
            continuousDriving = 0
          }
          currentMin        += exTravel + exBreak
          continuousDriving += exTravel
          cumDriving        += exTravel
          cumTravel         += exTravel
          cumWork           += exTravel + exBreak

          if (currentMin < ex.openingHoursOpen) {
            const w = ex.openingHoursOpen - currentMin
            cumWait   += w
            cumWork   += w
            currentMin = ex.openingHoursOpen
          }

          exArrival = currentMin
          if (ex.closedDays.includes(dowDetailed) || currentMin > ex.openingHoursClose) {
            const cDet = cfg(costCfg)
            const p = ex.closedDays.includes(dowDetailed)
              ? cDet.closedExutoirePenalty
              : penaltyForLate(currentMin - ex.openingHoursClose)
            cumPenalty += p
            totalCost  += p
          }

          cumExutoire    += ex.serviceTimeMin
          cumWork        += ex.serviceTimeMin
          currentMin     += ex.serviceTimeMin
          exDeparture     = currentMin
          currentLat      = ex.lat
          currentLng      = ex.lng
          continuousDriving = 0
          exId = ex.id
          binsUsed = 0
        } else {
          binsUsed = 0
          totalCost += 500
        }
      }
    }

    entries.push({
      arrivalMin,
      exitTimeMin:        currentMin,
      exitLat:            currentLat,
      exitLng:            currentLng,
      continuousDriving,
      cumTravelMin:       cumTravel,
      cumWaitMin:         cumWait,
      cumBreakMin:        cumBreak,
      cumExutoireMin:     cumExutoire,
      cumOnSiteMin:       cumOnSite,
      cumDrivingMin:      cumDriving,
      cumWorkMin:         cumWork,
      cumPenaltyMin:      cumPenalty,
      breakBefore,
      exutoireId:         exId,
      exutoireArrivalMin:   exArrival,
      exutoireDepartureMin: exDeparture,
    })
  }

  const returnTravel = travelTimeMin(currentLat, currentLng, depotLat, depotLng, speedKmh, currentMin)
  let rBreak = 0
  if (continuousDriving + returnTravel > MAX_CONTINUOUS_MIN) rBreak = BREAK_DURATION_MIN
  cumWork += returnTravel + rBreak

  const cDet2 = cfg(costCfg)
  const wDet = ctx.weights ?? { distance: 0.5, punctuality: 0.5, balance: 0.3 }
  totalCost += cumDriving * cDet2.distanceCostFactor * Math.max(0.1, wDet.distance)

  if (cumWork > cDet2.nearmaxStartMin && cumWork <= MAX_WORK_MIN) {
    totalCost += (cumWork - cDet2.nearmaxStartMin) * cDet2.nearmaxPerMin
  }

  if (cumWork > MAX_WORK_MIN) {
    totalCost += (MAX_WORK_MIN - cDet2.nearmaxStartMin) * cDet2.nearmaxPerMin
    totalCost += cDet2.overtimePenalty + (cumWork - MAX_WORK_MIN) * cDet2.overtimePerMin
  }

  return { entries, totalCost }
}
