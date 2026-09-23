import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { emitEvent } from '@/lib/integrationEvents'

const log = createLogger('metricCollector')

interface MissionStatusEntry {
  status:      string
  todoAt?:     string
  en_routeAt?: string
  arrivedAt?:  string
  startedAt?:  string
  doneAt?:     string
  lat?:        number
  lng?:        number
}

interface CollectInput {
  tenantId:  string
  driverId:  string
  missionId: string
  date:      string
  statuses:  Record<string, MissionStatusEntry>
}

const EXPECTED_DURATION_MIN: Record<string, number> = {
  POSER:            30,
  RETIRER:          30,
  ECHANGER:         45,
  VIDER:            15,
  PAUSE:            45,
  CHARGER_IMMEDIAT: 20,
  DEPLACER:         20,
  TASSER:           25,
  EXPEDIER:         30,
  ALLER_RETOUR:     90,
}

const MIN_TRANSITION_SEC = 10
const OUTLIER_MULTIPLIER = 4
const GPS_INCOHERENT_KM  = 2

function diffMin(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return null
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return (b - a) / 60_000
}

function diffSec(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return null
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return (b - a) / 1_000
}

export async function collectInterventionMetric(input: CollectInput): Promise<void> {
  try {
    const { tenantId, driverId, missionId, date, statuses } = input
    const entry = statuses[missionId]
    if (!entry || entry.status !== 'done') return

    const db = getTenantDb(tenantId)
    const mission = await db.mission.findFirst({
      where: { id: missionId },
      select: {
        type: true,
        estimatedDurationMin: true,
        maneuverTimeMin: true,
        siteId: true,
        clientId: true,
        latitude: true,
        longitude: true,
      },
    })
    if (!mission) {
      log.warn('Mission not found for metric collection', { missionId, tenantId })
      return
    }

    const enRouteAt = entry.en_routeAt
    const arrivedAt = entry.arrivedAt
    const startedAt = entry.startedAt
    const doneAt    = entry.doneAt

    if (!doneAt) return

    const actualTravelMin      = diffMin(enRouteAt, arrivedAt)
    const actualManeuverMin    = diffMin(arrivedAt, startedAt)
    const actualDurationMin    = diffMin(startedAt, doneAt)
    const actualTotalOnSiteMin = diffMin(arrivedAt, doneAt)

    if (actualDurationMin === null || actualTotalOnSiteMin === null) {
      log.debug('Incomplete timestamps — skipping metric', { missionId })
      return
    }

    let isReliable = true
    let rejectReason: string | null = null

    const transitions = [
      { from: enRouteAt, to: arrivedAt, label: 'en_route→arrived' },
      { from: arrivedAt, to: startedAt, label: 'arrived→started' },
      { from: startedAt, to: doneAt,    label: 'started→done' },
    ]

    for (const t of transitions) {
      const sec = diffSec(t.from, t.to)
      if (sec !== null && sec < MIN_TRANSITION_SEC) {
        isReliable = false
        rejectReason = `burst_click:${t.label}(${Math.round(sec)}s)`
        break
      }

      if (sec !== null && sec < 0) {
        isReliable = false
        rejectReason = `negative_transition:${t.label}`
        break
      }
    }

    if (isReliable) {
      const expectedMin = EXPECTED_DURATION_MIN[mission.type] ?? 30
      if (actualDurationMin > expectedMin * OUTLIER_MULTIPLIER) {
        isReliable = false
        rejectReason = `duration_outlier:${Math.round(actualDurationMin)}min(expected<${expectedMin * OUTLIER_MULTIPLIER})`
      }

      if (actualManeuverMin !== null && actualManeuverMin > 60) {
        isReliable = false
        rejectReason = `maneuver_outlier:${Math.round(actualManeuverMin)}min`
      }
    }

    if (isReliable && actualTravelMin !== null && actualTravelMin < 1) {

      if (entry.lat && entry.lng && mission.latitude && mission.longitude) {
        const dLat = (entry.lat - mission.latitude) * 111
        const dLng = (entry.lng - mission.longitude) * 111 * Math.cos(mission.latitude * Math.PI / 180)
        const approxKm = Math.sqrt(dLat * dLat + dLng * dLng)
        if (approxKm > GPS_INCOHERENT_KM) {
          isReliable = false
          rejectReason = `gps_incoherent:travel=${Math.round(actualTravelMin)}min,dist=${approxKm.toFixed(1)}km`
        }
      }
    }

    let confidenceScore = 1.0
    if (!isReliable) {
      confidenceScore = 0.0
    } else {

      if (actualManeuverMin === null) confidenceScore -= 0.2

      if (actualTravelMin === null) confidenceScore -= 0.2

      if (!entry.lat || !entry.lng) confidenceScore -= 0.1
      confidenceScore = Math.max(0, confidenceScore)
    }

    let estimatedTravelMin: number | null = null
    let distanceKm: number | null = null
    try {
      const plan = await db.plan.findFirst({
        where: { driverId, date },
        select: { missions: true, estimatedDistanceKm: true },
      })
      if (plan && Array.isArray(plan.missions)) {
        const planMission = (plan.missions as Array<{ id: string; precomputedTravelMin?: number }>)
          .find(m => m.id === missionId)
        if (planMission?.precomputedTravelMin !== undefined) {
          estimatedTravelMin = planMission.precomputedTravelMin
        }
      }

      if (entry.lat && entry.lng && mission.latitude && mission.longitude) {
        const dLat = (entry.lat - mission.latitude) * 111
        const dLng = (entry.lng - mission.longitude) * 111 * Math.cos(mission.latitude * Math.PI / 180)
        distanceKm = Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 10) / 10
      }
    } catch (err) {
      log.warn('Plan lookup failed during metric collection', { tenantId, driverId, missionId, err: err instanceof Error ? err.message : String(err) })
    }

    await db.interventionMetric.create({
      data: {
        driverId,
        missionId,
        missionType:          mission.type,
        date,
        siteId:               mission.siteId,
        clientId:             mission.clientId,
        estimatedDurationMin: mission.estimatedDurationMin,
        estimatedManeuverMin: mission.maneuverTimeMin,
        estimatedTravelMin,
        actualDurationMin,
        actualManeuverMin:    actualManeuverMin ?? 0,
        actualTravelMin,
        actualTotalOnSiteMin,
        distanceKm,
        latitude:             entry.lat ?? null,
        longitude:            entry.lng ?? null,
        enRouteAt:            enRouteAt ? new Date(enRouteAt) : null,
        arrivedAt:            arrivedAt ? new Date(arrivedAt) : null,
        startedAt:            startedAt ? new Date(startedAt) : null,
        doneAt:               new Date(doneAt),
        isReliable,
        rejectReason,
        confidenceScore,
      } as Parameters<typeof db.interventionMetric.create>[0]['data'],
    })

    if (!isReliable && rejectReason) {
      void emitEvent(tenantId, 'anomaly.detected', {
        missionId, driverId, date, reason: rejectReason,
        type: mission.type, confidenceScore,
      })
    }

    log.info('Metric collected', {
      missionId,
      driverId,
      type: mission.type,
      isReliable,
      rejectReason,
      confidenceScore: confidenceScore.toFixed(2),
      actualDurationMin: Math.round(actualDurationMin),
    })
  } catch (err) {

    log.error('Metric collection failed (non-fatal)', {
      missionId: input.missionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
