import type { PlannedMission, Exutoire, TourResult, TourStep, TourWarning } from '@/lib/types'
import { MAX_WORK_MIN, MAX_DRIVING_MIN, WARN_WORK_MIN } from '@/lib/constraints'
import { auditTimeline, type Activity } from '@/lib/vrp/driverClock'

const WARN_WORK_TOTAL_MIN = MAX_DRIVING_MIN

export type { TourResult, TourStep, TourWarning } from '@/lib/types'

function zonalRoadFactor(distKm: number): number {
  if (distKm < 5)  return 1.50
  if (distKm < 20) return 1.35
  return 1.20
}

import {
  haversineKm as _haversineKm,
} from '@/lib/vrp/distanceCache'

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) return 0
  if (lat1 === lat2 && lng1 === lng2) return 0
  return _haversineKm(lat1, lng1, lat2, lng2)
}

export function roadDistKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const hav = haversineKm(lat1, lng1, lat2, lng2)
  return hav * zonalRoadFactor(hav)
}

const _weekdayTraffic = new Float32Array(1440)
const _saturdayTraffic = new Float32Array(1440)
;(() => {
  for (let m = 0; m < 1440; m++) {
    _weekdayTraffic[m] = _computeTrafficFactor(m)
    _saturdayTraffic[m] = 0.85
  }
})()

function _computeTrafficFactor(m: number): number {

  if (m >= 1320 || m < 300) return 0.90
  if (m >= 300 && m < 420)  return 0.90 + ((m - 300) / 120) * 0.05
  if (m >= 420 && m < 480)  return 0.95 + ((m - 420) / 60)  * 0.10
  if (m >= 480 && m < 510)  return 1.05 + ((m - 480) / 30)  * 0.05
  if (m >= 510 && m < 600)  return 1.10 - ((m - 510) / 90)  * 0.10
  if (m >= 600 && m < 720)  return 1.00
  if (m >= 720 && m < 810)  return 1.00 + Math.sin(((m - 720) / 90) * Math.PI) * 0.03
  if (m >= 810 && m < 960)  return 1.00
  if (m >= 960 && m < 1050) return 1.00 + ((m - 960)  / 90)  * 0.08
  if (m >= 1050 && m < 1110) return 1.08
  if (m >= 1110 && m < 1200) return 1.08 - ((m - 1110) / 90) * 0.08
  if (m >= 1200 && m < 1320) return 1.00 - ((m - 1200) / 120) * 0.10
  return 1.00
}

export function trafficFactor(minutesSinceMidnight: number, dayOfWeek?: number): number {
  if (!isFinite(minutesSinceMidnight)) return 1.0
  const m = ((minutesSinceMidnight % 1440) + 1440) % 1440

  if (dayOfWeek === undefined || (dayOfWeek >= 1 && dayOfWeek <= 5)) return _weekdayTraffic[m]
  if (dayOfWeek === 6) return _saturdayTraffic[m]
  if (dayOfWeek === 0) return 0.75

  return _weekdayTraffic[m]
}

interface UrbanCenter {
  lat: number
  lng: number

  radiusKm: number

  intensity: number
}

const DEFAULT_URBAN_CENTERS: UrbanCenter[] = [
  { lat: 45.188, lng: 5.724,  radiusKm: 25, intensity: 0.9 },
  { lat: 45.764, lng: 4.836,  radiusKm: 35, intensity: 1.0 },
  { lat: 45.566, lng: 5.921,  radiusKm: 15, intensity: 0.7 },
  { lat: 45.899, lng: 6.129,  radiusKm: 12, intensity: 0.6 },
  { lat: 46.204, lng: 6.144,  radiusKm: 10, intensity: 0.5 },
]

let _urbanCenters: UrbanCenter[] | null = null

function getUrbanCenters(): UrbanCenter[] {
  if (_urbanCenters) return _urbanCenters
  const envJson = process.env.URBAN_CENTERS_JSON
  if (envJson) {
    try {
      _urbanCenters = JSON.parse(envJson) as UrbanCenter[]
      return _urbanCenters
    } catch {  }
  }
  _urbanCenters = DEFAULT_URBAN_CENTERS
  return _urbanCenters
}

export function directionalTrafficBonus(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  minutesSinceMidnight: number,
): number {

  const m = ((minutesSinceMidnight % 1440) + 1440) % 1440
  let rushIntensity = 0
  let rushDirection = 1

  if (m >= 420 && m < 570) {

    rushIntensity = m < 480 ? (m - 420) / 60
                  : m < 540 ? 1.0
                  :           1.0 - (m - 540) / 30
    rushDirection = 1
  } else if (m >= 960 && m < 1170) {

    rushIntensity = m < 1050 ? (m - 960) / 90
                  : m < 1110 ? 1.0
                  :            1.0 - (m - 1110) / 60
    rushDirection = -1
  }

  if (rushIntensity <= 0.01) return 0

  const dLat = lat2 - lat1
  const dLng = lng2 - lng1
  const moveMag = Math.sqrt(dLat * dLat + dLng * dLng)
  if (moveMag < 0.001) return 0

  const centers = getUrbanCenters()
  let maxEffect = 0

  for (const center of centers) {

    const midLat = (lat1 + lat2) / 2
    const midLng = (lng1 + lng2) / 2
    const toCenterLat = center.lat - midLat
    const toCenterLng = center.lng - midLng
    const toCenterMag = Math.sqrt(toCenterLat * toCenterLat + toCenterLng * toCenterLng)
    if (toCenterMag < 0.001) continue

    const distKm = toCenterMag * 111
    if (distKm > center.radiusKm) continue

    const cosAngle = (dLat * toCenterLat + dLng * toCenterLng) / (moveMag * toCenterMag)

    const distFactor = 1 - (distKm / center.radiusKm)

    const effect = cosAngle * rushDirection * distFactor * center.intensity

    if (Math.abs(effect) > Math.abs(maxEffect)) {
      maxEffect = effect
    }
  }

  const bonus = maxEffect * rushIntensity * 0.10
  return Math.max(-0.05, Math.min(0.10, bonus))
}

const SEGMENT_MIN = 15

export function travelTimeMin(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  speedKmh:     number,
  departureMin: number,
): number {
  const dist = roadDistKm(lat1, lng1, lat2, lng2)
  if (dist === 0)         return 0
  if (speedKmh <= 0)      return Infinity
  if (!isFinite(dist))    return 0

  const dirBonus = directionalTrafficBonus(lat1, lng1, lat2, lng2, departureMin)

  if (dist < 3) {
    const factor = trafficFactor(departureMin) * (1 + dirBonus)
    return Math.ceil((dist / (speedKmh / Math.max(0.01, factor))) * 60)
  }

  let remainingKm = dist
  let currentMin  = departureMin
  let elapsedMin  = 0

  const maxIter = Math.ceil((dist / speedKmh) * 60 / SEGMENT_MIN) + 10

  for (let i = 0; i < maxIter && remainingKm > 0.01; i++) {

    const factor       = trafficFactor(currentMin) * (1 + dirBonus)
    const effectiveSpd = speedKmh / Math.max(0.01, factor)
    const distThisStep = (effectiveSpd * SEGMENT_MIN) / 60

    if (distThisStep >= remainingKm) {
      elapsedMin  += (remainingKm / distThisStep) * SEGMENT_MIN
      remainingKm  = 0
    } else {
      remainingKm -= distThisStep
      elapsedMin  += SEGMENT_MIN
      currentMin  += SEGMENT_MIN
    }
  }

  if (remainingKm > 0.01) {
    const lastFactor  = trafficFactor(currentMin) * (1 + dirBonus)
    const lastSpeed   = speedKmh / Math.max(0.01, lastFactor)
    elapsedMin += (remainingKm / lastSpeed) * 60
  }

  return Math.ceil(elapsedMin)
}

export function formatDuration(minutes: number): string {
  const m = Math.round(Math.max(0, minutes))
  if (m === 0) return '0 min'
  const h   = Math.floor(m / 60)
  const min = m % 60
  if (h === 0)   return `${min} min`
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

export function minToHHMM(min: number): string {
  const total = Math.round(((min % 1440) + 1440) % 1440)
  const h     = Math.floor(total / 60)
  const m     = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

export function calcTour(
  missions:  PlannedMission[],
  depotLat:  number,
  depotLng:  number,
  startTime: string,
  speedKmh:  number,
  exutoires?: Exutoire[],
  costParams?: { costPerKm?: number; fuelCostPerLiter?: number; consumptionLPer100?: number },
): TourResult {
  const warnings: TourWarning[] = []
  const steps:    TourStep[]    = []

  let speed = speedKmh
  if (!isFinite(speed) || speed <= 0) {
    warnings.push({ message: `Vitesse invalide (${speedKmh} km/h) — utilisation de 50 km/h par défaut`, severity: 'warning' })
    speed = 50
  }

  let safeDepotLat = depotLat
  let safeDepotLng = depotLng
  if (!isFinite(safeDepotLat) || !isFinite(safeDepotLng)) {
    warnings.push({ message: 'Coordonnées du dépôt invalides', severity: 'error' })
    safeDepotLat = 0
    safeDepotLng = 0
  }

  const startMin = parseHHMM(startTime)

  let currentMin   = startMin
  let currentLat   = safeDepotLat
  let currentLng   = safeDepotLng
  let totalDriving = 0
  let totalOnSite  = 0
  let totalDist    = 0

  // What the driver does, minute by minute, for the CE 561/2006 + working-time audit: a plan
  // edited by hand (drag & drop, manual times) is checked with the breaks it actually contains.
  const activities: Activity[] = []

  const exutoireMap = new Map<string, Exutoire>()
  if (exutoires) {
    for (const ex of exutoires) exutoireMap.set(ex.id, ex)
  }

  for (let _mi = 0; _mi < missions.length; _mi++) {
    const mission = missions[_mi]

    // (0, 0) is how the app stores "not geocoded yet" (imports, manual entry without address
    // lookup) — treating it as a real point added a trip to the Gulf of Guinea and hundreds of
    // hours of "driving" to the tour.
    const missingCoords = !isFinite(mission.latitude) || !isFinite(mission.longitude)
      || (mission.latitude === 0 && mission.longitude === 0)
    if (missingCoords) {
      // A break happens wherever the truck is: no position needed, nothing to warn about.
      if (mission.type !== 'PAUSE') {
        warnings.push({
          message:  `Mission "${mission.address}" : coordonnées GPS manquantes — trajet non calculé`,
          severity: 'warning',
        })
      }
      const onSiteMin    = Math.max(0, mission.estimatedDurationMin) + Math.max(0, mission.maneuverTimeMin ?? 0)
      const departureMin = currentMin + onSiteMin
      activities.push({ kind: mission.type === 'PAUSE' ? 'BREAK' : 'WORK', minutes: onSiteMin, ref: mission.id })
      steps.push({
        mission,
        arrivalMin:       currentMin,
        departureMin,
        arrivalStr:       minToHHMM(currentMin),
        departureStr:     minToHHMM(departureMin),
        travelMin:        0,
        roadDistKm:       0,
        onSiteMin,
        hasMissingCoords: true,
      })
      totalOnSite  += onSiteMin
      currentMin    = departureMin
      continue
    }

    const travelMin = (mission.precomputedTravelMin !== undefined)
      ? mission.precomputedTravelMin
      : travelTimeMin(currentLat, currentLng, mission.latitude, mission.longitude, speed, currentMin)
    const dist      = roadDistKm(currentLat, currentLng, mission.latitude, mission.longitude)
    let   arrivalMin = currentMin + (isFinite(travelMin) ? travelMin : 0)

    if (mission.manualStartMin !== undefined && mission.manualStartMin > arrivalMin) {
      arrivalMin = mission.manualStartMin
    }

    if (mission.timeWindow && arrivalMin < mission.timeWindow.openMin) {
      arrivalMin = mission.timeWindow.openMin
    }

    if (mission.timeWindow && arrivalMin > mission.timeWindow.closeMin) {
      warnings.push({
        message:  `Mission "${mission.address}" : arrivée à ${minToHHMM(arrivalMin)} après la fermeture de la fenêtre (${minToHHMM(mission.timeWindow.closeMin)})`,
        severity: 'warning',
      })
    }

    const onSiteMin    = Math.max(0, mission.estimatedDurationMin) + Math.max(0, mission.maneuverTimeMin ?? 0)
    const departureMin = arrivalMin + onSiteMin

    const driveMin = isFinite(travelMin) ? travelMin : 0
    activities.push({ kind: 'DRIVE', minutes: driveMin, ref: mission.id })
    activities.push({ kind: 'WAIT', minutes: arrivalMin - (currentMin + driveMin), ref: mission.id })
    activities.push({ kind: mission.type === 'PAUSE' ? 'BREAK' : 'WORK', minutes: onSiteMin, ref: mission.id })

    steps.push({
      mission,
      arrivalMin,
      departureMin,
      arrivalStr:   minToHHMM(arrivalMin),
      departureStr: minToHHMM(departureMin),
      travelMin:    isFinite(travelMin) ? travelMin : 0,
      roadDistKm:   dist,
      onSiteMin,
    })

    totalDriving += isFinite(travelMin) ? travelMin : 0
    totalOnSite  += onSiteMin
    totalDist    += dist

    const nextMission = missions[_mi + 1]
    const nextIsSyntheticVider = nextMission?.isSynthetic && nextMission?.type === 'VIDER'
    const needsExutoireRouting = !nextIsSyntheticVider && (
      mission.type === 'RETIRER' || mission.type === 'ECHANGER'
      || mission.type === 'ALLER_RETOUR' || mission.type === 'CHARGER_IMMEDIAT'
    )
    if (needsExutoireRouting && mission.linkedExutoireId) {
      const ex = exutoireMap.get(mission.linkedExutoireId)

      if (!ex) {
        warnings.push({
          message:  `Mission "${mission.address}" : exutoire lié introuvable (id: ${mission.linkedExutoireId})`,
          severity: 'warning',
        })
      } else {
        const exTravelMin  = travelTimeMin(mission.latitude, mission.longitude, ex.lat, ex.lng, speed, departureMin)
        const exDist       = roadDistKm(mission.latitude, mission.longitude, ex.lat, ex.lng)
        let   exArrivalMin = departureMin + (isFinite(exTravelMin) ? exTravelMin : 0)

        const isOpenAtTime = (time: number, open: number, close: number): boolean => {
          if (close >= open) {

            return time >= open && time < close
          }

          return time >= open || time < close
        }

        if (!isOpenAtTime(exArrivalMin, ex.openingHoursOpen, ex.openingHoursClose)) {

          if (exArrivalMin < ex.openingHoursOpen) {
            exArrivalMin = ex.openingHoursOpen
          }
        }

        if (ex.openingHoursClose > 0 && !isOpenAtTime(exArrivalMin, ex.openingHoursOpen, ex.openingHoursClose)) {
          warnings.push({
            message:  `Exutoire "${ex.name}" : arrivée prévue à ${minToHHMM(exArrivalMin)} après la fermeture (${minToHHMM(ex.openingHoursClose)})`,
            severity: 'warning',
          })
        }

        const exDepartureMin = exArrivalMin + ex.serviceTimeMin
        const exDrive = isFinite(exTravelMin) ? exTravelMin : 0
        activities.push({ kind: 'DRIVE', minutes: exDrive })
        activities.push({ kind: 'WAIT', minutes: exArrivalMin - (departureMin + exDrive) })
        activities.push({ kind: 'WORK', minutes: ex.serviceTimeMin })

        const exMission: PlannedMission = {
          id:                   `_ex_${ex.id}_after_${mission.id}`,
          type:                 'VIDER',
          date:                 mission.date,
          address:              ex.address,
          clientName:           ex.name,
          latitude:             ex.lat,
          longitude:            ex.lng,
          estimatedDurationMin: ex.serviceTimeMin,
          maneuverTimeMin:      0,
          sequenceOrder:        mission.sequenceOrder + 0.5,
          isSynthetic:          true,
        }

        steps.push({
          mission:      exMission,
          arrivalMin:   exArrivalMin,
          departureMin: exDepartureMin,
          arrivalStr:   minToHHMM(exArrivalMin),
          departureStr: minToHHMM(exDepartureMin),
          travelMin:    isFinite(exTravelMin) ? exTravelMin : 0,
          roadDistKm:   exDist,
          onSiteMin:    ex.serviceTimeMin,
        })

        totalDriving += isFinite(exTravelMin) ? exTravelMin : 0
        totalOnSite  += ex.serviceTimeMin
        totalDist    += exDist

        if (mission.type === 'ALLER_RETOUR') {
          const returnTravelMin   = travelTimeMin(ex.lat, ex.lng, mission.latitude, mission.longitude, speed, exDepartureMin)
          const returnDist        = roadDistKm(ex.lat, ex.lng, mission.latitude, mission.longitude)
          const returnArrivalMin  = exDepartureMin + (isFinite(returnTravelMin) ? returnTravelMin : 0)
          const poseDurationMin   = mission.maneuverTimeMin ?? 15
          const poseDepartureMin  = returnArrivalMin + poseDurationMin
          activities.push({ kind: 'DRIVE', minutes: isFinite(returnTravelMin) ? returnTravelMin : 0 })
          activities.push({ kind: 'WORK', minutes: poseDurationMin })

          steps.push({
            mission: {
              id:                   `_pose_ar_${mission.id}`,
              type:                 'POSER',
              date:                 mission.date,
              address:              mission.address,
              clientName:           mission.clientName,
              latitude:             mission.latitude,
              longitude:            mission.longitude,
              estimatedDurationMin: poseDurationMin,
              maneuverTimeMin:      0,
              sequenceOrder:        mission.sequenceOrder + 0.6,
              isSynthetic:          true,
            },
            arrivalMin:   returnArrivalMin,
            departureMin: poseDepartureMin,
            arrivalStr:   minToHHMM(returnArrivalMin),
            departureStr: minToHHMM(poseDepartureMin),
            travelMin:    isFinite(returnTravelMin) ? returnTravelMin : 0,
            roadDistKm:   returnDist,
            onSiteMin:    poseDurationMin,
          })

          totalDriving += isFinite(returnTravelMin) ? returnTravelMin : 0
          totalOnSite  += poseDurationMin
          totalDist    += returnDist

          currentMin = poseDepartureMin
          currentLat = mission.latitude
          currentLng = mission.longitude
        } else {
          currentMin = exDepartureMin
          currentLat = ex.lat
          currentLng = ex.lng
        }
        continue
      }
    }

    currentMin = departureMin
    currentLat = mission.latitude
    currentLng = mission.longitude
  }

  const returnTravelMin = missions.length > 0
    ? travelTimeMin(currentLat, currentLng, safeDepotLat, safeDepotLng, speed, currentMin)
    : 0
  const returnDist = missions.length > 0
    ? roadDistKm(currentLat, currentLng, safeDepotLat, safeDepotLng)
    : 0

  const safeReturn   = isFinite(returnTravelMin) ? returnTravelMin : 0
  const finishMin    = currentMin + safeReturn
  totalDriving      += safeReturn
  totalDist         += returnDist

  const totalDurationMin = finishMin - startMin

  activities.push({ kind: 'DRIVE', minutes: safeReturn })
  const audit = auditTimeline(activities)
  for (const v of audit.violations) {
    // Daily driving is reported below with the totals.
    if (v.code === 'DAILY_DRIVING') continue
    warnings.push({
      message:  `${v.message} (CE 561/2006${v.code === 'CONTINUOUS_DRIVING' ? '' : ' — temps de travail'})`,
      severity: v.code === 'CONTINUOUS_DRIVING' ? 'error' : 'warning',
    })
  }

  if (totalDriving > MAX_DRIVING_MIN) {
    warnings.push({
      message:  `Durée de conduite totale (${formatDuration(totalDriving)}) dépasse le maximum légal de ${formatDuration(MAX_DRIVING_MIN)} (CE 561/2006)`,
      severity: 'error',
    })
  } else if (totalDriving > WARN_WORK_MIN) {
    warnings.push({
      message:  `Durée de conduite (${formatDuration(totalDriving)}) dépasse le seuil d'alerte de ${formatDuration(WARN_WORK_MIN)}`,
      severity: 'warning',
    })
  }

  if (totalDurationMin > MAX_WORK_MIN) {
    warnings.push({
      message:  `Durée de travail totale (${formatDuration(totalDurationMin)}) dépasse le maximum légal de ${formatDuration(MAX_WORK_MIN)} (CE 561/2006)`,
      severity: 'error',
    })
  } else if (totalDurationMin > WARN_WORK_TOTAL_MIN) {
    warnings.push({
      message:  `Durée de travail (${formatDuration(totalDurationMin)}) approche du maximum légal de ${formatDuration(MAX_WORK_MIN)} — vérifiez la charge`,
      severity: 'warning',
    })
  }

  const fuelPerLiter   = costParams?.fuelCostPerLiter  ?? 1.85
  const consumptionL   = costParams?.consumptionLPer100 ?? 32
  const fuelCostEur    = totalDist > 0 ? (totalDist * consumptionL / 100) * fuelPerLiter : 0

  return {
    steps,
    totalDurationMin: Math.max(0, totalDurationMin),
    totalRoadDistKm:  totalDist,
    totalDrivingMin:  totalDriving,
    totalOnSiteMin:   totalOnSite,
    finishMin,
    finishStr:        minToHHMM(finishMin),
    returnTravelMin:  safeReturn,
    warnings,
    fuelCostEur:      Math.round(fuelCostEur * 100) / 100,
    breakMin:         audit.clock.breakTotal,
  }
}
