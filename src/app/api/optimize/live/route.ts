import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'
import { getPlanningDrivers, exclusionMessage, withEstimatedWeights } from '@/lib/data/planning'
import { planningOptionsFromSettings } from '@/lib/vrp/tenantOptions'
import type { DriverStartOverride } from '@/lib/vrp/types'
import { getMissionsByDate } from '@/lib/data/missions'
import { getAllExutoires } from '@/lib/data/exutoires'
import { runVRP } from '@/lib/vrp/index'
import { loadShedder, shedResponse } from '@/lib/loadShedder'
import { metrics, METRIC } from '@/lib/metrics'
import type { Mission } from '@/lib/types'
import { broadcastToTenant, type PushSubRecord } from '@/lib/webPush'
import { getRedisClient } from '@/lib/redisClient'
import { hasPermission } from '@/lib/permissions'
import { unscopedPrisma } from '@/lib/tenantDb'
import {
  isLocked, liveStartState, lockedSteps, mergeLockedAndOptimized, minutesToHHMM, nowMinutesInTimeZone, parsePlanMissions,
} from '@/lib/vrp/livePlan'

const log = createLogger('/api/optimize/live')

const PUSH_THROTTLE_TTL_S = 120

async function maybeSendOptimizationPush(
  tenantId: string,
  date: string,
  assignedMissions: number,
  totalMissions: number,
): Promise<void> {
  try {
    const db = getTenantDb(tenantId)
    const settings = await db.tenantSettings.findUnique({ where: { tenantId } })
    if (!settings?.notificationsEnabled) return

    const redis = await getRedisClient()
    const throttleKey = `push:throttle:${tenantId}:${date}`
    if (redis) {
      const existing = await redis.get(throttleKey).catch(() => null)
      if (existing) return
      await redis.setex(throttleKey, PUSH_THROTTLE_TTL_S, '1').catch(() => {})
    }

    const subs = await db.pushSubscription.findMany({
      select: { endpoint: true, p256dh: true, auth: true },
    })
    if (subs.length === 0) return

    await broadcastToTenant(subs as PushSubRecord[], {
      title: 'Tournées re-optimisées',
      body:  `${assignedMissions}/${totalMissions} missions assignées pour le ${date}`,
      tag:   `vrp-live-${tenantId}-${date}`,
      data:  { date, type: 'vrp_live_complete' },
    })
  } catch {
    // non-critical
  }
}

const LiveOptimizeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  driverIds: z.array(z.string().min(1)).optional(),
  options: z.object({
    timeBudgetMs: z.number().int().min(1000).max(10_000).optional(),
    weights: z.object({
      distance: z.number().min(0).max(2).optional(),
      punctuality: z.number().min(0).max(2).optional(),
      balance: z.number().min(0).max(2).optional(),
      stability: z.number().min(0).max(2).optional(),
    }).optional(),
  }).optional(),
})


export async function POST(req: NextRequest): Promise<NextResponse> {
  const loadSlot = loadShedder.acquire()
  if (loadSlot === 'shed') return shedResponse() as NextResponse

  try {
    const { tenantId, role, userId } = getRequestContext(req)
    if (!(await hasPermission(userId, role, 'optimize'))) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    let raw: unknown
    try { raw = await req.json() }
    catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

    const parsed = LiveOptimizeSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { date, driverIds: requestedDriverIds, options } = parsed.data
    const startTs = Date.now()

    const db = getTenantDb(tenantId)
    const [planning, allMissions, allExutoires, tenantSettings, tenant] = await Promise.all([
      getPlanningDrivers(tenantId, date),
      getMissionsByDate(tenantId, date),
      getAllExutoires(tenantId),
      db.tenantSettings.findUnique({ where: { tenantId } }),
      unscopedPrisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
    ])

    const drivers = (requestedDriverIds
      ? planning.drivers.filter(d => requestedDriverIds.includes(d.id))
      : planning.drivers
    ).filter(d => !d.archived)
    const excluded = requestedDriverIds ? planning.excluded.filter(e => requestedDriverIds.includes(e.driverId)) : planning.excluded

    if (drivers.length === 0) {
      return NextResponse.json({ error: 'Aucun chauffeur disponible' }, { status: 422 })
    }

    const scopeIds = new Set(drivers.map(d => d.id))
    const allPlans = await db.plan.findMany({
      where: { date },
      select: { driverId: true, statuses: true, startTime: true, missions: true },
    })
    const plans = allPlans.filter(p => scopeIds.has(p.driverId))

    const planMap = new Map(plans.map(p => [p.driverId, p]))

    // Missions held by drivers outside this re-optimisation stay with them — they used to be
    // re-planned too and ended up in two drivers' tours.
    const heldElsewhere = new Set<string>()
    for (const p of allPlans) {
      if (scopeIds.has(p.driverId)) continue
      for (const m of parsePlanMissions(p.missions)) heldElsewhere.add(m.id)
    }

    const driverStartOverrides = new Map<string, DriverStartOverride>()
    const planningOpts = planningOptionsFromSettings(tenantSettings)
    const timeZone = tenant?.timezone ?? 'Europe/Paris'
    const lockedMissionIds = new Set<string>()
    const lockedByDriver = new Map<string, ReturnType<typeof lockedSteps>>()

    // "Now" in the tenant's time zone — the server runs in UTC.
    const currentTimeMin = nowMinutesInTimeZone(tenant?.timezone ?? 'Europe/Paris')

    for (const driver of drivers) {
      const plan = planMap.get(driver.id)
      if (!plan?.statuses || typeof plan.statuses !== 'object') continue

      const locked = lockedSteps(parsePlanMissions(plan.missions), plan.statuses as Record<string, unknown>)
      lockedByDriver.set(driver.id, locked)

      const statuses = plan.statuses as Record<string, {
        status?: string
        lat?: number
        lng?: number
        doneAt?: string
        startedAt?: string
        arrivedAt?: string
        en_routeAt?: string
      }>

      let lastLat: number | undefined
      let lastLng: number | undefined
      let lastTimestamp = 0

      for (const [missionId, s] of Object.entries(statuses)) {
        if (!s || typeof s !== 'object') continue

        // Any step the driver has acted on (en route included) is locked.
        if (isLocked(s)) lockedMissionIds.add(missionId)

        if (s.lat && s.lng) {
          const ts = s.doneAt || s.startedAt || s.arrivedAt || s.en_routeAt
          if (ts) {
            const tsTime = new Date(ts).getTime()
            if (tsTime > lastTimestamp) {
              lastTimestamp = tsTime
              lastLat = s.lat
              lastLng = s.lng
            }
          }
        }
      }

      // The day has started for this driver: resume from where they are (last GPS fix, else the
      // last step reached, else the depot) with the driving/working-time counters and the load
      // rebuilt from the field statuses — never a fresh 4 h 30 at 3 pm.
      if (locked.length > 0) {
        const recentFix = lastLat && lastLng && (Date.now() - lastTimestamp) < 2 * 60 * 60 * 1000
        const lastStep = [...locked].reverse().find(m => m.type !== 'PAUSE' && (m.latitude !== 0 || m.longitude !== 0))
        const dayStart = (() => { const [h, m] = (plan.startTime ?? '07:00').split(':').map(Number); return (h || 0) * 60 + (m || 0) })()
        const state = liveStartState(locked, plan.statuses as Record<string, unknown>, dayStart, currentTimeMin, timeZone, planningOpts.costConfig.lunchBreakEndMin)
        driverStartOverrides.set(driver.id, {
          lat: recentFix ? lastLat! : lastStep?.latitude ?? driver.depotLat,
          lng: recentFix ? lastLng! : lastStep?.longitude ?? driver.depotLng,
          timeMin: currentTimeMin,
          clock: state.clock,
          lunchTaken: state.lunchTaken,
          load: state.load,
        })
      }
    }

    const activeMissions: Mission[] = await withEstimatedWeights(tenantId, allMissions.filter(m =>
      !m.archived && !m.needsGeocode && !lockedMissionIds.has(m.id) && !heldElsewhere.has(m.id),
    ))

    if (activeMissions.length === 0) {
      return NextResponse.json({
        message: 'Toutes les missions sont terminées ou en cours',
        stats: {
          locked: lockedMissionIds.size,
          reoptimized: 0,
          timeTakenMs: Date.now() - startTs,
        },
      })
    }

    const effectiveTimeBudget = Math.min(10_000, options?.timeBudgetMs ?? 8_000)

    log.info('Live re-optimization start', {
      tenantId,
      date,
      drivers: drivers.length,
      totalMissions: allMissions.length,
      lockedMissions: lockedMissionIds.size,
      activeMissions: activeMissions.length,
      driversWithGPS: driverStartOverrides.size,
      timeBudget: effectiveTimeBudget,
    })

    const result = await runVRP(activeMissions, drivers, allExutoires, date, {
      timeBudgetMs: effectiveTimeBudget,
      seed: Date.now() % 10000,
      defaultSpeedKmh: tenantSettings?.defaultSpeedKmh ?? 50,
      valhallaFactor:  tenantSettings?.valhallaFactor  ?? 1.60,
      defaultStartTime: minutesToHHMM(currentTimeMin),
      weights: {
        distance: options?.weights?.distance ?? 0.5,
        punctuality: options?.weights?.punctuality ?? 1.0,
        balance: options?.weights?.balance ?? 0.3,
        stability: options?.weights?.stability ?? 0.5,
      },
      tenantId,
      driverStartOverrides,
      ...planningOpts,
      extraWarnings: excluded.map(e => ({ driverId: e.driverId, message: exclusionMessage(e), severity: 'warning' as const })),
    })

    // Every driver in scope gets its plan rewritten — even with nothing new (otherwise it kept
    // missions the optimiser just gave to someone else) — locked steps first, in one transaction.
    await db.$transaction(async (tx) => {
      for (const driver of drivers) {
        const merged = mergeLockedAndOptimized(lockedByDriver.get(driver.id) ?? [], result.assignments[driver.id] ?? [])
        const missionsJson = merged as unknown as Parameters<typeof tx.plan.update>[0]['data']['missions']
        await tx.plan.upsert({
          // The compound unique key structurally requires tenantId here.
          where:  { tenantId_driverId_date: { tenantId, driverId: driver.id, date } },
          update: { missions: missionsJson },
          create: {
            driverId: driver.id,
            date,
            missions: missionsJson,
            startTime: minutesToHHMM(currentTimeMin),
          } as Parameters<typeof tx.plan.upsert>[0]['create'],
        })
      }
    }, { timeout: 30_000 })

    metrics.increment(METRIC.VRP_ENQUEUED, { tenantId, type: 'live' })

    void maybeSendOptimizationPush(tenantId, date, result.stats.assignedMissions, activeMissions.length)

    log.info('Live re-optimization complete', {
      tenantId,
      date,
      assigned: result.stats.assignedMissions,
      timeTakenMs: Date.now() - startTs,
    })

    return NextResponse.json({
      result,
      stats: {
        locked: lockedMissionIds.size,
        reoptimized: activeMissions.length,
        driversWithGPS: driverStartOverrides.size,
        timeTakenMs: Date.now() - startTs,
      },
    })

  } catch (err) {
    log.error('Live optimization failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/optimize/live', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  } finally {
    loadShedder.release()
  }
}
