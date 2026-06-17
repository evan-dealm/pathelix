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
import type { Driver } from '@/lib/types'
import type { Route, RouteCache, CostContext } from './types'
import { findBestExutoire } from './exutoireSearch'
import { cachedDist } from './distanceCache'

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

export function computeRouteCost(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): number {
  const c = cfg(costCfg, ctx)
  const driver = getDriverMap(drivers).get(route.driverId)
  if (!driver) return Infinity

  const { speedKmh, exutoires, date } = ctx

  const startOverride = ctx.driverStartOverrides?.get(route.driverId)
  const depotLat      = startOverride?.lat  ?? driver.depotLat
  const depotLng      = startOverride?.lng  ?? driver.depotLng
  const startTimeMin  = startOverride?.timeMin ?? ctx.startTimeMin
  const missions = route.missions

  if (missions.length === 0) return 0

  const effectiveP1Deadline = Math.min(1320, Math.max(P1_DEADLINE_MIN, startTimeMin + 240))

  let currentMin      = startTimeMin
  let currentLat      = depotLat
  let currentLng      = depotLng
  let currentId: string | undefined = `depot:${route.driverId}`
  let continuousDriving = 0
  let totalCost       = 0

  let cumWorkMin      = 0
  let cumDrivingMin   = 0

  const capacity  = effectiveCapacity(driver)
  let binsUsed    = 0
  const lastBinIdx = lastBinIndex(missions)

  let emptyBins        = capacity
  let echangersPending = 0

  const dow = cachedDow(date)

  const w = ctx.weights ?? { distance: 0.5, punctuality: 0.5, balance: 0.3 }
  const wPunct = Math.max(0.1, w.punctuality)
  const _wBalance = Math.max(0, w.balance)

  const skillWeight = Math.max(0.5, wPunct)
  const driverSkills = new Set(driver.skills ?? [])
  for (const m of missions) {
    if (m.requiredSkills && m.requiredSkills.length > 0) {
      for (const skill of m.requiredSkills) {
        if (!driverSkills.has(skill)) totalCost += 10_000 * skillWeight
      }
    }
  }

  const missionIdx = new Map<string, number>()
  for (let i = 0; i < missions.length; i++) missionIdx.set(missions[i].id, i)

  let prevDirLat = 0, prevDirLng = 0

  for (let _i = 0; _i < missions.length; _i++) {
    const mission = missions[_i]

    if (_i > 0) {
      const dirLat = mission.latitude - currentLat
      const dirLng = mission.longitude - currentLng

      if (prevDirLat !== 0 || prevDirLng !== 0) {
        const dot = dirLat * prevDirLat + dirLng * prevDirLng
        const mag1 = Math.sqrt(dirLat * dirLat + dirLng * dirLng)
        const mag2 = Math.sqrt(prevDirLat * prevDirLat + prevDirLng * prevDirLng)
        if (mag1 > 0.001 && mag2 > 0.001) {
          const cosAngle = dot / (mag1 * mag2)

          if (cosAngle < -0.5) {
            totalCost += 15
          } else if (cosAngle < 0) {
            totalCost += 5
          }
        }
      }
      prevDirLat = dirLat
      prevDirLng = dirLng
    }

    if (mission.dependsOnId) {
      const depIdx = missionIdx.get(mission.dependsOnId) ?? -1
      if (depIdx >= 0 && depIdx > _i) {

        totalCost += 5000
      }
    }

    const travelMin = realDurationMin(
      ctx, currentId, currentLat, currentLng,
      mission.id, mission.latitude, mission.longitude,
      currentMin,
    )

    let breakMin = 0
    if (continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {

      breakMin = BREAK_DURATION_MIN
      continuousDriving = 0
    }

    currentMin    += travelMin + breakMin
    continuousDriving += travelMin
    cumDrivingMin += travelMin
    cumWorkMin    += travelMin + breakMin

    const validTW = mission.timeWindow && mission.timeWindow.closeMin >= mission.timeWindow.openMin
    if (validTW && mission.timeWindow && currentMin < mission.timeWindow.openMin) {

      const waitMin = mission.timeWindow.openMin - currentMin
      if (waitMin > 15) {
        totalCost += (waitMin - 15) * 0.5
      }
      cumWorkMin  += waitMin
      currentMin   = mission.timeWindow.openMin
    }

    const arrivalMin = currentMin

    if (validTW && mission.timeWindow) {
      const { openMin, closeMin } = mission.timeWindow
      const windowDuration = closeMin - openMin

      if (arrivalMin <= closeMin) {

        const slack = closeMin - arrivalMin
        const slackRatio = windowDuration > 0 ? slack / windowDuration : 0

        totalCost -= Math.min(10, slackRatio * 20)
      } else {

        const lateMin = arrivalMin - closeMin
        if (lateMin <= 15) {
          totalCost += lateMin * 3 * wPunct
        } else if (lateMin <= 60) {
          totalCost += (15 * 3 + penaltyForLate(lateMin - 15)) * wPunct
        } else {
          totalCost += (15 * 3 + penaltyForLate(45) + (lateMin - 60) * 15) * wPunct
        }
      }
    }

    if (mission.priority === 1 && arrivalMin > effectiveP1Deadline) {
      totalCost += penaltyForP1Late(arrivalMin - effectiveP1Deadline) * wPunct
    }

    const stabilityW = ctx.weights?.stability ?? 0
    if (stabilityW > 0 && ctx.familiarity) {
      totalCost += getFamiliarityBonus(ctx.familiarity, route.driverId, mission.siteId, stabilityW)
    }

    const onSiteMin    = Math.max(0, mission.estimatedDurationMin ?? 0) + Math.max(0, mission.maneuverTimeMin ?? 0)
    const departureMin = arrivalMin + onSiteMin
    cumWorkMin        += onSiteMin

    currentMin = departureMin
    currentLat = mission.latitude
    currentLng = mission.longitude
    currentId  = mission.id

    if (mission.type === 'POSER') {
      if (emptyBins <= 0) {
        totalCost += 50_000
      } else {
        emptyBins--
      }
    }

    if (isBinMission(mission.type)) {
      binsUsed++

      if (mission.type === 'ECHANGER') {
        if (emptyBins <= 0) {
          totalCost += 50_000
        } else {
          emptyBins--
          echangersPending++
        }
      }

      const nextM = missions[_i + 1]
      const nextNeedsEmpty = nextM && (nextM.type === 'POSER' || nextM.type === 'ECHANGER')
      const needsExutoire = binsUsed >= capacity || _i >= lastBinIdx ||
        (emptyBins <= 0 && nextNeedsEmpty && echangersPending > 0)

      if (needsExutoire) {

        const ex = findBestExutoire(
          mission.latitude, mission.longitude,
          mission.linkedExutoireId,
          mission.wasteTypeLabel,
          exutoires,
          dow,
        )

        if (ex) {

          const exTravelMin = realDurationMin(
            ctx, currentId, currentLat, currentLng,
            `exu:${ex.id}`, ex.lat, ex.lng,
            currentMin,
          )

          let exBreak = 0
          if (continuousDriving + exTravelMin > MAX_CONTINUOUS_MIN) {
            exBreak = BREAK_DURATION_MIN
            continuousDriving = 0
          }

          currentMin        += exTravelMin + exBreak
          continuousDriving += exTravelMin
          cumDrivingMin     += exTravelMin
          cumWorkMin        += exTravelMin + exBreak

          if (currentMin < ex.openingHoursOpen) {
            cumWorkMin  += ex.openingHoursOpen - currentMin
            currentMin   = ex.openingHoursOpen
          }

          if (ex.closedDays.includes(dow)) {
            totalCost += c.closedExutoirePenalty
          } else if (currentMin > ex.openingHoursClose) {
            totalCost += penaltyForLate(currentMin - ex.openingHoursClose)
          }

          cumWorkMin += ex.serviceTimeMin
          currentMin += ex.serviceTimeMin
          currentLat  = ex.lat
          currentLng  = ex.lng
          currentId   = `exu:${ex.id}`

          continuousDriving = 0
          binsUsed = 0

          emptyBins        += echangersPending
          echangersPending  = 0
        } else {

          binsUsed = 0
          emptyBins        += echangersPending
          echangersPending  = 0
          totalCost += 500
        }
      }
    }

    if (mission.type === 'ALLER_RETOUR') {
      const ex = findBestExutoire(
        mission.latitude, mission.longitude,
        mission.linkedExutoireId,
        mission.wasteTypeLabel,
        exutoires,
        dow,
      )

      if (ex) {

        const toExMin = realDurationMin(
          ctx, currentId, currentLat, currentLng,
          `exu:${ex.id}`, ex.lat, ex.lng,
          currentMin,
        )
        let brk1 = 0
        if (continuousDriving + toExMin > MAX_CONTINUOUS_MIN) {
          brk1 = BREAK_DURATION_MIN
          continuousDriving = 0
        }
        currentMin        += toExMin + brk1
        continuousDriving += toExMin
        cumDrivingMin     += toExMin
        cumWorkMin        += toExMin + brk1

        if (currentMin < ex.openingHoursOpen) {
          cumWorkMin += ex.openingHoursOpen - currentMin
          currentMin  = ex.openingHoursOpen
        }
        if (ex.closedDays.includes(dow)) {
          totalCost += c.closedExutoirePenalty
        } else if (currentMin > ex.openingHoursClose) {
          totalCost += penaltyForLate(currentMin - ex.openingHoursClose)
        }
        cumWorkMin += ex.serviceTimeMin
        currentMin += ex.serviceTimeMin
        continuousDriving = 0

        const fromExMin = realDurationMin(
          ctx, `exu:${ex.id}`, ex.lat, ex.lng,
          mission.id, mission.latitude, mission.longitude,
          currentMin,
        )
        let brk2 = 0
        if (continuousDriving + fromExMin > MAX_CONTINUOUS_MIN) {
          brk2 = BREAK_DURATION_MIN
          continuousDriving = 0
        }
        currentMin        += fromExMin + brk2
        continuousDriving += fromExMin
        cumDrivingMin     += fromExMin
        cumWorkMin        += fromExMin + brk2

        currentLat = mission.latitude
        currentLng = mission.longitude
        currentId  = mission.id
      } else {
        totalCost += 500
      }
    }
  }

  const returnTravel = realDurationMin(
    ctx, currentId, currentLat, currentLng,
    `depot:${route.driverId}`, depotLat, depotLng,
    currentMin,
  )

  let returnBreak = 0
  if (continuousDriving + returnTravel > MAX_CONTINUOUS_MIN) {
    returnBreak = BREAK_DURATION_MIN
  }

  cumWorkMin    += returnTravel + returnBreak
  cumDrivingMin += returnTravel

  const distanceCost = cumDrivingMin * c.distanceCostFactor
  totalCost += distanceCost * Math.max(0.1, w.distance)

  if (cumWorkMin > c.nearmaxStartMin && cumWorkMin <= MAX_WORK_MIN) {
    totalCost += (cumWorkMin - c.nearmaxStartMin) * c.nearmaxPerMin
  }
  if (cumWorkMin > MAX_WORK_MIN) {
    totalCost += (MAX_WORK_MIN - c.nearmaxStartMin) * c.nearmaxPerMin
    totalCost += c.overtimePenalty + (cumWorkMin - MAX_WORK_MIN) * c.overtimePerMin
  }

  if (cumWorkMin > 120 && currentMin > c.lunchBreakEndMin) {

    let maxGapInLunch = 0
    let prevExitMin = startTimeMin
    for (const m of missions) {
      const travelEst = cachedDist(
        prevExitMin === startTimeMin ? depotLat : m.latitude,
        prevExitMin === startTimeMin ? depotLng : m.longitude,
        m.latitude, m.longitude,
      ) / Math.max(10, speedKmh) * 60
      const arrivalEst = prevExitMin + travelEst

      if (arrivalEst > c.lunchBreakStartMin && prevExitMin < c.lunchBreakEndMin) {
        const gapStart = Math.max(prevExitMin, c.lunchBreakStartMin)
        const gapEnd = Math.min(arrivalEst, c.lunchBreakEndMin)
        const gap = gapEnd - gapStart
        if (gap > maxGapInLunch) maxGapInLunch = gap
      }
      const onSite = (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0)
      prevExitMin = arrivalEst + onSite
    }
    if (maxGapInLunch < c.lunchBreakDurationMin) {
      totalCost += c.lunchBreakPenalty
    }
  }

  totalCost = Math.max(0, totalCost)

  return totalCost
}

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
}

export function computePrefixStates(
  route: Route,
  ctx: CostContext,
  drivers: Driver[],
): RoutePrefixState[] {
  const driver = getDriverMap(drivers).get(route.driverId)
  if (!driver) return []

  const { startTimeMin } = ctx
  const effectiveP1Deadline = Math.min(1320, Math.max(P1_DEADLINE_MIN, startTimeMin + 240))

  const states: RoutePrefixState[] = []

  let currentMin        = startTimeMin
  let currentLat        = driver.depotLat
  let currentLng        = driver.depotLng
  let currentId: string | undefined = `depot:${route.driverId}`
  let continuousDriving = 0
  let cumWorkMin        = 0
  let cumDrivingMin     = 0
  let partialCost       = 0

  const capacity = effectiveCapacity(driver)
  let binsUsed   = 0

  states.push({ currentMin, currentLat, currentLng, currentId, continuousDriving, cumWorkMin, cumDrivingMin, partialCost, binsUsed })

  for (const mission of route.missions) {

    const travelMin = realDurationMin(ctx, currentId, currentLat, currentLng, mission.id, mission.latitude, mission.longitude, currentMin)

    let breakMin = 0
    if (continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {
      breakMin = BREAK_DURATION_MIN
      continuousDriving = 0
    }

    currentMin        += travelMin + breakMin
    continuousDriving += travelMin
    cumDrivingMin     += travelMin
    cumWorkMin        += travelMin + breakMin

    const validTW = mission.timeWindow && mission.timeWindow.closeMin >= mission.timeWindow.openMin
    if (validTW && mission.timeWindow && currentMin < mission.timeWindow.openMin) {
      cumWorkMin += mission.timeWindow.openMin - currentMin
      currentMin  = mission.timeWindow.openMin
    }

    const arrivalMin = currentMin

    if (validTW && mission.timeWindow) {
      const { openMin, closeMin } = mission.timeWindow
      const windowDuration = closeMin - openMin

      if (arrivalMin <= closeMin) {

        const slack = closeMin - arrivalMin
        const slackRatio = windowDuration > 0 ? slack / windowDuration : 0
        partialCost -= Math.min(10, slackRatio * 20)
      } else {

        const lateMin = arrivalMin - closeMin
        if (lateMin <= 15) {
          partialCost += lateMin * 3
        } else if (lateMin <= 60) {
          partialCost += 15 * 3 + penaltyForLate(lateMin - 15)
        } else {
          partialCost += 15 * 3 + penaltyForLate(45) + (lateMin - 60) * 15
        }
      }
    }
    if (mission.priority === 1 && arrivalMin > effectiveP1Deadline) {
      partialCost += penaltyForP1Late(arrivalMin - effectiveP1Deadline)
    }

    const onSiteMin = Math.max(0, mission.estimatedDurationMin ?? 0) + Math.max(0, mission.maneuverTimeMin ?? 0)
    cumWorkMin += onSiteMin
    currentMin += onSiteMin
    currentLat  = mission.latitude
    currentLng  = mission.longitude
    currentId   = mission.id

    if (isBinMission(mission.type)) {
      binsUsed++
      if (binsUsed >= capacity) binsUsed = 0
    }

    states.push({ currentMin, currentLat, currentLng, currentId, continuousDriving, cumWorkMin, cumDrivingMin, partialCost, binsUsed })
  }

  return states
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

export function computeInsertionDelta(
  route: Route,
  mission: import('@/lib/types').Mission,
  pos: number,
  prefixStates: RoutePrefixState[],
  costWithout: number,
  ctx: CostContext,
  drivers: Driver[],
  costCfg?: VrpCostConfig,
): number {
  const c = cfg(costCfg)
  const driver = drivers.find(d => d.id === route.driverId)
  if (!driver || pos > route.missions.length) {

    const newMissions = [
      ...route.missions.slice(0, pos),
      mission,
      ...route.missions.slice(pos),
    ]
    return computeRouteCost({ driverId: route.driverId, missions: newMissions }, ctx, drivers, costCfg) - costWithout
  }

  const { startTimeMin, exutoires, date } = ctx
  const effectiveP1Deadline = Math.min(1320, Math.max(P1_DEADLINE_MIN, startTimeMin + 240))

  const dow = cachedDow(date)

  const ps = prefixStates[Math.min(pos, prefixStates.length - 1)]
  let currentMin        = ps.currentMin
  let currentLat        = ps.currentLat
  let currentLng        = ps.currentLng
  let currentId: string | undefined = ps.currentId
  let continuousDriving = ps.continuousDriving
  let cumWorkMin        = ps.cumWorkMin
  let cumDrivingMin     = ps.cumDrivingMin
  let suffixCost        = 0

  const capacity = effectiveCapacity(driver)
  let binsUsed   = ps.binsUsed ?? 0

  let emptyBins        = capacity
  let echangersPending = 0
  for (const pm of route.missions.slice(0, pos)) {
    if (pm.type === 'POSER' && emptyBins > 0) emptyBins--
    else if (pm.type === 'ECHANGER' && emptyBins > 0) { emptyBins--; echangersPending++ }
    else if (isBinMission(pm.type)) {

      echangersPending = 0
    }
  }

  const suffixMissions = [mission, ...route.missions.slice(pos)]
  const suffixLastBinIdx = lastBinIndex(suffixMissions)

  let prevDirLat = 0, prevDirLng = 0

  for (let si = 0; si < suffixMissions.length; si++) {
    const m = suffixMissions[si]

    const dirLat = m.latitude - currentLat
    const dirLng = m.longitude - currentLng
    if (prevDirLat !== 0 || prevDirLng !== 0) {
      const dot = dirLat * prevDirLat + dirLng * prevDirLng
      const magSq1 = dirLat * dirLat + dirLng * dirLng
      const magSq2 = prevDirLat * prevDirLat + prevDirLng * prevDirLng
      if (magSq1 > 1e-6 && magSq2 > 1e-6) {

        const dotSq = dot * dot
        const threshold = magSq1 * magSq2
        if (dot < 0 && dotSq > 0.25 * threshold) suffixCost += 15
        else if (dot < 0) suffixCost += 5
      }
    }
    prevDirLat = dirLat
    prevDirLng = dirLng

    const travelMin = realDurationMin(ctx, currentId, currentLat, currentLng, m.id, m.latitude, m.longitude, currentMin)

    let breakMin = 0
    if (continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {
      breakMin = BREAK_DURATION_MIN
      continuousDriving = 0
    }
    currentMin        += travelMin + breakMin
    continuousDriving += travelMin
    cumDrivingMin     += travelMin
    cumWorkMin        += travelMin + breakMin

    const validTW = m.timeWindow && m.timeWindow.closeMin >= m.timeWindow.openMin
    if (validTW && m.timeWindow && currentMin < m.timeWindow.openMin) {
      const waitMin = m.timeWindow.openMin - currentMin

      if (waitMin > 15) {
        suffixCost += (waitMin - 15) * 0.5
      }
      cumWorkMin += waitMin
      currentMin  = m.timeWindow.openMin
    }
    const arrivalMin = currentMin

    if (validTW && m.timeWindow && arrivalMin > m.timeWindow.closeMin) {

      const lateMin = arrivalMin - m.timeWindow.closeMin
      if (lateMin <= 15) {
        suffixCost += lateMin * 3
      } else if (lateMin <= 60) {
        suffixCost += 15 * 3 + penaltyForLate(lateMin - 15)
      } else {
        suffixCost += 15 * 3 + penaltyForLate(45) + (lateMin - 60) * 15
      }
    } else if (validTW && m.timeWindow && arrivalMin <= m.timeWindow.closeMin) {

      const { openMin, closeMin } = m.timeWindow
      const windowDuration = closeMin - openMin
      const slack = closeMin - arrivalMin
      const slackRatio = windowDuration > 0 ? slack / windowDuration : 0
      suffixCost -= Math.min(10, slackRatio * 20)
    }
    if (m.priority === 1 && arrivalMin > effectiveP1Deadline) {
      suffixCost += penaltyForP1Late(arrivalMin - effectiveP1Deadline)
    }

    if (m.dependsOnId) {
      const fullRoute = [...route.missions.slice(0, pos), mission, ...route.missions.slice(pos)]
      const mIdxInFull = pos + 1 + si
      const depIdxInFull = fullRoute.findIndex(dep => dep.id === m.dependsOnId)
      if (depIdxInFull >= 0 && depIdxInFull > mIdxInFull) {
        suffixCost += 5000
      }
    }

    const onSiteMin = Math.max(0, m.estimatedDurationMin ?? 0) + Math.max(0, m.maneuverTimeMin ?? 0)
    cumWorkMin += onSiteMin
    currentMin += onSiteMin
    currentLat  = m.latitude
    currentLng  = m.longitude
    currentId   = m.id

    if (m.type === 'POSER') {
      if (emptyBins <= 0) suffixCost += 50_000
      else emptyBins--
    }

    if (isBinMission(m.type)) {
      binsUsed++
      if (m.type === 'ECHANGER') {
        if (emptyBins <= 0) suffixCost += 50_000
        else { emptyBins--; echangersPending++ }
      }

      const nextSuffixM = suffixMissions[si + 1]
      const nextNeedsEmpty = nextSuffixM &&
        (nextSuffixM.type === 'POSER' || nextSuffixM.type === 'ECHANGER')
      const needsExutoire = binsUsed >= capacity || si >= suffixLastBinIdx ||
        (emptyBins <= 0 && nextNeedsEmpty && echangersPending > 0)

      if (needsExutoire) {
        const ex = findBestExutoire(m.latitude, m.longitude, m.linkedExutoireId, m.wasteTypeLabel, exutoires, dow, currentMin, ctx.congestionMap)
        if (ex) {
          const exId = `exu:${ex.id}`
          const exTravel = realDurationMin(ctx, currentId, currentLat, currentLng, exId, ex.lat, ex.lng, currentMin)
          let exBreak = 0
          if (continuousDriving + exTravel > MAX_CONTINUOUS_MIN) {
            exBreak = BREAK_DURATION_MIN
            continuousDriving = 0
          }
          currentMin        += exTravel + exBreak
          continuousDriving += exTravel
          cumDrivingMin     += exTravel
          cumWorkMin        += exTravel + exBreak
          if (currentMin < ex.openingHoursOpen) {
            cumWorkMin += ex.openingHoursOpen - currentMin
            currentMin  = ex.openingHoursOpen
          }
          if (ex.closedDays.includes(dow)) {
            suffixCost += c.closedExutoirePenalty
          } else if (currentMin > ex.openingHoursClose) {
            suffixCost += penaltyForLate(currentMin - ex.openingHoursClose)
          }
          cumWorkMin += ex.serviceTimeMin
          currentMin += ex.serviceTimeMin
          currentLat  = ex.lat
          currentLng  = ex.lng
          currentId   = exId
          continuousDriving = 0
          binsUsed         = 0
          emptyBins        += echangersPending
          echangersPending  = 0
        } else {
          binsUsed         = 0
          emptyBins        += echangersPending
          echangersPending  = 0
          suffixCost += 500
        }
      }
    }
  }

  const depotId = `depot:${route.driverId}`
  const returnTravel = realDurationMin(ctx, currentId, currentLat, currentLng, depotId, driver.depotLat, driver.depotLng, currentMin)
  let rBreak = 0
  if (continuousDriving + returnTravel > MAX_CONTINUOUS_MIN) rBreak = BREAK_DURATION_MIN
  cumWorkMin    += returnTravel + rBreak
  cumDrivingMin += returnTravel

  const w = ctx.weights ?? { distance: 0.5, punctuality: 0.5, balance: 0.3 }

  suffixCost += cumDrivingMin * c.distanceCostFactor * Math.max(0.1, w.distance)

  if (cumWorkMin > c.nearmaxStartMin && cumWorkMin <= MAX_WORK_MIN) {
    suffixCost += (cumWorkMin - c.nearmaxStartMin) * c.nearmaxPerMin
  }
  if (cumWorkMin > MAX_WORK_MIN) {
    suffixCost += (MAX_WORK_MIN - c.nearmaxStartMin) * c.nearmaxPerMin
    suffixCost += c.overtimePenalty + (cumWorkMin - MAX_WORK_MIN) * c.overtimePerMin
  }

  const totalWithInsertion = ps.partialCost + suffixCost
  return totalWithInsertion - costWithout
}

export function computeRemovalDelta(
  route:        Route,
  pos:          number,
  prefixStates: RoutePrefixState[],
  costWith:     number,
  ctx:          CostContext,
  drivers:      Driver[],
  costCfg?:     VrpCostConfig,
): number {
  const c = cfg(costCfg)
  const driver = drivers.find(d => d.id === route.driverId)
  if (!driver || pos >= route.missions.length) return 0

  const { startTimeMin, exutoires, date } = ctx
  const effectiveP1Deadline = Math.min(1320, Math.max(P1_DEADLINE_MIN, startTimeMin + 240))

  const dow = cachedDow(date)

  const ps = prefixStates[pos]
  let currentMin        = ps.currentMin
  let currentLat        = ps.currentLat
  let currentLng        = ps.currentLng
  let currentId: string | undefined = ps.currentId
  let continuousDriving = ps.continuousDriving
  let cumWorkMin        = ps.cumWorkMin
  let cumDrivingMin     = ps.cumDrivingMin
  let suffixCost        = 0

  const capacity = effectiveCapacity(driver)
  let binsUsed   = ps.binsUsed ?? 0

  const suffixMissions = route.missions.slice(pos + 1)
  const suffixLastBinIdx = lastBinIndex(suffixMissions)

  let prevDirLat = 0, prevDirLng = 0

  for (let si = 0; si < suffixMissions.length; si++) {
    const m = suffixMissions[si]

    const dirLat = m.latitude - currentLat
    const dirLng = m.longitude - currentLng
    if (prevDirLat !== 0 || prevDirLng !== 0) {
      const dot = dirLat * prevDirLat + dirLng * prevDirLng
      const magSq1 = dirLat * dirLat + dirLng * dirLng
      const magSq2 = prevDirLat * prevDirLat + prevDirLng * prevDirLng
      if (magSq1 > 1e-6 && magSq2 > 1e-6) {
        const dotSq = dot * dot
        const threshold = magSq1 * magSq2
        if (dot < 0 && dotSq > 0.25 * threshold) suffixCost += 15
        else if (dot < 0) suffixCost += 5
      }
    }
    prevDirLat = dirLat
    prevDirLng = dirLng

    const travelMin = realDurationMin(ctx, currentId, currentLat, currentLng, m.id, m.latitude, m.longitude, currentMin)

    let breakMin = 0
    if (continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {
      breakMin = BREAK_DURATION_MIN
      continuousDriving = 0
    }
    currentMin        += travelMin + breakMin
    continuousDriving += travelMin
    cumDrivingMin     += travelMin
    cumWorkMin        += travelMin + breakMin

    const validTW = m.timeWindow && m.timeWindow.closeMin >= m.timeWindow.openMin
    if (validTW && m.timeWindow && currentMin < m.timeWindow.openMin) {
      const waitMin = m.timeWindow.openMin - currentMin

      if (waitMin > 15) {
        suffixCost += (waitMin - 15) * 0.5
      }
      cumWorkMin += waitMin
      currentMin  = m.timeWindow.openMin
    }
    const arrivalMin = currentMin

    if (validTW && m.timeWindow && arrivalMin > m.timeWindow.closeMin) {

      const lateMin = arrivalMin - m.timeWindow.closeMin
      if (lateMin <= 15) {
        suffixCost += lateMin * 3
      } else if (lateMin <= 60) {
        suffixCost += 15 * 3 + penaltyForLate(lateMin - 15)
      } else {
        suffixCost += 15 * 3 + penaltyForLate(45) + (lateMin - 60) * 15
      }
    } else if (validTW && m.timeWindow && arrivalMin <= m.timeWindow.closeMin) {

      const { openMin, closeMin } = m.timeWindow
      const windowDuration = closeMin - openMin
      const slack = closeMin - arrivalMin
      const slackRatio = windowDuration > 0 ? slack / windowDuration : 0
      suffixCost -= Math.min(10, slackRatio * 20)
    }
    if (m.priority === 1 && arrivalMin > effectiveP1Deadline) {
      suffixCost += penaltyForP1Late(arrivalMin - effectiveP1Deadline)
    }

    if (m.dependsOnId) {
      const fullWithout = [...route.missions.slice(0, pos), ...route.missions.slice(pos + 1)]
      const mIdxInFull = pos + si
      const depIdxInFull = fullWithout.findIndex(dep => dep.id === m.dependsOnId)
      if (depIdxInFull >= 0 && depIdxInFull > mIdxInFull) {
        suffixCost += 5000
      }
    }

    const onSiteMin = Math.max(0, m.estimatedDurationMin ?? 0) + Math.max(0, m.maneuverTimeMin ?? 0)
    cumWorkMin += onSiteMin
    currentMin += onSiteMin
    currentLat  = m.latitude
    currentLng  = m.longitude
    currentId   = m.id

    if (isBinMission(m.type)) {
      binsUsed++
      const needsExutoire = binsUsed >= capacity || si >= suffixLastBinIdx

      if (needsExutoire) {
        const ex = findBestExutoire(m.latitude, m.longitude, m.linkedExutoireId, m.wasteTypeLabel, exutoires, dow, currentMin, ctx.congestionMap)
        if (ex) {
          const exId = `exu:${ex.id}`
          const exTravel = realDurationMin(ctx, currentId, currentLat, currentLng, exId, ex.lat, ex.lng, currentMin)
          let exBreak = 0
          if (continuousDriving + exTravel > MAX_CONTINUOUS_MIN) {
            exBreak = BREAK_DURATION_MIN
            continuousDriving = 0
          }
          currentMin        += exTravel + exBreak
          continuousDriving += exTravel
          cumDrivingMin     += exTravel
          cumWorkMin        += exTravel + exBreak
          if (currentMin < ex.openingHoursOpen) {
            cumWorkMin += ex.openingHoursOpen - currentMin
            currentMin  = ex.openingHoursOpen
          }
          if (ex.closedDays.includes(dow)) {
            suffixCost += c.closedExutoirePenalty
          } else if (currentMin > ex.openingHoursClose) {
            suffixCost += penaltyForLate(currentMin - ex.openingHoursClose)
          }
          cumWorkMin += ex.serviceTimeMin
          currentMin += ex.serviceTimeMin
          currentLat  = ex.lat
          currentLng  = ex.lng
          currentId   = exId
          continuousDriving = 0
          binsUsed = 0
        } else {
          binsUsed = 0
          suffixCost += 500
        }
      }
    }
  }

  const depotId = `depot:${route.driverId}`
  const returnTravel = realDurationMin(ctx, currentId, currentLat, currentLng, depotId, driver.depotLat, driver.depotLng, currentMin)
  let rBreak = 0
  if (continuousDriving + returnTravel > MAX_CONTINUOUS_MIN) rBreak = BREAK_DURATION_MIN
  cumWorkMin    += returnTravel + rBreak
  cumDrivingMin += returnTravel

  const w = ctx.weights ?? { distance: 0.5, punctuality: 0.5, balance: 0.3 }
  suffixCost += cumDrivingMin * c.distanceCostFactor * Math.max(0.1, w.distance)

  if (cumWorkMin > c.nearmaxStartMin && cumWorkMin <= MAX_WORK_MIN) {
    suffixCost += (cumWorkMin - c.nearmaxStartMin) * c.nearmaxPerMin
  }
  if (cumWorkMin > MAX_WORK_MIN) {
    suffixCost += (MAX_WORK_MIN - c.nearmaxStartMin) * c.nearmaxPerMin
    suffixCost += c.overtimePenalty + (cumWorkMin - MAX_WORK_MIN) * c.overtimePerMin
  }

  const totalWithout = ps.partialCost + suffixCost
  return totalWithout - costWith
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
