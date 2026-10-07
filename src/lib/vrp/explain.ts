import { minToHHMM } from '@/lib/algorithm'
import type { Driver, Mission } from '@/lib/types'
import type { CostContext, Route, VRPSolution } from './types'
import {
  computeInsertionDelta,
  computePrefixStates,
  computeRouteCost,
  isAllerRetourCompatible,
  simulateRouteTrace,
  type SimViolation,
  type SimViolationCode,
} from './routeCost'
import { isHfvrpCompatible } from './hfvrp'
import { loadIssueAlone, planningWeightKg } from './vehicleLoad'

/**
 * Final validation of a solution and explanation of what could not be planned.
 *
 * The search works with penalties (soft constraints) so it can move through infeasible states.
 * Before a plan is shipped, everything that cannot physically or legally be executed is taken out
 * of the routes — a bin the truck cannot carry, a missing skill, no empty bin left, a day over the
 * driving or working-time limit — re-inserted elsewhere when another truck can take it, and
 * otherwise returned as unassigned with the reason.
 */

export type UnassignedReasonCode =
  | 'NO_DRIVER' // no driver available that day
  | 'VEHICLE_UNAVAILABLE' // the drivers' trucks are immobilised
  | 'BIN_SIZE' // bin too large for every available truck
  | 'PAYLOAD' // too heavy for every truck's payload / GVW
  | 'VOLUME' // too large for every truck's volume
  | 'SKILL' // no available driver has the required skill
  | 'CAPACITY' // no empty bin / slot left on the trucks
  | 'TIME_WINDOW' // window cannot be reached
  | 'P1_DEADLINE' // P1 deadline cannot be met
  | 'DRIVING_TIME' // would exceed the daily driving limit (CE 561/2006)
  | 'WORK_TIME' // would exceed the daily working time
  | 'NO_EXUTOIRE' // no exutoire accepts this waste that day
  | 'NEEDS_GEOCODE' // address not geolocated
  | 'DEPENDENCY' // must come after another mission that is not planned / cannot come first
  | 'OTHER'

export interface UnassignedReason {
  code: UnassignedReasonCode
  message: string
}

/** Mission-level violations that make a plan non-executable. */
const MISSION_HARD: ReadonlySet<SimViolationCode> = new Set([
  'BIN_SIZE',
  'PAYLOAD',
  'VOLUME',
  'SKILL',
  'NO_EMPTY_BIN',
])
/** Route-level violations that make a plan illegal. */
const ROUTE_HARD: ReadonlySet<SimViolationCode> = new Set(['DAILY_DRIVING', 'WORK_TIME'])

function toReason(code: SimViolationCode): UnassignedReasonCode {
  switch (code) {
    case 'NO_EMPTY_BIN':
      return 'CAPACITY'
    case 'DAILY_DRIVING':
      return 'DRIVING_TIME'
    case 'WORK_TIME':
      return 'WORK_TIME'
    case 'TIME_WINDOW':
      return 'TIME_WINDOW'
    case 'P1_LATE':
      return 'P1_DEADLINE'
    case 'NO_EXUTOIRE':
      return 'NO_EXUTOIRE'
    case 'BIN_SIZE':
    case 'PAYLOAD':
    case 'VOLUME':
    case 'SKILL':
      return code
    default:
      return 'OTHER'
  }
}

/**
 * Lateness past a customer's window that a plan may keep (min). Beyond it the window is broken:
 * the mission leaves the plan (except an emergency) and the office is told why, instead of the
 * customer finding out from a truck hours late.
 */
export const LATE_TOLERANCE_MIN = 30

/** Hard problems of a route, ignoring missions locked by an earlier plan step (none here). */
function hardProblems(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
): { missionLevel: SimViolation[]; routeLevel: SimViolation[]; late: SimViolation[] } {
  const trace = simulateRouteTrace(route, ctx, drivers)
  if (!trace) return { missionLevel: [], routeLevel: [], late: [] }
  const missionLevel = trace.violations.filter(v => MISSION_HARD.has(v.code) && v.missionId)
  // Overtime is only "hard" when the day is illegal; WORK_TIME is recorded only above the limit.
  const routeLevel = trace.violations.filter(v => ROUTE_HARD.has(v.code))
  const p1 = new Set(route.missions.filter(m => m.priority === 1).map(m => m.id))
  const late = trace.violations.filter(
    v =>
      v.code === 'TIME_WINDOW' &&
      v.missionId &&
      !p1.has(v.missionId) &&
      (v.amount ?? 0) > LATE_TOLERANCE_MIN,
  )
  return { missionLevel, routeLevel, late }
}

function priorityRank(m: Mission): number {
  return m.priority === 1 ? 0 : m.priority === 2 ? 1 : 2
}

/**
 * Removes non-executable missions from the routes, tries to re-insert each in another route where
 * it creates no hard problem, and reports the rest with the reason. P1 missions are never removed
 * for a working/driving-time excess alone (the dispatcher must decide), they stay with an error.
 */
export function validateAndRepair(
  solution: VRPSolution,
  drivers: Driver[],
  ctx: CostContext,
  deadline: number = Date.now() + 1500,
  /** Ids of every mission of the day being planned (to tell an unplanned prerequisite from one that is not part of this day). */
  dayMissionIds?: ReadonlySet<string>,
): {
  solution: VRPSolution
  removed: Map<string, { mission: Mission; code: UnassignedReasonCode }>
} {
  const routes: Route[] = solution.routes.map(r => ({
    driverId: r.driverId,
    missions: [...r.missions],
  }))
  const removed = new Map<string, { mission: Mission; code: UnassignedReasonCode }>()

  for (const route of routes) {
    // 1. Missions that cannot be executed in this truck at all.
    for (let guard = 0; guard <= route.missions.length; guard++) {
      const { missionLevel } = hardProblems(route, ctx, drivers)
      if (missionLevel.length === 0) break
      const ids = new Set(missionLevel.map(v => v.missionId!))
      for (const v of missionLevel) {
        const m = route.missions.find(x => x.id === v.missionId)
        if (m && !removed.has(m.id)) removed.set(m.id, { mission: m, code: toReason(v.code) })
      }
      route.missions = route.missions.filter(m => !ids.has(m.id))
    }
    // 2. A day over the legal driving / working time: drop the least important missions, the
    //    one whose removal saves the most first.
    for (let guard = 0; guard < route.missions.length + 1; guard++) {
      const { routeLevel } = hardProblems(route, ctx, drivers)
      if (routeLevel.length === 0) break
      const code = toReason(routeLevel[0].code)
      const base = computeRouteCost(route, ctx, drivers)
      let bestIdx = -1,
        bestKey = Infinity
      for (let i = 0; i < route.missions.length; i++) {
        const m = route.missions[i]
        if (m.priority === 1) continue
        const after = computeRouteCost(
          { driverId: route.driverId, missions: route.missions.filter((_, j) => j !== i) },
          ctx,
          drivers,
        )
        // Lower priority first, then largest saving.
        const key = (2 - priorityRank(m)) * 1e12 + (after - base)
        if (key < bestKey) {
          bestKey = key
          bestIdx = i
        }
      }
      if (bestIdx < 0) break
      const [m] = route.missions.splice(bestIdx, 1)
      removed.set(m.id, { mission: m, code })
    }
    // 2b. Broken customer windows: take out the latest visit first — the ones after it often
    //     arrive in time once it is gone.
    for (let guard = 0; guard < route.missions.length + 1; guard++) {
      const { late } = hardProblems(route, ctx, drivers)
      if (late.length === 0) break
      const worst = late.reduce((a, b) => ((b.amount ?? 0) > (a.amount ?? 0) ? b : a))
      const idx = route.missions.findIndex(m => m.id === worst.missionId)
      if (idx < 0) break
      const [m] = route.missions.splice(idx, 1)
      removed.set(m.id, { mission: m, code: 'TIME_WINDOW' })
    }
  }

  // 3. Re-insert where another truck can take the mission without any hard problem.
  const driverById = new Map(drivers.map(d => [d.id, d]))
  const order = [...removed.values()].sort(
    (a, b) => priorityRank(a.mission) - priorityRank(b.mission),
  )
  for (const { mission } of order) {
    if (Date.now() > deadline) break
    let best: { route: Route; pos: number; delta: number } | null = null
    for (const route of routes) {
      const d = driverById.get(route.driverId)
      if (!d || !isHfvrpCompatible(mission, d) || loadIssueAlone(mission, d)) continue
      if (mission.requiredSkills?.some(sk => !(d.skills ?? []).includes(sk))) continue
      if (!isAllerRetourCompatible(route.missions, mission.type)) continue
      const base = computeRouteCost(route, ctx, drivers)
      const prefix = computePrefixStates(route, ctx, drivers)
      for (let pos = 0; pos <= route.missions.length; pos++) {
        const delta = computeInsertionDelta(route, mission, pos, prefix, base, ctx, drivers)
        if (best && delta >= best.delta) continue
        const trial: Route = {
          driverId: route.driverId,
          missions: [...route.missions.slice(0, pos), mission, ...route.missions.slice(pos)],
        }
        const { missionLevel, routeLevel, late } = hardProblems(trial, ctx, drivers)
        if (missionLevel.length > 0 || routeLevel.length > 0 || late.length > 0) continue
        best = { route, pos, delta }
      }
    }
    if (best) {
      best.route.missions.splice(best.pos, 0, mission)
      removed.delete(mission.id)
    }
  }

  // 4. Dependencies hold across the whole plan, not only inside one truck's route. Moving or
  //    removing a mission can leave a later drop without its empty bin, and removing that drop can
  //    in turn orphan a dependent mission: repeat until nothing changes.
  for (let round = 0; round < 6; round++) {
    const before = removed.size
    enforceDependencies(routes, removed, drivers, ctx, dayMissionIds)
    for (const route of routes) {
      for (let guard = 0; guard <= route.missions.length; guard++) {
        const { missionLevel } = hardProblems(route, ctx, drivers)
        if (missionLevel.length === 0) break
        const ids = new Set(missionLevel.map(v => v.missionId!))
        for (const v of missionLevel) {
          const m = route.missions.find(x => x.id === v.missionId)
          if (m && !removed.has(m.id)) removed.set(m.id, { mission: m, code: toReason(v.code) })
        }
        route.missions = route.missions.filter(m => !ids.has(m.id))
      }
    }
    if (removed.size === before) break
  }

  return { solution: { routes, cost: solution.cost }, removed }
}

/**
 * A mission that depends on another one (a pickup after the new bin was dropped…) must start
 * after it is finished. The search only penalised the wrong order inside one route: with the two
 * missions on different trucks nothing was checked, and the dependent one was routinely planned
 * hours before its prerequisite — or planned while the prerequisite was not planned at all.
 *
 * Here every dependent mission is checked against the simulated times of the final routes. A
 * wrong order is repaired by moving the dependent mission to the cheapest position that respects
 * it (after the prerequisite in its route, or later in its own) without creating a hard problem;
 * when there is none, or when the prerequisite is not planned, the dependent mission leaves the
 * plan with the reason, rather than being done in the wrong order.
 */
function enforceDependencies(
  routes: Route[],
  removed: Map<string, { mission: Mission; code: UnassignedReasonCode }>,
  drivers: Driver[],
  ctx: CostContext,
  dayMissionIds?: ReadonlySet<string>,
): void {
  const dependents = () => routes.flatMap(r => r.missions).filter(m => m.dependsOnId)
  if (dependents().length === 0) return

  /** Start and end of every planned mission, from the same simulator as the plan shown. */
  const timesOf = (): Map<string, { start: number; end: number; route: Route }> => {
    const t = new Map<string, { start: number; end: number; route: Route }>()
    for (const route of routes) {
      const trace = simulateRouteTrace(route, ctx, drivers)
      for (const e of trace?.events ?? [])
        if (e.kind === 'mission')
          t.set(e.mission.id, { start: e.startMin, end: e.departureMin, route })
    }
    return t
  }
  const drop = (m: Mission) => {
    for (const r of routes) r.missions = r.missions.filter(x => x.id !== m.id)
    removed.set(m.id, { mission: m, code: 'DEPENDENCY' })
  }
  const feasible = (trial: Route): boolean => {
    const { missionLevel, routeLevel, late } = hardProblems(trial, ctx, drivers)
    return missionLevel.length === 0 && routeLevel.length === 0 && late.length === 0
  }

  // Each pass fixes or removes at least one mission; moving one can shift others, hence the loop.
  for (let pass = 0; pass < 200; pass++) {
    const times = timesOf()
    const planned = new Set(times.keys())
    const bad = dependents().find(m => {
      const pre = m.dependsOnId as string
      if (!planned.has(pre)) return removed.has(pre) || (dayMissionIds?.has(pre) ?? false)
      return (times.get(m.id)?.start ?? 0) < (times.get(pre)?.end ?? 0)
    })
    if (!bad) return
    const pre = bad.dependsOnId as string
    if (!planned.has(pre)) {
      drop(bad)
      continue
    }

    const home = times.get(bad.id)!.route
    const preRoute = times.get(pre)!.route
    home.missions = home.missions.filter(x => x.id !== bad.id)
    const d = (r: Route) => drivers.find(x => x.id === r.driverId)
    let best: { route: Route; pos: number; cost: number } | null = null
    for (const route of new Set([preRoute, home])) {
      const driver = d(route)
      if (!driver || !isHfvrpCompatible(bad, driver) || loadIssueAlone(bad, driver)) continue
      if (bad.requiredSkills?.some(sk => !(driver.skills ?? []).includes(sk))) continue
      if (!isAllerRetourCompatible(route.missions, bad.type)) continue
      const from = route === preRoute ? route.missions.findIndex(x => x.id === pre) + 1 : 0
      const base = computeRouteCost(route, ctx, drivers)
      for (let pos = from; pos <= route.missions.length; pos++) {
        const trial: Route = {
          driverId: route.driverId,
          missions: [...route.missions.slice(0, pos), bad, ...route.missions.slice(pos)],
        }
        if (!feasible(trial)) continue
        // The order must hold with the times of the trial itself (the prerequisite may be in it).
        const trace = simulateRouteTrace(trial, ctx, drivers)
        const ev = trace?.events.find(e => e.kind === 'mission' && e.mission.id === bad.id)
        const preEv =
          route === preRoute
            ? trace?.events.find(e => e.kind === 'mission' && e.mission.id === pre)
            : undefined
        const preEnd = preEv && preEv.kind === 'mission' ? preEv.departureMin : times.get(pre)!.end
        if (!ev || ev.kind !== 'mission' || ev.startMin < preEnd) continue
        const cost = computeRouteCost(trial, ctx, drivers) - base
        if (!best || cost < best.cost) best = { route, pos, cost }
      }
    }
    if (best) best.route.missions.splice(best.pos, 0, bad)
    else removed.set(bad.id, { mission: bad, code: 'DEPENDENCY' })
  }
}

function fmtKg(kg: number): string {
  return kg >= 1000
    ? `${(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t`
    : `${Math.round(kg)} kg`
}

/** Human explanation of a reason code for one mission. */
export function reasonMessage(code: UnassignedReasonCode, m: Mission, ctx?: CostContext): string {
  switch (code) {
    case 'DEPENDENCY':
      return "Doit être réalisée après une autre mission, qui n'est pas planifiée ce jour-là ou ne peut pas l'être avant elle"
    case 'NO_DRIVER':
      return 'Aucun chauffeur disponible ce jour-là'
    case 'VEHICLE_UNAVAILABLE':
      return 'Les camions des chauffeurs disponibles sont immobilisés'
    case 'BIN_SIZE':
      return `Benne de ${m.binSizeM3 ?? '?'} m³ : aucun camion disponible ne peut la porter`
    case 'PAYLOAD': {
      const w = planningWeightKg(m)
      return `Poids prévu ${w !== undefined ? fmtKg(w) : 'inconnu'}${m.weightSource === 'ESTIMATED' ? " (estimé d'après la matière et le volume de la benne)" : ''} : dépasse la charge utile / le PTAC de tous les camions disponibles${m.weightSource === 'ESTIMATED' ? " — saisir le poids réel s'il est connu, ou prévoir une benne plus petite" : ''}`
    }
    case 'VOLUME':
      return `Benne de ${m.binSizeM3 ?? '?'} m³ : dépasse le volume utile de tous les camions disponibles`
    case 'SKILL':
      return `Compétence requise (${(m.requiredSkills ?? []).join(', ')}) : aucun chauffeur disponible ne l'a`
    case 'CAPACITY':
      return 'Plus de benne vide ni de place disponible dans les camions'
    case 'TIME_WINDOW':
      return m.timeWindow
        ? `Fenêtre horaire ${minToHHMM(m.timeWindow.openMin)}–${minToHHMM(m.timeWindow.closeMin)} inatteignable avec les tournées actuelles`
        : 'Horaire inatteignable'
    case 'P1_DEADLINE':
      return 'Urgence P1 : échéance impossible à tenir avec les chauffeurs disponibles'
    case 'DRIVING_TIME':
      return 'Temps de conduite : la tournée dépasserait 9 h de conduite (CE 561/2006)'
    case 'WORK_TIME':
      return `Temps de travail : la tournée dépasserait ${Math.round((ctx?.maxWorkMin ?? 600) / 60)} h de travail`
    case 'NO_EXUTOIRE':
      return `Aucun exutoire ouvert n'accepte ${m.wasteTypeLabel ? `« ${m.wasteTypeLabel} »` : 'ce déchet'} ce jour-là`
    case 'NEEDS_GEOCODE':
      return 'Adresse non géolocalisée'
    case 'OTHER':
      return "Non placée par l'optimiseur — relancer ou affecter manuellement"
  }
}

/**
 * Why a mission left unassigned could not be planned: what every driver's truck says about it
 * statically (size, weight, skills), then what inserting it into each current route would break.
 */
export function diagnoseMission(
  m: Mission,
  drivers: Driver[],
  routes: Route[],
  ctx: CostContext,
): UnassignedReasonCode {
  if (m.needsGeocode) return 'NEEDS_GEOCODE'
  if (drivers.length === 0) return 'NO_DRIVER'
  const statics: UnassignedReasonCode[] = []
  const candidates: Driver[] = []
  for (const d of drivers) {
    if (!isHfvrpCompatible(m, d)) {
      statics.push('BIN_SIZE')
      continue
    }
    const li = loadIssueAlone(m, d)
    if (li) {
      statics.push(li)
      continue
    }
    if (m.requiredSkills?.some(sk => !(d.skills ?? []).includes(sk))) {
      statics.push('SKILL')
      continue
    }
    candidates.push(d)
  }
  if (candidates.length === 0) return mostCommon(statics) ?? 'OTHER'

  const dynamic: UnassignedReasonCode[] = []
  const routeOf = new Map(routes.map(r => [r.driverId, r]))
  for (const d of candidates) {
    const route = routeOf.get(d.id) ?? { driverId: d.id, missions: [] }
    if (!isAllerRetourCompatible(route.missions, m.type)) {
      dynamic.push('CAPACITY')
      continue
    }
    let bestCodes: SimViolationCode[] | null = null
    for (let pos = 0; pos <= route.missions.length; pos++) {
      const trace = simulateRouteTrace(
        {
          driverId: d.id,
          missions: [...route.missions.slice(0, pos), m, ...route.missions.slice(pos)],
        },
        ctx,
        drivers,
      )
      if (!trace) continue
      const codes = trace.violations
        .filter(v => v.missionId === m.id || ROUTE_HARD.has(v.code))
        .map(v => v.code)
      if (!bestCodes || codes.length < bestCodes.length) bestCodes = codes
      if (codes.length === 0) break
    }
    if (bestCodes && bestCodes.length > 0) {
      const ordered = [
        'DAILY_DRIVING',
        'WORK_TIME',
        'NO_EMPTY_BIN',
        'P1_LATE',
        'TIME_WINDOW',
        'NO_EXUTOIRE',
      ] as const
      const hit = ordered.find(c => bestCodes!.includes(c))
      dynamic.push(hit ? toReason(hit) : toReason(bestCodes[0]))
    } else {
      dynamic.push('OTHER')
    }
  }
  return mostCommon(dynamic.filter(c => c !== 'OTHER')) ?? 'OTHER'
}

function mostCommon<T>(arr: T[]): T | undefined {
  const count = new Map<T, number>()
  let best: T | undefined,
    bestN = 0
  for (const x of arr) {
    const n = (count.get(x) ?? 0) + 1
    count.set(x, n)
    if (n > bestN) {
      bestN = n
      best = x
    }
  }
  return best
}

/**
 * Reasons for all unassigned missions, diagnosed against the final routes; `known` codes (what
 * the validation removed them for) are used when the diagnosis finds nothing more specific.
 */
export function explainUnassigned(
  unassigned: Mission[],
  drivers: Driver[],
  routes: Route[],
  ctx: CostContext,
  known: Map<string, UnassignedReasonCode> = new Map(),
  deadline: number = Date.now() + 1500,
): Record<string, UnassignedReason> {
  const out: Record<string, UnassignedReason> = {}
  for (const m of unassigned) {
    let code: UnassignedReasonCode =
      Date.now() < deadline ? diagnoseMission(m, drivers, routes, ctx) : 'OTHER'
    if (code === 'OTHER') code = known.get(m.id) ?? 'OTHER'
    out[m.id] = { code, message: reasonMessage(code, m, ctx) }
  }
  return out
}

export interface AssignmentAlternative {
  driverId: string
  /** True for the driver the mission is planned with. */
  chosen: boolean
  feasible: boolean
  /** Extra driving km and working minutes this mission costs in that route (best position). */
  extraKm: number | null
  extraMin: number | null
  /** Why it cannot go there (French), when it cannot. */
  reason?: string
}

/**
 * Why a mission sits with its driver: what it costs in its route (km and minutes it adds there)
 * against the cheapest feasible place in every other route, or why it cannot go there. Same
 * simulator as the optimiser; figures are the difference of the simulated route totals.
 */
export function explainAssignment(
  missionId: string,
  drivers: Driver[],
  routes: Route[],
  ctx: CostContext,
): AssignmentAlternative[] {
  const home = routes.find(r => r.missions.some(m => m.id === missionId))
  const m = home?.missions.find(x => x.id === missionId)
  if (!home || !m) return []
  const totals = (driverId: string, missions: Mission[]) =>
    simulateRouteTrace({ driverId, missions }, ctx, drivers)
  const out: AssignmentAlternative[] = []
  for (const d of drivers) {
    const route = routes.find(r => r.driverId === d.id) ?? { driverId: d.id, missions: [] }
    const without = route.missions.filter(x => x.id !== missionId)
    const base = totals(d.id, without)
    if (!base) continue
    if (!isHfvrpCompatible(m, d)) {
      out.push({
        driverId: d.id,
        chosen: false,
        feasible: false,
        extraKm: null,
        extraMin: null,
        reason: reasonMessage('BIN_SIZE', m, ctx),
      })
      continue
    }
    const li = loadIssueAlone(m, d)
    if (li) {
      out.push({
        driverId: d.id,
        chosen: false,
        feasible: false,
        extraKm: null,
        extraMin: null,
        reason: reasonMessage(li, m, ctx),
      })
      continue
    }
    if (m.requiredSkills?.some(sk => !(d.skills ?? []).includes(sk))) {
      out.push({
        driverId: d.id,
        chosen: false,
        feasible: false,
        extraKm: null,
        extraMin: null,
        reason: reasonMessage('SKILL', m, ctx),
      })
      continue
    }
    const chosen = d.id === home.driverId
    // The chosen route is measured as planned; the others at their cheapest feasible position.
    const positions = chosen
      ? [route.missions.findIndex(x => x.id === missionId)]
      : Array.from({ length: without.length + 1 }, (_, i) => i)
    let best: { km: number; min: number; codes: SimViolationCode[] } | null = null
    for (const pos of positions) {
      const t = totals(d.id, [...without.slice(0, pos), m, ...without.slice(pos)])
      if (!t) continue
      const codes = t.violations
        .filter(v => v.missionId === m.id || ROUTE_HARD.has(v.code))
        .map(v => v.code)
      const cand = {
        km: t.totals.distanceKm - base.totals.distanceKm,
        min: t.totals.workMin + t.totals.waitMin - (base.totals.workMin + base.totals.waitMin),
        codes,
      }
      const better =
        !best ||
        (cand.codes.length === 0 && best.codes.length > 0) ||
        (cand.codes.length === best.codes.length && cand.min < best.min)
      if (better) best = cand
    }
    if (!best) continue
    const feasible = best.codes.length === 0
    out.push({
      driverId: d.id,
      chosen,
      feasible,
      extraKm: Math.round(best.km * 10) / 10,
      extraMin: Math.round(best.min),
      ...(feasible ? {} : { reason: reasonMessage(toReason(best.codes[0]), m, ctx) }),
    })
  }
  return out.sort(
    (a, b) =>
      Number(b.chosen) - Number(a.chosen) ||
      Number(b.feasible) - Number(a.feasible) ||
      (a.extraMin ?? 1e9) - (b.extraMin ?? 1e9),
  )
}
