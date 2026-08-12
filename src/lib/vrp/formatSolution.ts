import { minToHHMM } from '@/lib/algorithm'
import {
  MAX_CONTINUOUS_MIN,
  MAX_WORK_MIN,
  MAX_DRIVING_MIN,
  BREAK_DURATION_MIN,
  P1_DEADLINE_MIN,
  computeDriverScore,
  computeDistributionScore,
} from '@/lib/constraints'
import type { Mission, Driver, PlannedMission, OptimizationResult } from '@/lib/types'
import type { VRPSolution, CostContext } from './types'
import { cachedDist } from './distanceCache'
import { findBestExutoire } from './exutoireSearch'
import { isHfvrpCompatible } from './hfvrp'
import { isAllerRetourCompatible } from './routeCost'
import { getFamiliarityBonus } from '@/lib/familiarityLoader'
import { realDistanceKm, realDurationMin } from './realDistance'
import { initLoadState, loadBin, dumpAll } from './multiCompartment'

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

export function formatSolutionForAPI(
  solution: VRPSolution,
  drivers: Driver[],
  ctx: CostContext,
): OptimizationResult {
  const { startTimeMin, speedKmh, exutoires, date } = ctx
  const [_fy, _fm, _fd] = date.split('-').map(Number)
  const dow = new Date(_fy, _fm - 1, _fd).getDay()

  const effectiveP1Deadline = Math.max(P1_DEADLINE_MIN, startTimeMin + 240)

  const assignments: Record<string, PlannedMission[]> = {}
  const warnings: OptimizationResult['warnings']      = []

  const exutoireArrivals = new Map<string, number[]>()

  const assignedIds = new Set<string>()

  for (const route of solution.routes) {
    const driver = drivers.find(d => d.id === route.driverId)
    if (!driver) continue

    const depotLat = driver.depotLat
    const depotLng = driver.depotLng

    const planned: PlannedMission[] = []
    let currentMin        = startTimeMin
    let currentLat        = depotLat
    let currentLng        = depotLng
    let currentId: string | undefined = `depot:${driver.id}`
    let continuousDriving = 0
    let totalWork         = 0
    let totalDriving      = 0
    let seq               = 0

    let loadState = initLoadState(driver)

    let emptyBins        = loadState.maxBins
    let echangersPending = 0

    const routeLastBinIdx = (() => {
      for (let j = route.missions.length - 1; j >= 0; j--) {
        const t = route.missions[j].type
        if (t === 'RETIRER' || t === 'ECHANGER' || t === 'CHARGER_IMMEDIAT') return j
      }
      return -1
    })()

    for (let _mi = 0; _mi < route.missions.length; _mi++) {
      const mission = route.missions[_mi]

      const travelMin = realDurationMin(
        ctx, currentId, currentLat, currentLng,
        mission.id, mission.latitude, mission.longitude,
        currentMin,
      )

      if (continuousDriving + travelMin > MAX_CONTINUOUS_MIN) {
        const breakMission: PlannedMission = {
          id:                    `_pause_${route.driverId}_${seq}`,
          type:                  'PAUSE',
          date,
          address:               'Pause réglementaire',
          latitude:              currentLat,
          longitude:             currentLng,
          estimatedDurationMin:  BREAK_DURATION_MIN,
          maneuverTimeMin:       0,
          sequenceOrder:         seq++,
          isSynthetic:           true,
          precomputedTravelMin:  0,
        }
        planned.push(breakMission)
        currentMin        += BREAK_DURATION_MIN
        totalWork         += BREAK_DURATION_MIN
        continuousDriving  = 0
      }

      currentMin        += travelMin
      continuousDriving += travelMin
      totalDriving      += travelMin
      totalWork         += travelMin

      if (mission.timeWindow && currentMin < mission.timeWindow.openMin) {

        const waitMin = mission.timeWindow.openMin - currentMin
        totalWork += waitMin
        currentMin = mission.timeWindow.openMin
      }

      const arrivalMin   = currentMin
      const onSiteMin    = (mission.estimatedDurationMin ?? 0) + (mission.maneuverTimeMin ?? 0)
      const departureMin = arrivalMin + onSiteMin
      totalWork         += onSiteMin
      currentMin         = departureMin

      if (mission.timeWindow && arrivalMin > mission.timeWindow.closeMin) {
        warnings.push({
          driverId: route.driverId,
          message:  `Mission ${mission.id} (${mission.address}) : arrivée à ${minToHHMM(arrivalMin)}, après la fermeture de la fenêtre (${minToHHMM(mission.timeWindow.closeMin)})`,
          severity: 'warning',
        })
      }

      if (mission.priority === 1 && arrivalMin > effectiveP1Deadline) {
        warnings.push({
          driverId: route.driverId,
          message:  `Mission P1 ${mission.id} servie après ${minToHHMM(effectiveP1Deadline)} (${minToHHMM(arrivalMin)})`,
          severity: 'error',
        })
      }

      planned.push({
        ...mission,
        sequenceOrder:        seq++,
        precomputedTravelMin: travelMin,
      })

      assignedIds.add(mission.id)
      currentId  = mission.id
      currentLat = mission.latitude
      currentLng = mission.longitude

      if (mission.type === 'POSER' && emptyBins > 0) {
        emptyBins--
      }

      if (mission.type === 'ALLER_RETOUR') {
        const ex = findBestExutoire(
          mission.latitude, mission.longitude,
          mission.linkedExutoireId,
          mission.wasteTypeLabel,
          exutoires,
          dow,
          currentMin,
        )
        if (ex) {
          const exuId = `exu:${ex.id}`

          const toExTravel = realDurationMin(ctx, currentId, currentLat, currentLng, exuId, ex.lat, ex.lng, currentMin)
          if (continuousDriving + toExTravel > MAX_CONTINUOUS_MIN) {
            planned.push({
              id: `_pause_ar_${route.driverId}_${seq}`,
              type: 'PAUSE', date,
              address: 'Pause réglementaire',
              latitude: currentLat, longitude: currentLng,
              estimatedDurationMin: BREAK_DURATION_MIN, maneuverTimeMin: 0,
              sequenceOrder: seq++, isSynthetic: true, precomputedTravelMin: 0,
            })
            currentMin += BREAK_DURATION_MIN
            totalWork  += BREAK_DURATION_MIN
            continuousDriving = 0
          }
          currentMin        += toExTravel
          continuousDriving += toExTravel
          totalDriving      += toExTravel
          totalWork         += toExTravel

          if (currentMin < ex.openingHoursOpen) {
            totalWork  += ex.openingHoursOpen - currentMin
            currentMin  = ex.openingHoursOpen
          }

          const exArr = exutoireArrivals.get(ex.id) ?? []
          exArr.push(currentMin)
          exutoireArrivals.set(ex.id, exArr)

          planned.push({
            id: `_vider_ar_${ex.id}_${mission.id}`,
            type: 'VIDER', date,
            clientName: ex.name,
            address: ex.address,
            latitude: ex.lat, longitude: ex.lng,
            estimatedDurationMin: ex.serviceTimeMin, maneuverTimeMin: 0,
            linkedExutoireId: ex.id,
            sequenceOrder: seq++, isSynthetic: true, precomputedTravelMin: toExTravel,
          })
          currentMin        += ex.serviceTimeMin
          totalWork         += ex.serviceTimeMin
          continuousDriving  = 0

          const fromExTravel = realDurationMin(ctx, exuId, ex.lat, ex.lng, mission.id, mission.latitude, mission.longitude, currentMin)
          if (continuousDriving + fromExTravel > MAX_CONTINUOUS_MIN) {
            planned.push({
              id: `_pause_ar2_${route.driverId}_${seq}`,
              type: 'PAUSE', date,
              address: 'Pause réglementaire',
              latitude: ex.lat, longitude: ex.lng,
              estimatedDurationMin: BREAK_DURATION_MIN, maneuverTimeMin: 0,
              sequenceOrder: seq++, isSynthetic: true, precomputedTravelMin: 0,
            })
            currentMin += BREAK_DURATION_MIN
            totalWork  += BREAK_DURATION_MIN
            continuousDriving = 0
          }
          currentMin        += fromExTravel
          continuousDriving += fromExTravel
          totalDriving      += fromExTravel
          totalWork         += fromExTravel

          planned.push({
            id: `_pose_ar_${mission.id}`,
            type: 'POSER', date,
            clientName: mission.clientName,
            address: mission.address,
            latitude: mission.latitude, longitude: mission.longitude,
            estimatedDurationMin: mission.maneuverTimeMin ?? 15,
            maneuverTimeMin: 0,
            accessNotes: mission.accessNotes,
            sequenceOrder: seq++, isSynthetic: true, precomputedTravelMin: fromExTravel,
          })
          currentMin        += mission.maneuverTimeMin ?? 15
          totalWork         += mission.maneuverTimeMin ?? 15
          currentId  = mission.id
          currentLat = mission.latitude
          currentLng = mission.longitude

          if (currentMin > ex.openingHoursClose) {
            warnings.push({
              driverId: route.driverId,
              message: `Exutoire "${ex.name}" : arrivée hors horaires (${minToHHMM(currentMin)})`,
              severity: 'warning',
            })
          }
        } else {
          warnings.push({
            driverId: route.driverId,
            message: `Mission ALLER_RETOUR "${mission.clientName || mission.address}" : exutoire introuvable`,
            severity: 'warning',
          })
        }
      }

      if (mission.type === 'RETIRER' || mission.type === 'ECHANGER' || mission.type === 'CHARGER_IMMEDIAT') {
        loadState = loadBin(loadState, mission)

        if (mission.type === 'ECHANGER') {
          if (emptyBins > 0) emptyBins--
          echangersPending++
        }

        const atCapacity = loadState.binsLoaded >= loadState.maxBins ||
          (loadState.volumeLoadedM3 > 0 && loadState.volumeLoadedM3 >= loadState.maxVolumeM3)
        const nextRouteMission = route.missions[_mi + 1]
        const nextNeedsEmpty = nextRouteMission &&
          (nextRouteMission.type === 'POSER' || nextRouteMission.type === 'ECHANGER')
        const needsExutoire = atCapacity || _mi >= routeLastBinIdx ||
          (emptyBins <= 0 && nextNeedsEmpty && echangersPending > 0)

        if (needsExutoire) {
          const ex = findBestExutoire(
            mission.latitude, mission.longitude,
            mission.linkedExutoireId,
            mission.wasteTypeLabel,
            exutoires,
            dow,
            currentMin,
          )

          if (ex) {
            const exuId = `exu:${ex.id}`
            const exTravel = realDurationMin(
              ctx, currentId, currentLat, currentLng,
              exuId, ex.lat, ex.lng,
              currentMin,
            )

            if (continuousDriving + exTravel > MAX_CONTINUOUS_MIN) {
              const breakMission: PlannedMission = {
                id:                    `_pause_ex_${route.driverId}_${seq}`,
                type:                  'PAUSE',
                date,
                address:               'Pause réglementaire',
                latitude:              currentLat,
                longitude:             currentLng,
                estimatedDurationMin:  BREAK_DURATION_MIN,
                maneuverTimeMin:       0,
                sequenceOrder:         seq++,
                isSynthetic:           true,
                precomputedTravelMin:  0,
              }
              planned.push(breakMission)
              currentMin        += BREAK_DURATION_MIN
              totalWork         += BREAK_DURATION_MIN
              continuousDriving  = 0
            }

            currentMin        += exTravel
            continuousDriving += exTravel
            totalDriving      += exTravel
            totalWork         += exTravel

            if (currentMin < ex.openingHoursOpen) {
              currentMin = ex.openingHoursOpen
            }

            const _exArr = exutoireArrivals.get(ex.id) ?? []
            _exArr.push(currentMin)
            exutoireArrivals.set(ex.id, _exArr)

            const exMission: PlannedMission = {
              id:                    `_vider_${ex.id}_${mission.id}`,
              type:                  'VIDER',
              date,
              clientName:            ex.name,
              address:               ex.address,
              latitude:              ex.lat,
              longitude:             ex.lng,
              estimatedDurationMin:  ex.serviceTimeMin,
              maneuverTimeMin:       0,
              linkedExutoireId:      ex.id,
              sequenceOrder:         seq++,
              isSynthetic:           true,
              precomputedTravelMin:  exTravel,
            }
            planned.push(exMission)

            currentMin        += ex.serviceTimeMin
            totalWork         += ex.serviceTimeMin
            currentId          = exuId
            currentLat         = ex.lat
            currentLng         = ex.lng
            continuousDriving  = 0
            loadState          = dumpAll(loadState)

            emptyBins        += echangersPending
            echangersPending  = 0

            if (currentMin > ex.openingHoursClose) {
              warnings.push({
                driverId: route.driverId,
                message:  `Exutoire "${ex.name}" : arrivée hors horaires (${minToHHMM(currentMin)})`,
                severity: 'warning',
              })
            }
          } else {

            loadState         = dumpAll(loadState)
            emptyBins        += echangersPending
            echangersPending  = 0
            warnings.push({
              driverId: route.driverId,
              message:  `Mission "${mission.clientName || mission.address}" : exutoire lié introuvable (id: ${mission.linkedExutoireId || 'aucun'})`,
              severity: 'warning',
            })
          }
        }
      }
    }

    if (totalWork > MAX_WORK_MIN) {
      warnings.push({
        driverId: route.driverId,
        message:  `Durée de travail totale dépasse 10h (${Math.round(totalWork)} min)`,
        severity: 'error',
      })
    }
    if (totalDriving > MAX_DRIVING_MIN) {
      warnings.push({
        driverId: route.driverId,
        message:  `Durée de conduite dépasse 9h (${Math.round(totalDriving)} min)`,
        severity: 'error',
      })
    }

    if (planned.length > 0) {
      assignments[route.driverId] = planned
    }
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

  const assignedCount = Array.from(assignedIds).length
  const totalCount    = allMissions.length

  const driverScores:  number[] = []
  const workMinByDriver: number[] = []

  for (const route of solution.routes) {
    if (route.missions.length === 0) continue
    const driver = drivers.find(d => d.id === route.driverId)
    if (!driver) continue

    let routeWork    = 0
    let routeDriving = 0
    let routeOnSite  = 0
    let routeDist    = 0
    let lat = driver.depotLat
    let lng = driver.depotLng
    let curMin = startTimeMin

    for (const m of route.missions) {
      const dist = cachedDist(lat, lng, m.latitude, m.longitude)
      routeDist   += dist
      const safeSpeed = speedKmh > 0 ? speedKmh : 50
      const travel = dist / safeSpeed * 60
      routeDriving += travel
      routeWork    += travel
      curMin       += travel

      if (m.timeWindow && curMin < m.timeWindow.openMin) {

        const waitMin = m.timeWindow.openMin - curMin
        routeWork += waitMin
        curMin = m.timeWindow.openMin
      }

      const onSite = (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0)
      routeOnSite += onSite
      routeWork   += onSite
      curMin      += onSite
      lat = m.latitude
      lng = m.longitude
    }

    const driverWarnings = warnings.filter(w => w.driverId === route.driverId && w.severity === 'warning').length
    const ds = computeDriverScore({
      workMin:          routeWork,
      drivingMin:       routeDriving,
      onSiteMin:        routeOnSite,
      roadDistKm:       routeDist,
      hasOvertime:      routeWork > MAX_WORK_MIN,
      hasBreachDriving: routeDriving > MAX_DRIVING_MIN,
      warnings:         driverWarnings,
    })
    driverScores.push(ds.total)
    workMinByDriver.push(routeWork)
  }

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

