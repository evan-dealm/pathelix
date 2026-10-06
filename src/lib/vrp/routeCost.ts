import { getFamiliarityBonus } from '@/lib/familiarityLoader'
import { realDurationMin, realDistanceKm } from './realDistance'
import {
  penaltyForLate,
  penaltyForP1Late,
  MAX_WORK_MIN,
  P1_DEADLINE_MIN,
} from '@/lib/constraints'
import type { Driver, Mission, Exutoire } from '@/lib/types'
import type { Route, RouteCache, CostContext } from './types'
import { findBestExutoire } from './exutoireSearch'
import { cachedDist } from './distanceCache'
import { isHfvrpCompatible } from './hfvrp'
import { DEFAULT_REGULATION, driveLeg, takeBreak, work, type Activity, type BreakKind, type RegulationRules } from './driverClock'
import { isPickup, planningWeightKg, maxLoadKg, maxVolumeM3, loadIssueAlone } from './vehicleLoad'

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

  /** The lunch break is a real stop in the plan (taken inside the window when possible). */
  lunchBreakEnabled: boolean

  lunchBreakStartMin: number

  lunchBreakEndMin: number

  lunchBreakDurationMin: number

  /** Lunch taken after the window, or not at all on a day that runs past it. */
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
  lunchBreakEnabled:     true,
  lunchBreakStartMin:    720,
  lunchBreakEndMin:      810,
  lunchBreakDurationMin: 30,
  lunchBreakPenalty:     80,
}

/** Penalty of a single bin the truck may not carry (payload/GVW or volume) — same scale as a bin too big. */
const LOAD_INFEASIBLE_PENALTY = 50_000
/** Daily driving above the limit: as heavy as overtime (the plan would be illegal). */
const DAILY_DRIVING_PENALTY   = 30_000
const DAILY_DRIVING_PER_MIN   = 300

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
    lunchBreakEnabled:     config.lunchBreakEnabled       ?? DEFAULT_VRP_COST_CONFIG.lunchBreakEnabled,
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
  return isPickup(type)
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
  rules:               RegulationRules
  maxWorkMin:          number
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
  maxLoadKg:           number
  maxVolumeM3:         number
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
    rules:               ctx.regulation ?? DEFAULT_REGULATION,
    maxWorkMin:          ctx.maxWorkMin ?? MAX_WORK_MIN,
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
    maxLoadKg:           maxLoadKg(driver),
    maxVolumeM3:         maxVolumeM3(driver),
    startLat:            startOverride?.lat ?? driver.depotLat,
    startLng:            startOverride?.lng ?? driver.depotLng,
    startTimeMin,
    hasStartOverride:    !!startOverride,
  }
}

/**
 * Simulation state of a route before a given mission (index k = state once missions 0..k-1 are
 * done). It embeds the driver's regulatory clock ({@link ClockState} fields) and the load on
 * board. `partialCost` is everything accrued so far except the skill penalty and the end-of-route
 * terms (return trip, driving cost, work-time, daily driving, lunch) — see {@link finishRoute}.
 * Plain values only: a state is copied with a spread.
 */
export interface RoutePrefixState {
  currentMin:        number
  currentLat:        number
  currentLng:        number
  currentId?:        string
  // Regulatory clock (driverClock.ts).
  drivingSinceBreak: number
  splitFirstTaken:   boolean
  dailyDriving:      number
  workSinceBreak:    number
  workTotal:         number
  breakTotal:        number
  lunchTaken:        boolean
  partialCost:       number
  binsUsed:          number
  emptyBins:         number
  echangersPending:  number
  /** Full bins on board: planned weight (kg) and volume (m³), plus what they hold (for the exutoire choice). */
  loadKg:            number
  loadM3:            number
  loadWaste?:        string
  loadExutoireId?:   string
  prevDirLat:        number
  prevDirLng:        number
  started:           boolean
}

function initialState(env: SimEnv): RoutePrefixState {
  const o = env.ctx.driverStartOverrides?.get(env.driverId)
  const clk = o?.clock
  return {
    currentMin:        env.startTimeMin,
    currentLat:        env.startLat,
    currentLng:        env.startLng,
    // A mid-day start is the driver's live position, not the depot: no matrix id for it.
    currentId:         env.hasStartOverride ? undefined : `depot:${env.driverId}`,
    drivingSinceBreak: clk?.drivingSinceBreak ?? 0,
    splitFirstTaken:   clk?.splitFirstTaken ?? false,
    dailyDriving:      clk?.dailyDriving ?? 0,
    workSinceBreak:    clk?.workSinceBreak ?? 0,
    workTotal:         clk?.workTotal ?? 0,
    breakTotal:        clk?.breakTotal ?? 0,
    lunchTaken:        o?.lunchTaken ?? false,
    partialCost:       0,
    binsUsed:          o?.load?.bins ?? 0,
    emptyBins:         env.capacity,
    echangersPending:  0,
    loadKg:            o?.load?.kg ?? 0,
    loadM3:            o?.load?.m3 ?? 0,
    prevDirLat:        0,
    prevDirLng:        0,
    started:           false,
  }
}

// ─── Trace (plan formatting, validation, explanations) ──────────────────────────

export type SimViolationCode =
  | 'BIN_SIZE'          // bin larger than the truck accepts
  | 'PAYLOAD'           // bin alone heavier than the truck's payload / GVW margin
  | 'VOLUME'            // bin alone larger than the truck's volume
  | 'SKILL'             // driver lacks a required skill
  | 'NO_EMPTY_BIN'      // POSER/ECHANGER with no empty bin left on the truck
  | 'TIME_WINDOW'       // arrival after the window closes
  | 'P1_LATE'           // P1 served after its deadline
  | 'DEPENDENCY'        // served before the mission it depends on
  | 'NO_EXUTOIRE'       // no exutoire accepts this waste on that day
  | 'EXUTOIRE_CLOSED'   // the exutoire is closed that day / at that time
  | 'DAILY_DRIVING'     // more than the daily driving limit
  | 'WORK_TIME'         // more than the daily work limit

export interface SimViolation {
  code:       SimViolationCode
  missionId?: string
  /** Hard = the plan cannot be executed as is; soft = degraded (late, overtime…). */
  hard:       boolean
  /** Amount over the limit, when it makes sense (minutes, kg, m³). */
  amount?:    number
  exutoireId?: string
}

export type TraceEvent =
  | {
      kind: 'break'; startMin: number; durationMin: number
      breakKind: BreakKind | 'LUNCH'
      /** Why it was planned here. */
      reason: 'DRIVING' | 'WORK' | 'LUNCH' | 'WAIT'
      /** Driving already done on the current leg when the break starts. */
      legOffsetMin: number
      lat: number; lng: number
    }
  | {
      kind: 'mission'; mission: Mission
      travelMin: number; distanceKm: number
      arrivalMin: number; waitMin: number; startMin: number; departureMin: number
      loadKg: number; loadM3: number
    }
  | {
      kind: 'exutoire'; exutoire: Exutoire; forMissionId: string; allerRetour: boolean
      /** Unload forced before picking up forMissionId (the truck would otherwise be overloaded). */
      beforePickup: boolean
      travelMin: number; distanceKm: number
      /** Wait for the opening (already included in arrivalMin). */
      waitMin: number
      arrivalMin: number; departureMin: number; unloadedKg: number
    }
  | {
      kind: 'repose'; mission: Mission
      travelMin: number; distanceKm: number; arrivalMin: number; departureMin: number
    }
  | { kind: 'return'; travelMin: number; distanceKm: number; arrivalMin: number }

export interface RouteTotals {
  drivingMin:  number
  workMin:     number
  breakMin:    number
  onSiteMin:   number
  waitMin:     number
  distanceKm:  number
  finishMin:   number
  maxLoadKg:   number
}

interface Tracer {
  events:     TraceEvent[]
  violations: SimViolation[]
  distanceKm: number
  onSiteMin:  number
  waitMin:    number
  maxLoadKg:  number
}

export interface RouteTrace {
  driverId:   string
  cost:       number
  events:     TraceEvent[]
  violations: SimViolation[]
  totals:     RouteTotals
}

/** Per-mission penalties that do not depend on the position in the route: missing skills, a bin the truck cannot carry. */
function skillPenalty(env: SimEnv, m: Mission, tr?: Tracer): number {
  let p = 0
  if (!isHfvrpCompatible(m, env.driver)) {
    p += 50_000
    tr?.violations.push({ code: 'BIN_SIZE', missionId: m.id, hard: true, amount: m.binSizeM3 })
  }
  const loadIssue = loadIssueAlone(m, env.driver)
  if (loadIssue) {
    p += LOAD_INFEASIBLE_PENALTY
    tr?.violations.push({ code: loadIssue, missionId: m.id, hard: true, amount: loadIssue === 'PAYLOAD' ? planningWeightKg(m) : m.binSizeM3 })
  }
  if (!m.requiredSkills || m.requiredSkills.length === 0) return p
  for (const skill of m.requiredSkills) {
    if (!env.driverSkills.has(skill)) {
      p += 10_000 * env.skillWeight
      tr?.violations.push({ code: 'SKILL', missionId: m.id, hard: true })
    }
  }
  return p
}

function dependencyIndex(missions: Mission[]): Map<string, number> | null {
  if (!missions.some(m => m.dependsOnId)) return null
  const idx = new Map<string, number>()
  for (let i = 0; i < missions.length; i++) idx.set(missions[i].id, i)
  return idx
}

/** Takes the lunch break now when the window has started (late lunch is penalised). */
function maybeLunch(s: RoutePrefixState, env: SimEnv, tr?: Tracer): void {
  const c = env.c
  if (!c.lunchBreakEnabled || s.lunchTaken || s.currentMin < c.lunchBreakStartMin) return
  const dur = Math.max(0, c.lunchBreakDurationMin)
  s.lunchTaken = true
  if (dur <= 0) return
  if (s.currentMin + dur > c.lunchBreakEndMin) s.partialCost += c.lunchBreakPenalty
  const kind = takeBreak(s, dur, env.rules)
  if (kind === null) work(s, dur)
  tr?.events.push({ kind: 'break', startMin: s.currentMin, durationMin: dur, breakKind: 'LUNCH', reason: 'LUNCH', legOffsetMin: 0, lat: s.currentLat, lng: s.currentLng })
  s.currentMin += dur
}

/**
 * Drives a leg of `travelMin` (then `workAfterMin` of work at the destination), taking the lunch
 * break first if its window has started, and the regulatory breaks the leg needs. Advances time
 * and the clock.
 */
function leg(s: RoutePrefixState, env: SimEnv, travelMin: number, workAfterMin: number, tr?: Tracer, lunch = true): void {
  if (lunch) maybeLunch(s, env, tr)
  const departMin = s.currentMin
  let added = 0
  const sink = tr
    ? (min: number, kind: BreakKind, driven: number) => {
        tr.events.push({
          kind: 'break', startMin: departMin + driven + added, durationMin: min, breakKind: kind,
          reason: kind === 'WORK' ? 'WORK' : 'DRIVING', legOffsetMin: driven, lat: s.currentLat, lng: s.currentLng,
        })
        added += min
      }
    : undefined
  const brk = driveLeg(s, travelMin, workAfterMin, env.rules, sink)
  s.currentMin += travelMin + brk
}

/**
 * Work a wait may add before the next service: a wait shorter than a break part is work, a
 * longer one becomes a break. Used so the working-time check before a leg covers that wait.
 */
function shortWaitBound(estimatedWaitMin: number, env: SimEnv): number {
  if (!(estimatedWaitMin > 0)) return 0
  return Math.min(estimatedWaitMin, env.rules.minBreakPartMin - 1)
}

/** A wait before an opening time: planned as a break when long enough (and allowed), else work. */
function absorbWait(s: RoutePrefixState, env: SimEnv, waitMin: number, tr?: Tracer): void {
  if (waitMin <= 0) return
  if (tr) tr.waitMin += waitMin
  const r = env.rules
  if (r.breakDuringWait && waitMin >= r.minBreakPartMin) {
    const kind = takeBreak(s, waitMin, r) ?? 'WORK'
    const c = env.c
    let isLunch = false
    if (c.lunchBreakEnabled && !s.lunchTaken) {
      const overlap = Math.min(s.currentMin + waitMin, c.lunchBreakEndMin) - Math.max(s.currentMin, c.lunchBreakStartMin)
      if (overlap >= c.lunchBreakDurationMin) { s.lunchTaken = true; isLunch = true }
    }
    tr?.events.push({
      kind: 'break', startMin: s.currentMin, durationMin: waitMin, breakKind: isLunch ? 'LUNCH' : kind,
      reason: 'WAIT', legOffsetMin: -1, lat: s.currentLat, lng: s.currentLng,
    })
  } else {
    work(s, waitMin)
  }
}

/**
 * Exutoire for a dump: the best one open on arrival; if none is still open, the best one accepting
 * the waste that day (the lateness is then penalised) — never "no exutoire" while one exists.
 */
function pickExutoire(lat: number, lng: number, linkedId: string | undefined, waste: string | undefined, env: SimEnv, atMin: number): Exutoire | undefined {
  const exs = env.ctx.exutoires
  return findBestExutoire(lat, lng, linkedId, waste, exs, env.dow, atMin, undefined, false)
    ?? findBestExutoire(lat, lng, linkedId, waste, exs, env.dow, undefined, undefined, false)
}

/** Drives to an exutoire, waits for opening, unloads everything on board. */
function visitExutoire(s: RoutePrefixState, env: SimEnv, ex: Exutoire, forMissionId: string, allerRetour: boolean, tr?: Tracer, beforePickup = false): void {
  const exId = `exu:${ex.id}`
  const travel = realDurationMin(env.ctx, s.currentId, s.currentLat, s.currentLng, exId, ex.lat, ex.lng, s.currentMin)
  const dist = tr ? realDistanceKm(env.ctx, s.currentId, s.currentLat, s.currentLng, exId, ex.lat, ex.lng) : 0
  leg(s, env, travel, ex.serviceTimeMin + shortWaitBound(ex.openingHoursOpen - s.currentMin - travel, env), tr)
  s.currentLat = ex.lat
  s.currentLng = ex.lng
  s.currentId  = exId
  let waitMin = 0
  if (s.currentMin < ex.openingHoursOpen) {
    waitMin = ex.openingHoursOpen - s.currentMin
    absorbWait(s, env, waitMin, tr)
    s.currentMin = ex.openingHoursOpen
  }
  const arrivalMin = s.currentMin
  if (ex.closedDays.includes(env.dow)) {
    s.partialCost += env.c.closedExutoirePenalty
    tr?.violations.push({ code: 'EXUTOIRE_CLOSED', missionId: forMissionId, hard: true, exutoireId: ex.id })
  } else if (s.currentMin > ex.openingHoursClose) {
    s.partialCost += penaltyForLate(s.currentMin - ex.openingHoursClose)
    tr?.violations.push({ code: 'EXUTOIRE_CLOSED', missionId: forMissionId, hard: false, exutoireId: ex.id, amount: s.currentMin - ex.openingHoursClose })
  }
  work(s, ex.serviceTimeMin)
  s.currentMin += ex.serviceTimeMin
  if (tr) {
    tr.distanceKm += dist
    tr.onSiteMin  += ex.serviceTimeMin
    tr.events.push({ kind: 'exutoire', exutoire: ex, forMissionId, allerRetour, beforePickup, travelMin: travel, distanceKm: dist, waitMin, arrivalMin, departureMin: s.currentMin, unloadedKg: s.loadKg })
  }
  s.loadKg = 0
  s.loadM3 = 0
  s.loadWaste = undefined
  s.loadExutoireId = undefined
}

/** Empties the full bins on board (exutoire trip) and frees the slots. */
function dumpLoad(s: RoutePrefixState, env: SimEnv, lat: number, lng: number, linkedId: string | undefined, waste: string | undefined, forMissionId: string, tr?: Tracer, beforePickup = false): void {
  const ex = pickExutoire(lat, lng, linkedId, waste, env, s.currentMin)
  if (ex) {
    visitExutoire(s, env, ex, forMissionId, false, tr, beforePickup)
  } else {
    s.partialCost += 500
    tr?.violations.push({ code: 'NO_EXUTOIRE', missionId: forMissionId, hard: false })
    s.loadKg = 0
    s.loadM3 = 0
  }
  s.binsUsed          = 0
  s.emptyBins        += s.echangersPending
  s.echangersPending  = 0
}

/** Advances `s` over missions[i] (travel, breaks, waits, windows, service, load, exutoire trips). */
function stepMission(
  s: RoutePrefixState,
  env: SimEnv,
  missions: Mission[],
  i: number,
  lastBinIdx: number,
  depIdx: Map<string, number> | null,
  tr?: Tracer,
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
    if (d >= 0 && d > i) {
      s.partialCost += 5000
      tr?.violations.push({ code: 'DEPENDENCY', missionId: mission.id, hard: false })
    }
  }

  const pickup = isBinMission(mission.type)
  const pickupKg = pickup ? (planningWeightKg(mission) ?? 0) : 0
  const pickupM3 = pickup ? (mission.binSizeM3 ?? 0) : 0

  // Full bins already on board and this one would overload the truck (payload/GVW or volume):
  // unload first. A bin heavier than the truck allows on its own is a static infeasibility
  // (skillPenalty), not a reason to loop on exutoire trips.
  if (pickup && s.binsUsed > 0 && (s.loadKg + pickupKg > env.maxLoadKg || s.loadM3 + pickupM3 > env.maxVolumeM3)) {
    dumpLoad(s, env, s.currentLat, s.currentLng, s.loadExutoireId, s.loadWaste, mission.id, tr, true)
  }

  const onSiteMin = Math.max(0, mission.estimatedDurationMin ?? 0) + Math.max(0, mission.maneuverTimeMin ?? 0)
  const travelMin = realDurationMin(ctx, s.currentId, s.currentLat, s.currentLng, mission.id, mission.latitude, mission.longitude, s.currentMin)
  const distKm = tr ? realDistanceKm(ctx, s.currentId, s.currentLat, s.currentLng, mission.id, mission.latitude, mission.longitude) : 0
  const twOpen = mission.timeWindow && mission.timeWindow.closeMin >= mission.timeWindow.openMin ? mission.timeWindow.openMin : -Infinity
  leg(s, env, travelMin, onSiteMin + shortWaitBound(twOpen - s.currentMin - travelMin, env), tr)
  const physicalArrival = s.currentMin
  s.currentLat = mission.latitude
  s.currentLng = mission.longitude
  s.currentId  = mission.id

  const tw = mission.timeWindow && mission.timeWindow.closeMin >= mission.timeWindow.openMin ? mission.timeWindow : undefined
  let waitMin = 0
  if (tw && s.currentMin < tw.openMin) {
    waitMin = tw.openMin - s.currentMin
    if (waitMin > 15) s.partialCost += (waitMin - 15) * 0.5
    absorbWait(s, env, waitMin, tr)
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
      tr?.violations.push({ code: 'TIME_WINDOW', missionId: mission.id, hard: false, amount: lateMin })
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
    tr?.violations.push({ code: 'P1_LATE', missionId: mission.id, hard: false, amount: arrivalMin - env.effectiveP1Deadline })
  }

  if (env.stabilityW > 0 && ctx.familiarity) {
    s.partialCost += getFamiliarityBonus(ctx.familiarity, env.driverId, mission.siteId, env.stabilityW)
  }

  work(s, onSiteMin)
  s.currentMin += onSiteMin

  if (mission.type === 'POSER') {
    if (s.emptyBins <= 0) {
      s.partialCost += 50_000
      tr?.violations.push({ code: 'NO_EMPTY_BIN', missionId: mission.id, hard: true })
    } else s.emptyBins--
  }

  if (pickup) {
    s.binsUsed++
    s.loadKg += pickupKg
    s.loadM3 += pickupM3
    s.loadWaste = mission.wasteTypeLabel
    s.loadExutoireId = mission.linkedExutoireId
    if (mission.type === 'ECHANGER') {
      if (s.emptyBins <= 0) {
        s.partialCost += 50_000
        tr?.violations.push({ code: 'NO_EMPTY_BIN', missionId: mission.id, hard: true })
      } else { s.emptyBins--; s.echangersPending++ }
    }
  }

  if (tr) {
    tr.distanceKm += distKm
    tr.onSiteMin  += onSiteMin
    if (s.loadKg > tr.maxLoadKg) tr.maxLoadKg = s.loadKg
    tr.events.push({
      kind: 'mission', mission, travelMin, distanceKm: distKm,
      arrivalMin: physicalArrival, waitMin, startMin: arrivalMin, departureMin: s.currentMin,
      loadKg: s.loadKg, loadM3: s.loadM3,
    })
  }

  if (pickup) {
    const nextM = missions[i + 1]
    const nextNeedsEmpty = nextM && (nextM.type === 'POSER' || nextM.type === 'ECHANGER')
    const needsExutoire = s.binsUsed >= env.capacity || i >= lastBinIdx ||
      (s.emptyBins <= 0 && nextNeedsEmpty && s.echangersPending > 0)

    if (needsExutoire) {
      dumpLoad(s, env, mission.latitude, mission.longitude, mission.linkedExutoireId, mission.wasteTypeLabel, mission.id, tr)
    }
  }

  if (mission.type === 'ALLER_RETOUR') {
    // The client's bin goes to the exutoire and comes back empty to be put down again.
    const ex = pickExutoire(mission.latitude, mission.longitude, mission.linkedExutoireId, mission.wasteTypeLabel, env, s.currentMin)
    if (ex) {
      s.loadKg = planningWeightKg(mission) ?? 0
      s.loadM3 = mission.binSizeM3 ?? 0
      if (tr && s.loadKg > tr.maxLoadKg) tr.maxLoadKg = s.loadKg
      visitExutoire(s, env, ex, mission.id, true, tr)
      const reposeMin = mission.maneuverTimeMin ?? 15
      const fromEx = realDurationMin(ctx, `exu:${ex.id}`, ex.lat, ex.lng, mission.id, mission.latitude, mission.longitude, s.currentMin)
      const backKm = tr ? realDistanceKm(ctx, `exu:${ex.id}`, ex.lat, ex.lng, mission.id, mission.latitude, mission.longitude) : 0
      leg(s, env, fromEx, reposeMin, tr)
      const backArrival = s.currentMin
      s.currentLat = mission.latitude
      s.currentLng = mission.longitude
      s.currentId  = mission.id
      work(s, reposeMin)
      s.currentMin += reposeMin
      if (tr) {
        tr.distanceKm += backKm
        tr.onSiteMin  += reposeMin
        tr.events.push({ kind: 'repose', mission, travelMin: fromEx, distanceKm: backKm, arrivalMin: backArrival, departureMin: s.currentMin })
      }
    } else {
      s.partialCost += 500
      tr?.violations.push({ code: 'NO_EXUTOIRE', missionId: mission.id, hard: false })
    }
  }
}

/**
 * Closes the route: return to the depot (with the breaks it needs), driving cost, near-max /
 * overtime on work time, daily driving limit, lunch. Does not mutate `s`; returns the total cost.
 */
function finishRoute(s0: RoutePrefixState, env: SimEnv, skillCost: number, tr?: Tracer): number {
  const { c, driver } = env
  const s = { ...s0 }
  const depotId = `depot:${env.driverId}`
  const returnTravel = realDurationMin(env.ctx, s.currentId, s.currentLat, s.currentLng, depotId, driver.depotLat, driver.depotLng, s.currentMin)
  const returnKm = tr ? realDistanceKm(env.ctx, s.currentId, s.currentLat, s.currentLng, depotId, driver.depotLat, driver.depotLng) : 0
  // Full bins still on board at the end (no exutoire found) are not dumped here: the trip home is
  // what remains of the day.
  leg(s, env, returnTravel, 0, tr, false)

  let total = s.partialCost + skillCost
  total += s.dailyDriving * c.distanceCostFactor * env.wDistance

  const workMin = s.workTotal
  if (workMin > c.nearmaxStartMin && workMin <= env.maxWorkMin) {
    total += (workMin - c.nearmaxStartMin) * c.nearmaxPerMin
  }
  if (workMin > env.maxWorkMin) {
    total += Math.max(0, env.maxWorkMin - c.nearmaxStartMin) * c.nearmaxPerMin
    total += c.overtimePenalty + (workMin - env.maxWorkMin) * c.overtimePerMin
    tr?.violations.push({ code: 'WORK_TIME', hard: false, amount: workMin - env.maxWorkMin })
  }
  if (s.dailyDriving > env.rules.maxDailyDrivingMin) {
    total += DAILY_DRIVING_PENALTY + (s.dailyDriving - env.rules.maxDailyDrivingMin) * DAILY_DRIVING_PER_MIN
    tr?.violations.push({ code: 'DAILY_DRIVING', hard: true, amount: s.dailyDriving - env.rules.maxDailyDrivingMin })
  }

  // A day that runs past the lunch window without the driver ever stopping for it.
  if (c.lunchBreakEnabled && !s.lunchTaken && s.currentMin > c.lunchBreakEndMin && workMin > 120) {
    total += c.lunchBreakPenalty
  }

  if (tr) {
    tr.distanceKm += returnKm
    tr.events.push({ kind: 'return', travelMin: returnTravel, distanceKm: returnKm, arrivalMin: s.currentMin })
    totalsOut = {
      drivingMin: s.dailyDriving, workMin, breakMin: s.breakTotal, onSiteMin: tr.onSiteMin, waitMin: tr.waitMin,
      distanceKm: tr.distanceKm, finishMin: s.currentMin, maxLoadKg: tr.maxLoadKg,
    }
  }

  return Math.max(0, total)
}

// finishRoute reports the trace totals here (avoids allocating a result object on the hot path).
let totalsOut: RouteTotals | null = null

/** Full simulation of `missions` for `env`'s driver, optionally resumed from a prefix state. */
function simulate(env: SimEnv, missions: Mission[], from?: { index: number; state: RoutePrefixState; skillCost: number; depCorrection: number }, tr?: Tracer): number {
  if (missions.length === 0) return 0
  const s = from ? { ...from.state } : initialState(env)
  const start = from?.index ?? 0
  let skillCost = from?.skillCost ?? 0
  if (from) s.partialCost += from.depCorrection
  const lastBinIdx = lastBinIndex(missions)
  const depIdx = dependencyIndex(missions)
  for (let i = start; i < missions.length; i++) {
    if (!from) skillCost += skillPenalty(env, missions[i], tr)
    stepMission(s, env, missions, i, lastBinIdx, depIdx, tr)
  }
  return finishRoute(s, env, skillCost, tr)
}

/**
 * Cost of one route: travel (routing matrix when available), CE 561/2006 driving breaks and
 * 2002/15 working-time breaks, lunch, time windows and P1 deadlines, bin slots, payload/GVW and
 * volume with exutoire trips, skills, work-time and daily driving limits. This is the reference —
 * prefix states, insertion/removal deltas and the formatted plan ({@link simulateRouteTrace}) all
 * replay this very simulation, so a delta always equals the difference of two full costs and the
 * plan shown is the plan that was costed.
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

/**
 * Same simulation as {@link computeRouteCost}, recording every stop, break, exutoire trip and
 * constraint violation — what the plan formatting, the final validation and the explanations use.
 * Returns null when the driver is unknown.
 */
export function simulateRouteTrace(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): RouteTrace | null {
  const env = makeEnv(route.driverId, ctx, drivers, costCfg)
  if (!env) return null
  const tr: Tracer = { events: [], violations: [], distanceKm: 0, onSiteMin: 0, waitMin: 0, maxLoadKg: 0 }
  totalsOut = null
  const cost = simulate(env, route.missions, undefined, tr)
  const totals = totalsOut ?? { drivingMin: 0, workMin: 0, breakMin: 0, onSiteMin: 0, waitMin: 0, distanceKm: 0, finishMin: env.startTimeMin, maxLoadKg: 0 }
  totalsOut = null
  return { driverId: route.driverId, cost, events: tr.events, violations: tr.violations, totals }
}

/**
 * The driver's day as regulatory activities (drive / work / wait / break), in chronological order —
 * what {@link auditTimeline} checks. Breaks inside a leg split its driving at their offset.
 */
export function traceToActivities(trace: RouteTrace): Activity[] {
  const acts: Activity[] = []
  let pending: Extract<TraceEvent, { kind: 'break' }>[] = []
  const flush = (travel: number, ref?: string): boolean => {
    let driven = 0
    let waitBreak = false
    for (const b of pending) {
      const off = b.legOffsetMin < 0 ? travel : Math.min(travel, b.legOffsetMin)
      if (off > driven) { acts.push({ kind: 'DRIVE', minutes: off - driven, ref }); driven = off }
      acts.push({ kind: 'BREAK', minutes: b.durationMin, ref })
      if (b.reason === 'WAIT') waitBreak = true
    }
    if (travel > driven) acts.push({ kind: 'DRIVE', minutes: travel - driven, ref })
    pending = []
    return waitBreak
  }
  for (const ev of trace.events) {
    switch (ev.kind) {
      case 'break': pending.push(ev); break
      case 'mission': {
        const waitBreak = flush(ev.travelMin, ev.mission.id)
        if (!waitBreak && ev.waitMin > 0) acts.push({ kind: 'WAIT', minutes: ev.waitMin, ref: ev.mission.id })
        acts.push({ kind: 'WORK', minutes: ev.departureMin - ev.startMin, ref: ev.mission.id })
        break
      }
      case 'exutoire': {
        const waitBreak = flush(ev.travelMin, ev.forMissionId)
        if (!waitBreak && ev.waitMin > 0) acts.push({ kind: 'WAIT', minutes: ev.waitMin })
        acts.push({ kind: 'WORK', minutes: ev.departureMin - ev.arrivalMin })
        break
      }
      case 'repose':
        flush(ev.travelMin, ev.mission.id)
        acts.push({ kind: 'WORK', minutes: ev.departureMin - ev.arrivalMin, ref: ev.mission.id })
        break
      case 'return':
        flush(ev.travelMin)
        break
    }
  }
  return acts
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

/**
 * Per-mission timeline of a route (arrival, exit, cumulative times, exutoire trips), derived from
 * {@link simulateRouteTrace} — the same simulation the optimiser costs.
 */
export function computeRouteCostDetailed(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): RouteCache {
  const trace = simulateRouteTrace(route, ctx, drivers, costCfg)
  if (!trace) return { entries: [], totalCost: Infinity }
  if (route.missions.length === 0) return { entries: [], totalCost: 0 }

  const entries: RouteCache['entries'] = []
  let cumTravel = 0, cumWait = 0, cumBreak = 0, cumExutoire = 0, cumOnSite = 0, cumPenalty = 0
  let breakPending = false
  let drivingSinceBreak = 0
  const lateBy = new Map<string, number>()
  for (const v of trace.violations) {
    if ((v.code === 'TIME_WINDOW' || v.code === 'P1_LATE') && v.missionId) lateBy.set(v.missionId, (lateBy.get(v.missionId) ?? 0) + (v.amount ?? 0))
  }
  for (const ev of trace.events) {
    switch (ev.kind) {
      case 'break':
        // A wait planned as a break is already counted in the mission's wait time.
        if (ev.reason !== 'WAIT') { cumBreak += ev.durationMin; breakPending = true }
        if (ev.breakKind === 'FULL' || ev.breakKind === 'SPLIT_SECOND') drivingSinceBreak = 0
        break
      case 'mission': {
        cumTravel += ev.travelMin
        cumWait   += ev.waitMin
        drivingSinceBreak += ev.travelMin
        const onSite = ev.departureMin - ev.startMin
        cumOnSite += onSite
        cumPenalty += lateBy.get(ev.mission.id) ?? 0
        entries.push({
          arrivalMin: ev.startMin, exitTimeMin: ev.departureMin,
          exitLat: ev.mission.latitude, exitLng: ev.mission.longitude,
          continuousDriving: drivingSinceBreak,
          cumTravelMin: cumTravel, cumWaitMin: cumWait, cumBreakMin: cumBreak,
          cumExutoireMin: cumExutoire, cumOnSiteMin: cumOnSite, cumDrivingMin: cumTravel,
          cumWorkMin: cumTravel + cumWait + cumOnSite + cumExutoire, cumPenaltyMin: cumPenalty,
          breakBefore: breakPending,
        })
        breakPending = false
        break
      }
      case 'exutoire': {
        cumTravel += ev.travelMin
        drivingSinceBreak += ev.travelMin
        cumExutoire += ev.departureMin - ev.arrivalMin
        const last = entries[entries.length - 1]
        if (last && ev.forMissionId === route.missions[entries.length - 1]?.id) {
          last.exutoireId = ev.exutoire.id
          last.exutoireArrivalMin = ev.arrivalMin
          last.exutoireDepartureMin = ev.departureMin
          last.exitTimeMin = ev.departureMin
          last.exitLat = ev.exutoire.lat
          last.exitLng = ev.exutoire.lng
          last.cumTravelMin = cumTravel
          last.cumDrivingMin = cumTravel
          last.cumExutoireMin = cumExutoire
          last.cumWorkMin = cumTravel + cumWait + cumOnSite + cumExutoire
        }
        break
      }
      case 'repose':
        cumTravel += ev.travelMin
        cumOnSite += ev.departureMin - ev.arrivalMin
        break
      case 'return':
        break
    }
  }
  return { entries, totalCost: trace.cost }
}
