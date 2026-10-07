import type { Mission, Driver, Exutoire, OptimizationResult } from '@/lib/types'
import type { ALNSParams, CostContext, VRPSolution } from './types'
import { buildInitialSolution, formatSolutionForAPI } from './formatSolution'
import { runMvAlns } from './mvAlns'
import { computeRouteCost, computeSolutionCost, isAllerRetourCompatible } from './routeCost'
import { buildSectors, rebalanceSectors } from './sector'
import { crossRouteOrOpt, threeOptOnWorstRoutes, ejectionChainSearch } from './operators'
import { isHfvrpCompatible } from './hfvrp'
import { resetExutoireCongestion } from './exutoireSearch'
import { runSectorsInParallel } from './threadPool'
import type { SectorWorkerInput } from './sectorWorker'
import { applyMLCoefficients, getTravelCoeff } from '@/lib/mlCoefficients'
import { loadFamiliarity } from '@/lib/familiarityLoader'
import { buildValhallaMatrix, type GeoPoint } from './valhallaMatrix'
import { buildExternalRoutingMatrix } from './externalRoutingApi'
import { generateScenarios, evaluateCVaR } from './stochastic'
import { createLogger } from '@/lib/logger'
import { validateAndRepair, explainUnassigned, reasonMessage, type UnassignedReasonCode } from './explain'
import { loadIssueAlone } from './vehicleLoad'
import type { RegulationRules } from './driverClock'
import type { DriverStartOverride } from './types'

const log = createLogger('vrp')
import { computeObjectives, filterParetoFront, labelParetoSolutions } from './paretoFront'
import type { ParetoSolution } from './paretoFront'

const DEFAULT_TIME_BUDGET_MS = 15_000
const DEFAULT_SEED            = 42
/** Per-tenant lookups made before solving (calibration, routing licence) give up after this. */
const TENANT_LOOKUP_TIMEOUT_MS = 2_000
const DEFAULT_DESTROY_RATIO   = 0.25

const SECTOR_THRESHOLD = 20

function targetSectorSize(nDrivers: number): number {
  if (nDrivers <= 50)  return 15
  if (nDrivers <= 150) return 12
  if (nDrivers <= 300) return 8
  if (nDrivers <= 600) return 6
  return 5
}

function scaleAlnsParams(nDrivers: number, nMissions: number, timeBudgetMs: number) {

  const iterScale = Math.max(0.5, Math.min(2.0, 15_000 / Math.max(1, timeBudgetMs)))
  const baseIter  = nMissions > 10_000 ? 200
                  : nMissions > 5_000  ? 300
                  : nMissions > 1_000  ? 400
                  : 500
  const iterations = Math.max(50, Math.round(baseIter / iterScale))

  const destroyRatio = nMissions > 10_000 ? 0.15
                     : nMissions > 5_000  ? 0.20
                     : nMissions > 1_000  ? 0.22
                     : DEFAULT_DESTROY_RATIO

  const saT0Ratio  = nDrivers > 500 ? 0.07 : nDrivers > 100 ? 0.06 : 0.05
  const saTMinRatio = nDrivers > 500 ? 0.0004 : nDrivers > 100 ? 0.0003 : 0.0002

  return { iterations, destroyRatio, saT0Ratio, saTMinRatio }
}

export async function runVRP(
  missions:  Mission[],
  drivers:   Driver[],
  exutoires: Exutoire[],
  date:      string,
  options?: {
    timeBudgetMs?:  number
    seed?:          number
    lnsIterations?: number
    lnsDestroyRatio?: number
    existingPlans?: Record<string, string[]>
    defaultSpeedKmh?:  number
    defaultStartTime?: string

    weights?: { distance: number; punctuality: number; balance: number; stability?: number }

    tenantId?: string

    valhallaFactor?: number

    usePareto?: boolean

    /** Driving/working-time rules (tenant settings may only make them stricter). */
    regulation?: RegulationRules
    /** Maximum work per day, breaks excluded (min). */
    maxWorkMin?: number
    /** Tenant cost/lunch configuration. */
    costConfig?: CostContext['costConfig']
    /** Mid-day restart: live position, regulatory counters and load per driver. */
    driverStartOverrides?: Map<string, DriverStartOverride>
    /** Notices computed by the caller (drivers left out, …) returned with the result. */
    extraWarnings?: OptimizationResult['warnings']
  },
): Promise<OptimizationResult> {
  const startTs = Date.now()

  // Duplicate ids would be placed once and silently dropped by every id-keyed structure below.
  const duplicateIds: string[] = []
  {
    const seen = new Set<string>()
    missions = missions.filter(m => {
      if (seen.has(m.id)) { duplicateIds.push(m.id); return false }
      seen.add(m.id)
      return true
    })
  }

  drivers = drivers.map(d => {
    if (!d.startingExutoireId) return d
    const ex = exutoires.find(e => e.id === d.startingExutoireId)
    if (!ex) return d
    return { ...d, depotLat: ex.lat, depotLng: ex.lng }
  })

  const globalCongestion = resetExutoireCongestion()

  const timeBudgetMs   = options?.timeBudgetMs    ?? DEFAULT_TIME_BUDGET_MS
  const seed           = options?.seed            ?? DEFAULT_SEED
  // An empty warm-start map is "no warm start" — callers pass {} by default, which used to
  // disable the GRASP multi-start entirely.
  const existingPlans  = options?.existingPlans && Object.keys(options.existingPlans).length > 0
    ? options.existingPlans
    : undefined

  let calibratedMissions = missions

  let effectiveValhallaFactor = options?.valhallaFactor ?? 1.60
  // Local copy — mutating options.defaultSpeedKmh directly would mutate the CALLER's object
  // (options is a reference the caller still holds), fragile if it's ever reused across calls.
  let effectiveDefaultSpeedKmh = options?.defaultSpeedKmh
  if (options?.tenantId) {
    try {
      // Calibration is a refinement: a slow or unreachable database must not hold the solver.
      const { withTimeout } = await import('@/lib/queue/connection')
      calibratedMissions = await withTimeout(applyMLCoefficients(options.tenantId, missions), TENANT_LOOKUP_TIMEOUT_MS, 'ML calibration')

      const travelCoeff = await withTimeout(getTravelCoeff(options.tenantId), TENANT_LOOKUP_TIMEOUT_MS, 'travel coefficient')
      if (travelCoeff !== 1.0) {
        if (effectiveDefaultSpeedKmh) {
          effectiveDefaultSpeedKmh = Math.round(effectiveDefaultSpeedKmh / travelCoeff)
        }

        effectiveValhallaFactor *= travelCoeff
      }
    } catch (err) {
      log.warn('ML coefficient calibration failed — falling back to uncalibrated missions', {
        tenantId: options.tenantId, err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const hfvrpWarnings: OptimizationResult['warnings'] = []
  const unassignableByCapacity: Mission[] = []
  const assignableMissions: Mission[] = []
  // Why a mission was set aside before the search (no available truck can physically take it).
  const knownReasons = new Map<string, UnassignedReasonCode>()

  for (const mission of calibratedMissions) {
    if (drivers.length === 0) { assignableMissions.push(mission); continue }
    if (mission.binSizeM3 && !drivers.some(d => !d.maxBinSizeM3 || mission.binSizeM3! <= d.maxBinSizeM3)) {
      unassignableByCapacity.push(mission)
      knownReasons.set(mission.id, 'BIN_SIZE')
      hfvrpWarnings.push({
        driverId: '',
        message:  `${mission.clientName || 'Mission'} (${mission.address}) : benne ${mission.binSizeM3} m³ incompatible avec tous les véhicules disponibles`,
        severity: 'error',
      })
      continue
    }
    const loadIssues = drivers.map(d => loadIssueAlone(mission, d))
    if (loadIssues.every(Boolean)) {
      const code = loadIssues.includes('PAYLOAD') ? 'PAYLOAD' : 'VOLUME'
      unassignableByCapacity.push(mission)
      knownReasons.set(mission.id, code)
      hfvrpWarnings.push({ driverId: '', message: `${mission.clientName || 'Mission'} (${mission.address}) : ${reasonMessage(code, mission)}`, severity: 'error' })
      continue
    }
    assignableMissions.push(mission)
  }

  if (drivers.length === 0) {
    return {
      assignments:        {},
      unassignedMissions: calibratedMissions,
      unassignedReasons:  Object.fromEntries(calibratedMissions.map(m => [m.id, { code: 'NO_DRIVER', message: reasonMessage('NO_DRIVER', m) }])),
      stats: {
        assignedMissions: 0,
        totalMissions:    missions.length,
        score:            0,
        timeTakenMs:      Date.now() - startTs,
      },
      warnings: [
        {
          driverId: '',
          message:  'Aucun chauffeur disponible pour optimiser les tournées',
          severity: 'error',
        },
        ...(options?.extraWarnings ?? []),
        ...hfvrpWarnings,
      ],
    }
  }

  let familiarity: import('./types').FamiliarityMap | undefined
  if (options?.tenantId && options?.weights?.stability && options.weights.stability > 0) {
    try {
      familiarity = await loadFamiliarity(options.tenantId)
    } catch (err) {
      log.warn('Familiarity load failed — continuing without stability bonus', {
        tenantId: options.tenantId, err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const refDriver = drivers[0]
  const ctx: CostContext = {
    depotLat:     refDriver.depotLat ?? 0,
    depotLng:     refDriver.depotLng ?? 0,
    startTimeMin: (() => {
      const t = options?.defaultStartTime ?? '07:00'
      const parts = t.split(':').map(Number)
      const h = Math.max(0, Math.min(23, parts[0] || 0))
      const m = Math.max(0, Math.min(59, parts[1] || 0))
      return h * 60 + m
    })(),
    speedKmh:     Math.max(1, Math.min(130, effectiveDefaultSpeedKmh ?? 50)),
    exutoires,
    date,
    weights: options?.weights,
    familiarity,

    driverStartOverrides: options?.driverStartOverrides,
    regulation:           options?.regulation,
    maxWorkMin:           options?.maxWorkMin,
    costConfig:           options?.costConfig,

    congestionMap: globalCongestion,

    valhallaFactor: effectiveValhallaFactor,
  }

  try {
    const allGeoPoints: GeoPoint[] = []
    const seenIds = new Set<string>()

    for (const m of assignableMissions) {
      if (!seenIds.has(m.id)) {
        allGeoPoints.push({ id: m.id, lat: m.latitude, lng: m.longitude })
        seenIds.add(m.id)
      }
    }
    for (const d of drivers) {
      const depotId = `depot:${d.id}`
      if (!seenIds.has(depotId)) {
        allGeoPoints.push({ id: depotId, lat: d.depotLat, lng: d.depotLng })
        seenIds.add(depotId)
      }
    }
    for (const e of exutoires) {
      const exuId = `exu:${e.id}`
      if (!seenIds.has(exuId)) {
        allGeoPoints.push({ id: exuId, lat: e.lat, lng: e.lng })
        seenIds.add(exuId)
      }
    }

    if (allGeoPoints.length >= 2) {

      const worstCaseDims = {
        weightTon: drivers.reduce((m, d) => Math.max(m, d.vehicleDimensions?.weightTon ?? 26), 0),
        heightM:   drivers.reduce((m, d) => Math.max(m, d.vehicleDimensions?.heightM ?? 4.0), 0),
        widthM:    drivers.reduce((m, d) => Math.max(m, d.vehicleDimensions?.widthM ?? 2.55), 0),
        lengthM:   drivers.reduce((m, d) => Math.max(m, d.vehicleDimensions?.lengthM ?? 12.0), 0),
        axleCount: drivers.reduce((m, d) => Math.max(m, d.vehicleDimensions?.axleCount ?? 3), 0),
        hazmat:    drivers.some(d => d.vehicleDimensions?.hazmat === true),
      }

      const provider = options?.tenantId
        ? await (await import('@/lib/queue/connection')).withTimeout((await import('./routingProvider')).tenantRoutingProvider(options.tenantId), TENANT_LOOKUP_TIMEOUT_MS, 'routing provider').catch(() => null)
        : null
      const apiMatrix = await buildExternalRoutingMatrix(allGeoPoints, undefined, provider)
      if (apiMatrix) {
        ctx.osrmMatrix = apiMatrix
        log.info('Routing matrix ready', { source: apiMatrix.source, points: allGeoPoints.length })
      } else {

        log.info('Building Valhalla matrix', { points: allGeoPoints.length })
        const valhallaMatrix = await buildValhallaMatrix(allGeoPoints, worstCaseDims)
        log.info('Valhalla matrix result', { source: valhallaMatrix.source, size: valhallaMatrix.size })
        if (valhallaMatrix.source !== 'haversine') {
          ctx.osrmMatrix = valhallaMatrix
        }

      }
    }
  } catch (matrixErr) {
    log.warn('Matrix build failed, falling back to haversine', { err: matrixErr instanceof Error ? matrixErr.message : String(matrixErr) })
  }

  // The search budget is what remains once the routing matrix is built (Valhalla can take
  // seconds); post-optimisation steps are scheduled from that point. Pareto alternatives, when
  // requested, come out of the same budget instead of adding 50 % on top of it.
  const algoStartTs  = Date.now()
  const remainingMs  = Math.max(Math.round(timeBudgetMs * 0.4), timeBudgetMs - (algoStartTs - startTs))
  const paretoShare  = options?.usePareto && drivers.length <= 300 ? 0.2 : 0
  // 2.1 s are reserved inside the budget for 3-opt, ejection chains, compaction and P1 repair.
  const POST_STEPS_MS = remainingMs > 6000 ? 2100 : Math.round(remainingMs * 0.2)
  const searchBudget = Math.max(300, Math.round(remainingMs * (1 - 2 * paretoShare)) - POST_STEPS_MS)
  const scaled = scaleAlnsParams(drivers.length, assignableMissions.length, searchBudget)
  const effectiveIterations   = options?.lnsIterations   ?? scaled.iterations
  const effectiveDestroyRatio = options?.lnsDestroyRatio ?? scaled.destroyRatio

  let best: VRPSolution

  if (drivers.length > SECTOR_THRESHOLD) {
    best = await runVRPWithSectors(
      assignableMissions, drivers, ctx, seed,
      effectiveIterations, effectiveDestroyRatio,
      searchBudget, existingPlans,
      scaled.saT0Ratio, scaled.saTMinRatio,
    )
  } else {

    const MULTI_START_COUNT = drivers.length <= 10 && assignableMissions.length <= 60 ? 3 : 1
    if (MULTI_START_COUNT > 1) {
      const perStartBudget = Math.floor(searchBudget / MULTI_START_COUNT)
      const perStartIter = Math.floor(effectiveIterations / MULTI_START_COUNT)
      let bestCost = Infinity
      best = { routes: drivers.map(d => ({ driverId: d.id, missions: [] })), cost: 0 }
      for (let s = 0; s < MULTI_START_COUNT; s++) {
        const startSeed = seed + s * 9973
        const candidate = runVRPDirect(
          assignableMissions, drivers, ctx, startSeed,
          perStartIter, effectiveDestroyRatio,
          perStartBudget, existingPlans,
          scaled.saT0Ratio, scaled.saTMinRatio,
        )
        const cost = computeSolutionCost(candidate.routes, ctx, drivers)
        if (cost < bestCost) { best = candidate; bestCost = cost }
      }
    } else {
      best = runVRPDirect(
        assignableMissions, drivers, ctx, seed,
        effectiveIterations, effectiveDestroyRatio,
        searchBudget, existingPlans,
        scaled.saT0Ratio, scaled.saTMinRatio,
      )
    }
  }

  if (!best || !best.routes) {
    best = { routes: drivers.map(d => ({ driverId: d.id, missions: [] })), cost: 0 }
  }

  const postDeadline = algoStartTs + searchBudget
  const threeOptDeadline = postDeadline + Math.round(POST_STEPS_MS * 0.57)
  if (Date.now() < threeOptDeadline && best.routes.length <= 500) {
    best = threeOptOnWorstRoutes(best, ctx, drivers, 5, threeOptDeadline)
  }

  const ejDeadline = postDeadline + Math.round(POST_STEPS_MS * 0.76)
  if (Date.now() < ejDeadline && best.routes.length <= 200) {
    best = ejectionChainSearch(best, ctx, drivers, ejDeadline, 3)
  }

  const compactDeadline = postDeadline + Math.round(POST_STEPS_MS * 0.9)
  if (Date.now() < compactDeadline && best.routes.length <= 200) {
    best = compactRoutes(best, ctx, drivers, compactDeadline)
  }

  best = batchByWasteType(best, ctx, drivers)

  const forceAssignDeadline = postDeadline + POST_STEPS_MS
  best = forceAssignP1(best, assignableMissions, ctx, drivers, hfvrpWarnings, forceAssignDeadline)

  let paretoFrontResult: Array<{ label: string; totalDistanceKm: number; totalLatenessMin: number; workloadCV: number }> | undefined
  if (options?.usePareto && drivers.length <= 300) {
    const paretoTimeBudget = Math.round(remainingMs * paretoShare)
    const paretoSolutions: ParetoSolution[] = [
      {
        solution: best,
        objectives: computeObjectives(best, ctx, drivers),
        label: 'Principal',
      },
    ]

    const ctxDist: CostContext = { ...ctx, weights: { distance: 3, punctuality: 1, balance: 1 } }
    const bestDist = drivers.length > SECTOR_THRESHOLD
      ? await runVRPWithSectors(assignableMissions, drivers, ctxDist, seed + 1, effectiveIterations, effectiveDestroyRatio, paretoTimeBudget, existingPlans, scaled.saT0Ratio, scaled.saTMinRatio)
      : runVRPDirect(assignableMissions, drivers, ctxDist, seed + 1, effectiveIterations, effectiveDestroyRatio, paretoTimeBudget, existingPlans, scaled.saT0Ratio, scaled.saTMinRatio)
    paretoSolutions.push({ solution: bestDist, objectives: computeObjectives(bestDist, ctxDist, drivers), label: 'Distance' })

    const ctxBal: CostContext = { ...ctx, weights: { distance: 1, punctuality: 1, balance: 3 } }
    const bestBal = drivers.length > SECTOR_THRESHOLD
      ? await runVRPWithSectors(assignableMissions, drivers, ctxBal, seed + 2, effectiveIterations, effectiveDestroyRatio, paretoTimeBudget, existingPlans, scaled.saT0Ratio, scaled.saTMinRatio)
      : runVRPDirect(assignableMissions, drivers, ctxBal, seed + 2, effectiveIterations, effectiveDestroyRatio, paretoTimeBudget, existingPlans, scaled.saT0Ratio, scaled.saTMinRatio)
    paretoSolutions.push({ solution: bestBal, objectives: computeObjectives(bestBal, ctxBal, drivers), label: 'Equilibre' })

    const front = filterParetoFront(paretoSolutions)
    labelParetoSolutions(front)

    const w = ctx.weights ?? { distance: 1, punctuality: 1, balance: 1 }
    const normalize = (arr: ParetoSolution[], key: keyof typeof arr[0]['objectives']) => {
      const vals = arr.map(s => s.objectives[key])
      const min = Math.min(...vals); const max = Math.max(...vals)
      return (v: number) => max === min ? 0 : (v - min) / (max - min)
    }
    const normDist = normalize(front, 'totalDistanceKm')
    const normLate = normalize(front, 'totalLatenessMin')
    const normBal  = normalize(front, 'workloadCV')
    let bestFront = front[0]
    let bestFrontScore = Infinity
    for (const s of front) {
      const score = normDist(s.objectives.totalDistanceKm) * w.distance
                  + normLate(s.objectives.totalLatenessMin) * w.punctuality
                  + normBal(s.objectives.workloadCV) * w.balance
      if (score < bestFrontScore) { bestFrontScore = score; bestFront = s }
    }
    best = bestFront.solution

    paretoFrontResult = front.map(s => ({
      label: s.label,
      totalDistanceKm: s.objectives.totalDistanceKm,
      totalLatenessMin: s.objectives.totalLatenessMin,
      workloadCV: s.objectives.workloadCV,
    }))
  }

  // Nothing non-executable leaves the optimiser: hard problems are taken out (and re-inserted
  // elsewhere when another truck can take them), the rest is explained below.
  const repaired = validateAndRepair(best, drivers, ctx, Date.now() + Math.max(500, Math.round(timeBudgetMs * 0.1)))
  best = repaired.solution
  for (const [id, r] of repaired.removed) knownReasons.set(id, r.code)

  const result = formatSolutionForAPI(best, drivers, ctx)
  result.unassignedMissions.push(...[...repaired.removed.values()].map(r => r.mission))

  const scenarios = generateScenarios(5, seed)
  const { cvarCost } = evaluateCVaR(best, ctx, drivers, scenarios)
  result.stats.cvarScore = Math.round(cvarCost * 10) / 10

  result.stats.objectives = computeObjectives(best, ctx, drivers)
  if (paretoFrontResult) result.stats.paretoFront = paretoFrontResult

  result.unassignedMissions.push(...unassignableByCapacity)
  result.warnings.push(...(options?.extraWarnings ?? []), ...hfvrpWarnings)
  enforceMissionConservation(result, calibratedMissions, duplicateIds, drivers)
  result.unassignedReasons = explainUnassigned(result.unassignedMissions, drivers, best.routes, ctx, knownReasons)
  result.stats.timeTakenMs = Date.now() - startTs
  result.stats.routingSource = ctx.osrmMatrix?.source ?? 'haversine'

  return result
}

/**
 * Last line of defence on the output: every input mission ends up exactly once — in one route
 * or in unassignedMissions. Whatever happened upstream (a failed sector, an operator bug, a
 * mission shared by two routes after a cross-sector move), nothing is silently lost or
 * planned twice; anything corrected is reported as a warning.
 */
export function enforceMissionConservation(result: OptimizationResult, inputMissions: Mission[], duplicateIds: string[] = [], drivers: Driver[] = []): void {
  const seen = new Set<string>()
  let removedDuplicates = 0
  // A bin the truck physically cannot carry is never shipped in a plan, whatever the search did.
  const driverById = new Map(drivers.map(d => [d.id, d]))
  const tooBig: Mission[] = []
  for (const driverId of Object.keys(result.assignments)) {
    const driver = driverById.get(driverId)
    result.assignments[driverId] = result.assignments[driverId].filter(m => {
      if (m.isSynthetic) return true
      if (seen.has(m.id)) { removedDuplicates++; return false }
      if (driver && !isHfvrpCompatible(m, driver)) { tooBig.push(m); return false }
      seen.add(m.id)
      return true
    })
  }
  for (const m of tooBig) {
    result.warnings.push({ driverId: '', message: `${m.clientName || 'Mission'} (${m.address}) : benne ${m.binSizeM3} m³ trop grande pour le véhicule — à replanifier`, severity: 'error' })
  }
  const unassignedIds = new Set(result.unassignedMissions.map(m => m.id))
  result.unassignedMissions = result.unassignedMissions.filter(m => !seen.has(m.id))
  const lost = inputMissions.filter(m => !seen.has(m.id) && !unassignedIds.has(m.id))
  if (lost.length > 0) {
    result.unassignedMissions.push(...lost)
    result.warnings.push({
      driverId: '',
      message:  `${lost.length} mission(s) n'ont pas pu être placées par l'optimiseur et restent à planifier`,
      severity: 'warning',
    })
    log.error('VRP output was missing missions — returned as unassigned', { count: lost.length, ids: lost.slice(0, 10).map(m => m.id) })
  }
  if (removedDuplicates > 0) {
    result.warnings.push({ driverId: '', message: `${removedDuplicates} doublon(s) de mission retiré(s) des tournées`, severity: 'warning' })
    log.error('VRP output contained duplicated missions — removed', { count: removedDuplicates })
  }
  if (duplicateIds.length > 0) {
    result.warnings.push({ driverId: '', message: `${duplicateIds.length} mission(s) en double dans la demande ont été ignorées`, severity: 'warning' })
  }
  result.stats.totalMissions    = inputMissions.length
  result.stats.assignedMissions = seen.size
}

function batchByWasteType(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
): VRPSolution {
  const result: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  for (const route of result.routes) {
    if (route.missions.length < 3) continue

    const baseCost = computeRouteCost(route, ctx, drivers)

    const p1Missions = route.missions.filter(m => m.priority === 1)
    const otherMissions = route.missions.filter(m => m.priority !== 1)

    if (otherMissions.length < 2) continue

    const groups = new Map<string, typeof otherMissions>()
    for (const m of otherMissions) {
      const key = m.wasteTypeLabel || '_unknown'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(m)
    }

    const reordered = [...p1Missions]
    for (const [, groupMissions] of groups) {

      const sorted: typeof groupMissions = []
      const remaining = [...groupMissions]

      let lastLat = reordered.length > 0 ? reordered[reordered.length - 1].latitude
        : (drivers.find(d => d.id === route.driverId)?.depotLat ?? 0)
      let lastLng = reordered.length > 0 ? reordered[reordered.length - 1].longitude
        : (drivers.find(d => d.id === route.driverId)?.depotLng ?? 0)

      while (remaining.length > 0) {
        let bestIdx = 0
        let bestDist = Infinity
        for (let i = 0; i < remaining.length; i++) {
          const d = (remaining[i].latitude - lastLat) ** 2 + (remaining[i].longitude - lastLng) ** 2
          if (d < bestDist) { bestDist = d; bestIdx = i }
        }
        const m = remaining.splice(bestIdx, 1)[0]
        sorted.push(m)
        lastLat = m.latitude
        lastLng = m.longitude
      }
      reordered.push(...sorted)
    }

    const original = route.missions
    route.missions = reordered
    const newCost = computeRouteCost(route, ctx, drivers)
    if (newCost >= baseCost) {
      // Keep the searched order — not "P1 first then the rest", which is a third, uncosted order.
      route.missions = original
    }
  }

  result.cost = computeSolutionCost(result.routes, ctx, drivers)
  return result
}

// Exported alongside forceAssignP1 for direct deadline-guard testing — see that function's
// comment for why (unreliable to force deterministically through the public runVRP pipeline).
export function compactRoutes(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  deadline?: number,
): VRPSolution {
  const result: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  const shortRoutes = result.routes
    .map((r, i) => ({ idx: i, count: r.missions.length }))
    .filter(r => r.count === 1)

  for (const { idx: shortIdx } of shortRoutes) {
    if (deadline !== undefined && Date.now() > deadline) break

    const shortRoute = result.routes[shortIdx]
    if (shortRoute.missions.length === 0) continue

    const mission = shortRoute.missions[0]
    const shortDriver = drivers.find(d => d.id === shortRoute.driverId)
    if (!shortDriver) continue

    let bestTargetIdx = -1
    let bestPos = 0
    let bestDelta = 0

    const currentShortCost = computeRouteCost(shortRoute, ctx, drivers)

    for (let ti = 0; ti < result.routes.length; ti++) {
      if (deadline !== undefined && Date.now() > deadline) break
      if (ti === shortIdx) continue
      const targetRoute = result.routes[ti]
      if (targetRoute.missions.length === 0) continue

      const targetDriver = drivers.find(d => d.id === targetRoute.driverId)
      if (!targetDriver) continue
      if (!isHfvrpCompatible(mission, targetDriver)) continue
      if (!isAllerRetourCompatible(targetRoute.missions, mission.type)) continue

      const baseCost = computeRouteCost(targetRoute, ctx, drivers)

      for (let pos = 0; pos <= targetRoute.missions.length; pos++) {
        const candidateMissions = [
          ...targetRoute.missions.slice(0, pos),
          mission,
          ...targetRoute.missions.slice(pos),
        ]
        const candidateRoute = { driverId: targetRoute.driverId, missions: candidateMissions }
        const newCost = computeRouteCost(candidateRoute, ctx, drivers)
        const delta = (newCost - baseCost) - currentShortCost

        if (delta < bestDelta) {
          bestDelta = delta
          bestTargetIdx = ti
          bestPos = pos
        }
      }
    }

    if (bestTargetIdx >= 0) {
      result.routes[bestTargetIdx].missions.splice(bestPos, 0, mission)
      shortRoute.missions = []
    }
  }

  result.cost = computeSolutionCost(result.routes, ctx, drivers)
  return result
}

// Exported specifically so its ALLER_RETOUR fallback and deadline-guard behavior can be
// unit-tested directly — forcing either path deterministically through the full public
// runVRP/optimizeVRP pipeline would require fighting the ALNS search's seeded randomness (or
// real wall-clock timing) with no reliable guarantee, unlike a direct call with a hand-built
// VRPSolution and an already-past deadline.
export function forceAssignP1(
  solution: VRPSolution,
  allMissions: Mission[],
  ctx: CostContext,
  drivers: Driver[],
  warnings?: OptimizationResult['warnings'],
  deadline?: number,
): VRPSolution {

  if (!solution || !solution.routes || solution.routes.length === 0) return solution

  const assignedIds = new Set(solution.routes.flatMap(r => r.missions.map(m => m.id)))
  const unassignedP1 = allMissions.filter(m => m.priority === 1 && !assignedIds.has(m.id))
  if (unassignedP1.length === 0) return solution

  const result: VRPSolution = {
    routes: solution.routes.map(r => ({ driverId: r.driverId, missions: [...r.missions] })),
    cost: solution.cost,
  }

  const driverMap = new Map(drivers.map(d => [d.id, d]))

  const MAX_CANDIDATE_ROUTES = Math.min(result.routes.length, 20)
  const useNearestOnly = result.routes.length > 50

  let routeCentroids: Array<{ lat: number; lng: number }> | undefined
  if (useNearestOnly) {
    routeCentroids = result.routes.map(r => {
      if (r.missions.length === 0) {
        const d = driverMap.get(r.driverId)
        return { lat: d?.depotLat ?? 0, lng: d?.depotLng ?? 0 }
      }
      const lat = r.missions.reduce((s, m) => s + m.latitude, 0) / r.missions.length
      const lng = r.missions.reduce((s, m) => s + m.longitude, 0) / r.missions.length
      return { lat, lng }
    })
  }

  for (const mission of unassignedP1) {
    let bestRouteIdx = -1
    let bestPos      = 0
    let bestCost     = Infinity

    let candidateIndices: number[]
    if (useNearestOnly && routeCentroids) {

      const dists = routeCentroids.map((c, ri) => ({
        ri,
        dist: (c.lat - mission.latitude) ** 2 + (c.lng - mission.longitude) ** 2,
      }))
      dists.sort((a, b) => a.dist - b.dist)
      candidateIndices = dists.slice(0, MAX_CANDIDATE_ROUTES).map(d => d.ri)
    } else {
      candidateIndices = result.routes.map((_, i) => i)
    }

    // Past deadline: skip the expensive per-position cost search below and go straight to the
    // cheap ALLER_RETOUR-respecting fallback (still O(routes), no cost computation) so remaining
    // P1 missions get placed rather than silently dropped — this loop has no other deadline
    // guard, unlike its sibling steps (threeOptOnWorstRoutes, ejectionChainSearch).
    const pastDeadline = deadline !== undefined && Date.now() > deadline

    for (const ri of pastDeadline ? [] : candidateIndices) {
      const route = result.routes[ri]
      if (!route) continue
      const driver = driverMap.get(route.driverId)
      if (!driver || !isHfvrpCompatible(mission, driver)) continue
      if (!isAllerRetourCompatible(route.missions, mission.type)) continue

      const maxPos = Math.min(route.missions.length, 5)
      for (let pos = 0; pos <= maxPos; pos++) {
        const candidate = {
          driverId: route.driverId,
          missions: [
            ...route.missions.slice(0, pos),
            mission,
            ...route.missions.slice(pos),
          ],
        }
        const cost = computeRouteCost(candidate, ctx, drivers)
        if (cost < bestCost) {
          bestCost     = cost
          bestRouteIdx = ri
          bestPos      = pos
        }
      }
    }

    if (bestRouteIdx === -1) {

      // No route passed both compatibility checks above (capacity/skills + ALLER_RETOUR-alone).
      // Before falling back to a blind "least loaded route" pick — which could silently violate
      // ALLER_RETOUR (a route must carry no other mission alongside one) or vehicle
      // capacity/skills — try again for the least-loaded route that at least respects
      // ALLER_RETOUR, ignoring capacity/skills only as a last resort before giving up entirely.
      let minLoad = Infinity
      for (let ri = 0; ri < result.routes.length; ri++) {
        const route = result.routes[ri]
        if (!isAllerRetourCompatible(route.missions, mission.type)) continue
        const load = route.missions.length
        if (load < minLoad) { minLoad = load; bestRouteIdx = ri }
      }

      if (bestRouteIdx === -1) {
        // Truly nothing respects ALLER_RETOUR either — force onto the least-loaded route
        // regardless, but warn: this may violate ALLER_RETOUR or vehicle capacity/skills.
        minLoad = Infinity
        for (let ri = 0; ri < result.routes.length; ri++) {
          const load = result.routes[ri].missions.length
          if (load < minLoad) { minLoad = load; bestRouteIdx = ri }
        }
        if (bestRouteIdx === -1) bestRouteIdx = 0
        warnings?.push({
          driverId: result.routes[bestRouteIdx]?.driverId ?? '',
          message:  `Urgence ${mission.clientName || ''} (${mission.address}) forcée sur une tournée sans respecter toutes ses contraintes (véhicule/ALLER_RETOUR) — aucune tournée compatible disponible`,
          severity: 'warning',
        })
      }
      bestPos = 0
    }

    const route = result.routes[bestRouteIdx]
    if (!route) continue
    route.missions = [
      ...route.missions.slice(0, bestPos),
      mission,
      ...route.missions.slice(bestPos),
    ]
  }

  return result
}

function runVRPDirect(
  missions: Mission[],
  drivers: Driver[],
  ctx: CostContext,
  seed: number,
  iterations: number,
  destroyRatio: number,
  timeBudgetMs: number,
  existingPlans?: Record<string, string[]>,
  saT0Ratio = 0.05,
  saTMinRatio = 0.0002,
): VRPSolution {
  const params: ALNSParams = {
    timeBudgetMs: Math.max(100, timeBudgetMs - 500),
    seed,
    iterations,
    destroyRatio,
    saT0Ratio,
    saTMinRatio,
    rhoForget:    0.8,
  }

  if (missions.length === 0) {
    const empty = buildInitialSolution(missions, drivers, ctx, existingPlans)
    empty.cost = 0
    return empty
  }

  const GRASP_STARTS = (timeBudgetMs > 3000 && !existingPlans) ? 3 : 1
  let bestInitial = buildInitialSolution(missions, drivers, ctx, existingPlans)
  bestInitial.cost = computeSolutionCost(bestInitial.routes, ctx, drivers)

  for (let g = 1; g < GRASP_STARTS; g++) {
    const shuffled = [...missions]

    if (g === 1) {

      shuffled.sort((a, b) => {
        const pa = a.priority ?? 4, pb = b.priority ?? 4
        if (pa !== pb) return pa - pb
        const twA = a.timeWindow?.openMin ?? 480
        const twB = b.timeWindow?.openMin ?? 480
        return twA - twB
      })
    } else {

      const centLat = shuffled.reduce((s, m) => s + m.latitude, 0) / Math.max(1, shuffled.length)
      const centLng = shuffled.reduce((s, m) => s + m.longitude, 0) / Math.max(1, shuffled.length)

      let rngState = ((seed + g * 7919) >>> 0) || 1
      const xorshift = (): number => {
        rngState ^= rngState << 13
        rngState ^= rngState >> 17
        rngState ^= rngState << 5
        return (rngState >>> 0) / 0x100000000
      }
      shuffled.sort((a, b) => {
        const pa = a.priority ?? 4, pb = b.priority ?? 4
        if (pa !== pb) return pa - pb
        const da = (a.latitude - centLat) ** 2 + (a.longitude - centLng) ** 2
        const db = (b.latitude - centLat) ** 2 + (b.longitude - centLng) ** 2
        return da - db || (xorshift() - 0.5)
      })
    }

    const candidate = buildInitialSolution(shuffled, drivers, ctx)
    candidate.cost = computeSolutionCost(candidate.routes, ctx, drivers)
    if (candidate.cost < bestInitial.cost) {
      bestInitial = candidate
    }
  }

  if (timeBudgetMs < 500) return bestInitial
  return runMvAlns(bestInitial, ctx, drivers, params)
}

async function runVRPWithSectors(
  missions: Mission[],
  drivers: Driver[],
  ctx: CostContext,
  seed: number,
  iterations: number,
  destroyRatio: number,
  timeBudgetMs: number,
  existingPlans?: Record<string, string[]>,
  saT0Ratio = 0.05,
  saTMinRatio = 0.0002,
): Promise<VRPSolution> {
  const startTs = Date.now()

  const crossFraction = drivers.length > 200 ? 0.08 : 0.15
  const CROSS_SECTOR_BUDGET_MS = Math.min(3_000, timeBudgetMs * crossFraction)
  const FORMAT_MARGIN_MS       = 500
  const alnsTotal = Math.max(0, timeBudgetMs - CROSS_SECTOR_BUDGET_MS - FORMAT_MARGIN_MS)

  const sectorSize = targetSectorSize(drivers.length)
  const sectors = buildSectors(drivers, missions, sectorSize)

  rebalanceSectors(sectors, 10)
  const nSectors = sectors.length

  const totalD = Math.max(1, drivers.length)
  const totalM = Math.max(1, missions.length)
  const sectorComplexity = sectors.map(s => {
    const mRatio = s.missions.length / totalM
    const dRatio = s.drivers.length / totalD
    return mRatio * 0.7 + dRatio * 0.3
  })
  const totalComplexity = Math.max(1e-9, sectorComplexity.reduce((a, b) => a + b, 0))
  const perSectorBudgets = sectorComplexity.map(c =>
    Math.max(200, Math.round((c / totalComplexity) * alnsTotal)),
  )

  const sectorTasks: SectorWorkerInput[] = []
  // sectors[] index of each task — sectors without drivers get no task, so the two diverge.
  const taskSector: number[] = []

  for (let si = 0; si < nSectors; si++) {
    const sector = sectors[si]
    if (sector.drivers.length === 0) continue

    const sectorBudget = perSectorBudgets[si]
    const sectorSeed   = seed + si * 1000

    let sectorPlans: Record<string, string[]> | undefined
    if (existingPlans) {
      const driverSet = new Set(sector.drivers.map(d => d.id))
      const filtered  = Object.entries(existingPlans).filter(([id]) => driverSet.has(id))
      if (filtered.length > 0) sectorPlans = Object.fromEntries(filtered)
    }

    const params: ALNSParams = {
      timeBudgetMs: Math.max(100, sectorBudget - 200),
      seed:         sectorSeed,
      iterations,
      destroyRatio,
      saT0Ratio,
      saTMinRatio,
      rhoForget:    0.85,
    }

    const sectorCtx: CostContext = {
      ...ctx,
      depotLat: sector.drivers[0].depotLat,
      depotLng: sector.drivers[0].depotLng,
    }

    sectorTasks.push({
      missions:      sector.missions,
      drivers:       sector.drivers,
      ctx:           sectorCtx,
      params,
      existingPlans: sectorPlans,
      sectorIndex:   sectorTasks.length,
    })
    taskSector.push(si)
  }

  // One solution per task, in task order (see runSectorsInParallel) — never filtered, so a
  // task's routes stay aligned with its sector below.
  const sectorSolutions = await runSectorsInParallel(sectorTasks)

  const merged: VRPSolution = {
    routes: sectorSolutions.flatMap(s => s.routes),
    cost:   sectorSolutions.reduce((sum, s) => sum + (s.cost ?? 0), 0),
  }

  const crossDeadline = startTs + timeBudgetMs - FORMAT_MARGIN_MS
  if (Date.now() < crossDeadline && merged.routes.length > 0) {
    let crossTarget: VRPSolution

    if (nSectors > 10) {

      const centroids = sectors.map(s => {
        const lat = s.drivers.reduce((sum, d) => sum + d.depotLat, 0) / Math.max(1, s.drivers.length)
        const lng = s.drivers.reduce((sum, d) => sum + d.depotLng, 0) / Math.max(1, s.drivers.length)
        return { lat, lng }
      })

      const K_NEIGHBORS = 3
      const neighborRouteIndices = new Set<number>()
      let routeOffset = 0
      const sectorRouteRanges: Array<{ start: number; end: number } | undefined> = sectors.map(() => undefined)

      for (let ti = 0; ti < sectorSolutions.length; ti++) {
        const n = sectorSolutions[ti].routes.length
        sectorRouteRanges[taskSector[ti]] = { start: routeOffset, end: routeOffset + n }
        routeOffset += n
      }

      for (let si = 0; si < centroids.length; si++) {
        const dists = centroids
          .map((c, sj) => ({
            sj,
            dist: si === sj ? Infinity : (c.lat - centroids[si].lat) ** 2 + (c.lng - centroids[si].lng) ** 2,
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, K_NEIGHBORS)

        const range = sectorRouteRanges[si]
        if (range) for (let r = range.start; r < range.end; r++) neighborRouteIndices.add(r)
        for (const { sj } of dists) {
          const nRange = sectorRouteRanges[sj]
          if (nRange) for (let r = nRange.start; r < nRange.end; r++) neighborRouteIndices.add(r)
        }
      }

      crossTarget = {
        routes: Array.from(neighborRouteIndices).sort((a, b) => a - b).map(i => merged.routes[i]),
        cost: 0,
      }
      crossTarget.cost = crossTarget.routes.reduce(
        (sum, r) => sum + computeRouteCost(r, ctx, drivers), 0,
      )
    } else {
      crossTarget = merged
    }

    const improved = crossRouteOrOpt(crossTarget, ctx, drivers, crossDeadline)
    const improvedCost = improved.routes.reduce(
      (sum, r) => sum + computeRouteCost(r, ctx, drivers), 0,
    )

    if (nSectors > 10) {

      if (improvedCost < crossTarget.cost) {
        const neighborSet = new Set(
          improved.routes.map(r => r.driverId),
        )
        const untouchedRoutes = merged.routes.filter(r => !neighborSet.has(r.driverId))
        const finalRoutes = [...untouchedRoutes, ...improved.routes]
        const finalCost = finalRoutes.reduce(
          (sum, r) => sum + computeRouteCost(r, ctx, drivers), 0,
        )
        return { routes: finalRoutes, cost: finalCost }
      }
    } else if (improvedCost < merged.cost) {
      return improved
    }
  }

  return merged
}
