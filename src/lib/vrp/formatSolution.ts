import { minToHHMM } from '@/lib/algorithm'
import {
  MAX_WORK_MIN,
  MAX_DRIVING_MIN,
  P1_DEADLINE_MIN,
  computeDriverScore,
  computeDistributionScore,
} from '@/lib/constraints'
import type { Mission, Driver, Exutoire, PlannedMission, OptimizationResult } from '@/lib/types'
import type { VRPSolution, CostContext } from './types'
import { cachedDist } from './distanceCache'
import { isHfvrpCompatible } from './hfvrp'
import { isAllerRetourCompatible, simulateRouteTrace, type RouteTrace, type TraceEvent } from './routeCost'
import { getFamiliarityBonus } from '@/lib/familiarityLoader'
import { realDistanceKm } from './realDistance'
import { loadIssueAlone } from './vehicleLoad'

const _routeWorkCache = new WeakMap<{ missions: Mission[] }, { work: number; travel: number; len: number }>()

function insertionCost(
  route: { missions: Mission[] },
  position: number,
  mission: Mission,
  driver: Driver,
  ctx: CostContext,
): number {
  const safeSpeed = Math.max(10, ctx.speedKmh)
  const missions = route.missions
  const mDur = (mission.estimatedDurationMin ?? 0) + (mission.maneuverTimeMin ?? 0)

  const startOverride = ctx.driverStartOverrides?.get(driver.id)
  const startLat = startOverride?.lat ?? driver.depotLat
  const startLng = startOverride?.lng ?? driver.depotLng

  const prevLat = position > 0 ? missions[position - 1].latitude : startLat
  const prevLng = position > 0 ? missions[position - 1].longitude : startLng
  const nextLat = position < missions.length ? missions[position].latitude : startLat
  const nextLng = position < missions.length ? missions[position].longitude : startLng

  const prevId = position > 0 ? missions[position - 1].id : `depot:${driver.id}`
  const nextId = position < missions.length ? missions[position].id : `depot:${driver.id}`

  const distBefore = realDistanceKm(ctx, prevId, prevLat, prevLng, nextId, nextLat, nextLng)

  const distToMission   = realDistanceKm(ctx, prevId, prevLat, prevLng, mission.id, mission.latitude, mission.longitude)
  const distFromMission = realDistanceKm(ctx, mission.id, mission.latitude, mission.longitude, nextId, nextLat, nextLng)

  const distDelta = distToMission + distFromMission - distBefore

  const timeDelta = (distDelta / safeSpeed) * 60 + mDur

  let routeWork: number
  let routeTravel: number
  const cachedEntry = _routeWorkCache.get(route)
  if (cachedEntry && cachedEntry.len === missions.length) {
    routeWork   = cachedEntry.work
    routeTravel = cachedEntry.travel
  } else {
    routeWork = missions.reduce((sum, m) => sum + (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0), 0)
    routeTravel = missions.reduce((sum, m, i) => {
      const pLat = i > 0 ? missions[i - 1].latitude : driver.depotLat
      const pLng = i > 0 ? missions[i - 1].longitude : driver.depotLng
      return sum + (cachedDist(pLat, pLng, m.latitude, m.longitude) / safeSpeed) * 60
    }, 0)
    _routeWorkCache.set(route, { work: routeWork, travel: routeTravel, len: missions.length })
  }
  const totalWork = routeWork + routeTravel + timeDelta
  const overtimePenalty = totalWork > MAX_WORK_MIN ? (totalWork - MAX_WORK_MIN) * 50 : 0

  const balanceActive = (ctx.weights?.balance ?? 0.3) > 0.5
  const satMultiplier = balanceActive ? 5 : 1
  const workRatio = totalWork / MAX_WORK_MIN
  const saturationPenalty = (
    workRatio > 0.80 ? (workRatio - 0.80) * 300 * satMultiplier
    : workRatio > 0.50 ? (workRatio - 0.50) * 50 * satMultiplier
    : workRatio > 0.30 && balanceActive ? (workRatio - 0.30) * 30
    : 0
  )

  const missionCountPenalty = balanceActive ? missions.length * missions.length * 2 : 0

  let twPenalty = 0
  if (mission.timeWindow) {
    const arrivalEst = ctx.startTimeMin + routeTravel + (distToMission / safeSpeed) * 60
    const { openMin, closeMin } = mission.timeWindow

    if (closeMin && arrivalEst > closeMin) {
      twPenalty += (arrivalEst - closeMin) * 10
    }

    if (openMin && arrivalEst < openMin) {
      const waitMin = openMin - arrivalEst

      twPenalty += waitMin > 15 ? (waitMin - 15) * 2 : 0
    }
  }

  let p1Penalty = 0
  if (mission.priority === 1) {
    const arrivalEst = ctx.startTimeMin + routeTravel + (distToMission / safeSpeed) * 60
    const deadline = Math.max(P1_DEADLINE_MIN, ctx.startTimeMin + 240)
    if (arrivalEst > deadline) {
      p1Penalty = (arrivalEst - deadline) * 30
    }
  }

  if (mission.dependsOnId) {
    const depIdx = missions.findIndex(m => m.id === mission.dependsOnId)
    if (depIdx >= 0 && position <= depIdx) {

      return 100000
    }
  }

  let wasteClusterBonus = 0
  if (mission.wasteTypeLabel && missions.length > 0) {
    const sameWasteCount = missions.filter(m =>
      m.wasteTypeLabel === mission.wasteTypeLabel &&
      (m.type === 'RETIRER' || m.type === 'ECHANGER' || m.type === 'CHARGER_IMMEDIAT')
    ).length

    wasteClusterBonus = sameWasteCount * -5
  }

  let exutoireBonus = 0
  if (mission.linkedExutoireId && missions.length > 0) {
    const sameExutoire = missions.filter(m => m.linkedExutoireId === mission.linkedExutoireId).length
    exutoireBonus = sameExutoire * -3
  }

  const familiarityBonus = getFamiliarityBonus(
    ctx.familiarity, driver.id, mission.siteId, ctx.weights?.stability ?? 0,
  )

  return distDelta * 1.5 + timeDelta * 0.5 + overtimePenalty + saturationPenalty + missionCountPenalty + twPenalty + p1Penalty + wasteClusterBonus + exutoireBonus + familiarityBonus
}

export function buildInitialSolution(
  missions: Mission[],
  drivers: Driver[],
  ctx: CostContext,
  existingPlans?: Record<string, string[]>,
): VRPSolution {
  if (drivers.length === 0) {
    return { routes: [], cost: 0 }
  }

  const routes: VRPSolution['routes'] = drivers.map(d => ({
    driverId: d.id,
    missions: [],
  }))

  const assignedIds = new Set<string>()

  if (existingPlans) {
    for (const [driverId, missionIds] of Object.entries(existingPlans)) {
      const routeIdx = routes.findIndex(r => r.driverId === driverId)
      if (routeIdx === -1) continue
      for (const mId of missionIds) {
        const m = missions.find(x => x.id === mId)
        if (!m || assignedIds.has(m.id)) continue

        if (!isHfvrpCompatible(m, drivers[routeIdx])) continue
        if (!isAllerRetourCompatible(routes[routeIdx].missions, m.type)) continue
        routes[routeIdx].missions.push(m)
        assignedIds.add(m.id)
      }
    }
  }

  const unassigned = missions.filter(m => !assignedIds.has(m.id))

  unassigned.sort((a, b) => {
    const pa = a.priority ?? 4
    const pb = b.priority ?? 4
    if (pa !== pb) return pa - pb

    const twWidthA = a.timeWindow ? (a.timeWindow.closeMin - a.timeWindow.openMin) : 1440
    const twWidthB = b.timeWindow ? (b.timeWindow.closeMin - b.timeWindow.openMin) : 1440
    if (twWidthA !== twWidthB) return twWidthA - twWidthB

    const twCloseA = a.timeWindow?.closeMin ?? 1440
    const twCloseB = b.timeWindow?.closeMin ?? 1440
    return twCloseA - twCloseB
  })

  const remaining = new Set(unassigned.map(m => m.id))
  const missionMap = new Map(missions.map(m => [m.id, m]))

  while (remaining.size > 0) {

    let bestRegretMissionId = ''
    let bestRegret = -Infinity
    let bestInsertRouteIdx = 0
    let bestInsertPos = 0
    let bestInsertCost = Infinity

    for (const mId of remaining) {
      const mission = missionMap.get(mId)!

      const insertions: { routeIdx: number; pos: number; cost: number }[] = []

      for (let ri = 0; ri < routes.length; ri++) {
        const driver = drivers[ri]
        if (!isHfvrpCompatible(mission, driver)) continue
        // Static infeasibilities — never seed a route the final validation would undo.
        if (loadIssueAlone(mission, driver)) continue
        if (mission.requiredSkills?.some(sk => !(driver.skills ?? []).includes(sk))) continue
        if (!isAllerRetourCompatible(routes[ri].missions, mission.type)) continue

        const route = routes[ri]

        for (let pos = 0; pos <= route.missions.length; pos++) {
          const cost = insertionCost(route, pos, mission, driver, ctx)
          insertions.push({ routeIdx: ri, pos, cost })
        }
      }

      if (insertions.length === 0) {

        let fallbackIdx = -1
        for (let ri = 0; ri < routes.length; ri++) {
          if (!isAllerRetourCompatible(routes[ri].missions, mission.type)) continue
          if (fallbackIdx === -1 || routes[ri].missions.length < routes[fallbackIdx].missions.length) {
            fallbackIdx = ri
          }
        }
        if (fallbackIdx === -1) fallbackIdx = 0
        routes[fallbackIdx].missions.push(mission)
        remaining.delete(mId)
        continue
      }

      insertions.sort((a, b) => a.cost - b.cost)

      const best1 = insertions[0]
      const best2 = insertions.length > 1 ? insertions[1] : insertions[0]
      const best3 = insertions.length > 2 ? insertions[2] : best2

      const regret = best3.cost - best1.cost

      const priorityBonus = mission.priority === 1 ? 10000 : mission.priority === 2 ? 1000 : 0

      const effectiveRegret = regret + priorityBonus

      if (effectiveRegret > bestRegret || (effectiveRegret === bestRegret && best1.cost < bestInsertCost)) {
        bestRegret = effectiveRegret
        bestRegretMissionId = mId
        bestInsertRouteIdx = best1.routeIdx
        bestInsertPos = best1.pos
        bestInsertCost = best1.cost
      }
    }

    if (!bestRegretMissionId) break

    const mission = missionMap.get(bestRegretMissionId)!
    routes[bestInsertRouteIdx].missions.splice(bestInsertPos, 0, mission)
    remaining.delete(bestRegretMissionId)
  }

  return { routes, cost: 0 }
}

const BREAK_LABEL: Record<NonNullable<PlannedMission['breakKind']>, string> = {
  FULL:         'Pause réglementaire',
  SPLIT_FIRST:  'Pause réglementaire (1re partie)',
  SPLIT_SECOND: 'Pause réglementaire (2e partie)',
  WORK:         'Pause (temps de travail)',
  LUNCH:        'Pause déjeuner',
}

/** Plan steps of one simulated route: missions, exutoire trips, breaks — in driving order. */
function traceToPlannedSteps(trace: RouteTrace, date: string): PlannedMission[] {
  const planned: PlannedMission[] = []
  let seq = 0
  let pendingBreaks: Extract<TraceEvent, { kind: 'break' }>[] = []

  // Breaks belong to the leg that ends at the next destination; their offsets split its travel.
  const flushBreaks = (legTravelMin: number): number => {
    let driven = 0
    for (const b of pendingBreaks) {
      const offset = b.legOffsetMin < 0 ? legTravelMin : Math.min(legTravelMin, b.legOffsetMin)
      const kind = b.breakKind
      const label = b.reason === 'WAIT' ? `${BREAK_LABEL[kind]} pendant l'attente` : BREAK_LABEL[kind]
      planned.push({
        id:                   `_pause_${trace.driverId}_${seq}`,
        type:                 'PAUSE',
        date,
        address:              `${label} (${Math.round(b.durationMin)} min)`,
        latitude:             b.lat,
        longitude:            b.lng,
        estimatedDurationMin: b.durationMin,
        maneuverTimeMin:      0,
        sequenceOrder:        seq++,
        isSynthetic:          true,
        precomputedTravelMin: Math.max(0, offset - driven),
        breakKind:            kind,
      })
      driven = Math.max(driven, offset)
    }
    pendingBreaks = []
    return driven
  }

  for (const ev of trace.events) {
    switch (ev.kind) {
      case 'break':
        pendingBreaks.push(ev)
        break
      case 'mission': {
        const driven = flushBreaks(ev.travelMin)
        planned.push({
          ...ev.mission,
          sequenceOrder:        seq++,
          precomputedTravelMin: Math.max(0, ev.travelMin - driven),
          ...(ev.loadKg > 0 ? { plannedLoadKg: Math.round(ev.loadKg) } : {}),
        })
        break
      }
      case 'exutoire': {
        const driven = flushBreaks(ev.travelMin)
        const ex = ev.exutoire
        const id = ev.allerRetour ? `_vider_ar_${ex.id}_${ev.forMissionId}`
          : ev.beforePickup ? `_vider_pre_${ex.id}_${ev.forMissionId}`
          : `_vider_${ex.id}_${ev.forMissionId}`
        planned.push({
          id,
          type:                 'VIDER',
          date,
          clientName:           ex.name,
          address:              ex.address,
          latitude:             ex.lat,
          longitude:            ex.lng,
          estimatedDurationMin: ex.serviceTimeMin,
          maneuverTimeMin:      0,
          linkedExutoireId:     ex.id,
          sequenceOrder:        seq++,
          isSynthetic:          true,
          precomputedTravelMin: Math.max(0, ev.travelMin - driven),
        })
        break
      }
      case 'repose': {
        const driven = flushBreaks(ev.travelMin)
        const m = ev.mission
        planned.push({
          id:                   `_pose_ar_${m.id}`,
          type:                 'POSER',
          date,
          clientName:           m.clientName,
          address:              m.address,
          latitude:             m.latitude,
          longitude:            m.longitude,
          estimatedDurationMin: ev.departureMin - ev.arrivalMin,
          maneuverTimeMin:      0,
          accessNotes:          m.accessNotes,
          sequenceOrder:        seq++,
          isSynthetic:          true,
          precomputedTravelMin: Math.max(0, ev.travelMin - driven),
        })
        break
      }
      case 'return':
        // Breaks needed on the way home are the last steps of the day.
        flushBreaks(ev.travelMin)
        break
    }
  }
  return planned
}

/** Field-readable warnings for one route, from the violations its simulation recorded. */
function traceWarnings(trace: RouteTrace, ctx: CostContext, maxWorkMin: number): OptimizationResult['warnings'] {
  const out: OptimizationResult['warnings'] = []
  const missionEv = new Map<string, Extract<TraceEvent, { kind: 'mission' }>>()
  const exById = new Map<string, Exutoire>()
  const missionById = new Map<string, Mission>()
  for (const ev of trace.events) {
    if (ev.kind === 'mission') { missionEv.set(ev.mission.id, ev); missionById.set(ev.mission.id, ev.mission) }
    if (ev.kind === 'exutoire') exById.set(ev.exutoire.id, ev.exutoire)
  }
  const startMin = ctx.driverStartOverrides?.get(trace.driverId)?.timeMin ?? ctx.startTimeMin
  const p1Deadline = Math.min(1320, Math.max(P1_DEADLINE_MIN, startMin + 240))
  const seen = new Set<string>()
  const push = (message: string, severity: 'warning' | 'error') => {
    if (seen.has(message)) return
    seen.add(message)
    out.push({ driverId: trace.driverId, message, severity })
  }
  for (const v of trace.violations) {
    const ev = v.missionId ? missionEv.get(v.missionId) : undefined
    const m = v.missionId ? missionById.get(v.missionId) : undefined
    const label = m ? (m.clientName || m.address) : (v.missionId ?? '')
    switch (v.code) {
      case 'TIME_WINDOW':
        if (ev && m?.timeWindow) push(`Mission ${m.id} (${m.address}) : arrivée à ${minToHHMM(ev.startMin)}, après la fermeture de la fenêtre (${minToHHMM(m.timeWindow.closeMin)})`, 'warning')
        break
      case 'P1_LATE':
        if (ev && m) push(`Mission P1 ${m.id} servie après ${minToHHMM(p1Deadline)} (${minToHHMM(ev.startMin)})`, 'error')
        break
      case 'EXUTOIRE_CLOSED': {
        const ex = v.exutoireId ? exById.get(v.exutoireId) : undefined
        if (ex) push(`Exutoire "${ex.name}" : arrivée hors horaires${v.amount ? ` (${Math.round(v.amount)} min après la fermeture)` : ''}`, 'warning')
        break
      }
      case 'NO_EXUTOIRE':
        push(`Mission "${label}" : aucun exutoire ouvert n'accepte ce déchet ce jour-là`, 'warning')
        break
      case 'WORK_TIME':
        push(`Durée de travail totale dépasse ${Math.round(maxWorkMin / 60)}h (${Math.round(trace.totals.workMin)} min)`, 'error')
        break
      case 'DAILY_DRIVING':
        push(`Durée de conduite dépasse 9h (${Math.round(trace.totals.drivingMin)} min) — CE 561/2006`, 'error')
        break
      case 'DEPENDENCY':
        push(`Mission "${label}" planifiée avant la mission dont elle dépend`, 'warning')
        break
      case 'BIN_SIZE':
        push(`Mission "${label}" : benne ${v.amount ?? ''} m³ trop grande pour le véhicule`, 'error')
        break
      case 'PAYLOAD':
        push(`Mission "${label}" : ${Math.round(v.amount ?? 0)} kg dépassent la charge utile du véhicule`, 'error')
        break
      case 'VOLUME':
        push(`Mission "${label}" : ${v.amount ?? ''} m³ dépassent le volume du véhicule`, 'error')
        break
      case 'SKILL':
        push(`Mission "${label}" : compétence requise absente chez le chauffeur`, 'error')
        break
      case 'NO_EMPTY_BIN':
        push(`Mission "${label}" : plus de benne vide disponible dans le camion`, 'error')
        break
    }
  }
  return out
}

/**
 * Turns a solution into the API result: every route is replayed through the cost simulator
 * ({@link simulateRouteTrace}) and its trace becomes the plan — breaks, lunch, exutoire trips and
 * timings are exactly those the optimiser costed.
 */
export function formatSolutionForAPI(
  solution: VRPSolution,
  drivers: Driver[],
  ctx: CostContext,
): OptimizationResult {
  const { exutoires, date } = ctx
  const maxWorkMin = ctx.maxWorkMin ?? MAX_WORK_MIN

  const assignments: Record<string, PlannedMission[]> = {}
  const warnings: OptimizationResult['warnings']      = []
  const exutoireArrivals = new Map<string, number[]>()
  const assignedIds = new Set<string>()

  const driverScores:    number[] = []
  const workMinByDriver: number[] = []

  for (const route of solution.routes) {
    if (route.missions.length === 0) continue
    const trace = simulateRouteTrace(route, ctx, drivers)
    if (!trace) continue

    const planned = traceToPlannedSteps(trace, date)
    for (const m of route.missions) assignedIds.add(m.id)
    for (const ev of trace.events) {
      if (ev.kind !== 'exutoire') continue
      const arr = exutoireArrivals.get(ev.exutoire.id) ?? []
      arr.push(ev.arrivalMin)
      exutoireArrivals.set(ev.exutoire.id, arr)
    }
    const routeWarnings = traceWarnings(trace, ctx, maxWorkMin)
    warnings.push(...routeWarnings)
    if (planned.length > 0) assignments[route.driverId] = planned

    const t = trace.totals
    const ds = computeDriverScore({
      workMin:          t.workMin,
      drivingMin:       t.drivingMin,
      onSiteMin:        t.onSiteMin,
      roadDistKm:       t.distanceKm,
      hasOvertime:      t.workMin > maxWorkMin,
      hasBreachDriving: t.drivingMin > MAX_DRIVING_MIN,
      warnings:         routeWarnings.filter(w => w.severity === 'warning').length,
    })
    driverScores.push(ds.total)
    workMinByDriver.push(t.workMin)
  }

  for (const [exId, arrivals] of exutoireArrivals) {
    if (arrivals.length < 3) continue
    const sorted = [...arrivals].sort((a, b) => a - b)
    let congestWindow = false
    for (let ci = 0; ci <= sorted.length - 3; ci++) {
      if (sorted[ci + 2] - sorted[ci] <= 30) { congestWindow = true; break }
    }
    if (congestWindow) {
      const ex = exutoires.find(e => e.id === exId)
      warnings.push({
        driverId: '',
        message:  `Congestion à l'exutoire "${ex?.name ?? exId}" : ${arrivals.length} passages dont 3+ dans une fenêtre de 30 min`,
        severity: 'warning',
      })
    }
  }

  const allMissions = solution.routes.flatMap(r => r.missions)
  const unassignedMissions = allMissions.filter(m => !assignedIds.has(m.id))
  const assignedCount = assignedIds.size
  const totalCount    = allMissions.length

  const assignmentRatio = totalCount > 0 ? assignedCount / totalCount : 1
  const baseScore = computeDistributionScore(driverScores, workMinByDriver)
  const score = Math.max(0, Math.round(baseScore * assignmentRatio))

  return {
    assignments,
    unassignedMissions,
    stats: {
      assignedMissions: assignedCount,
      totalMissions:    totalCount,
      score,
      globalScore:      score,
      timeTakenMs:      0,
    },
    warnings,
  }
}
