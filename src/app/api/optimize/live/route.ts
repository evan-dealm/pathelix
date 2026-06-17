import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import prisma from '@/lib/db'
import { getAllDrivers } from '@/lib/data/drivers'
import { getMissionsByDate } from '@/lib/data/missions'
import { getAllExutoires } from '@/lib/data/exutoires'
import { runVRP } from '@/lib/vrp/index'
import { loadShedder, shedResponse } from '@/lib/loadShedder'
import { metrics, METRIC } from '@/lib/metrics'
import type { Mission } from '@/lib/types'
import { broadcastToTenant, type PushSubRecord } from '@/lib/webPush'
import { getRedisClient } from '@/lib/redisClient'

const log = createLogger('/api/optimize/live')

const PUSH_THROTTLE_TTL_S = 120

async function maybeSendOptimizationPush(
  tenantId: string,
  date: string,
  assignedMissions: number,
  totalMissions: number,
): Promise<void> {
  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } })
    if (!settings?.notificationsEnabled) return

    const redis = await getRedisClient()
    const throttleKey = `push:throttle:${tenantId}:${date}`
    if (redis) {
      const existing = await redis.get(throttleKey).catch(() => null)
      if (existing) return
      await redis.setex(throttleKey, PUSH_THROTTLE_TTL_S, '1').catch(() => {})
    }

    const subs = await prisma.pushSubscription.findMany({
      where: { tenantId },
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

const LOCKED_STATUSES = new Set(['done', 'started', 'arrived'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  const loadSlot = loadShedder.acquire()
  if (loadSlot === 'shed') return shedResponse() as NextResponse

  try {
    const { tenantId, role } = getRequestContext(req)
    if (role !== 'admin' && role !== 'dispatcher' && role !== 'superadmin') {
      return NextResponse.json({ error: 'Accès réservé aux admins et dispatchers' }, { status: 403 })
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

    const [allDrivers, allMissions, allExutoires, tenantSettings] = await Promise.all([
      getAllDrivers(tenantId),
      getMissionsByDate(tenantId, date),
      getAllExutoires(tenantId),
      prisma.tenantSettings.findUnique({ where: { tenantId } }),
    ])

    const drivers = (requestedDriverIds
      ? allDrivers.filter(d => requestedDriverIds.includes(d.id))
      : allDrivers
    ).filter(d => !d.archived)

    if (drivers.length === 0) {
      return NextResponse.json({ error: 'Aucun chauffeur disponible' }, { status: 422 })
    }

    const plans = await prisma.plan.findMany({
      where: { tenantId, date, driverId: { in: drivers.map(d => d.id) } },
      select: { driverId: true, statuses: true, startTime: true },
    })

    const planMap = new Map(plans.map(p => [p.driverId, p]))

    const driverStartOverrides = new Map<string, { lat: number; lng: number; timeMin: number }>()
    const lockedMissionIds = new Set<string>()

    const now = new Date()
    const currentTimeMin = now.getHours() * 60 + now.getMinutes()

    for (const driver of drivers) {
      const plan = planMap.get(driver.id)
      if (!plan?.statuses || typeof plan.statuses !== 'object') continue

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

        if (s.status && LOCKED_STATUSES.has(s.status)) {
          lockedMissionIds.add(missionId)
        }

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

      if (lastLat && lastLng && (Date.now() - lastTimestamp) < 2 * 60 * 60 * 1000) {
        driverStartOverrides.set(driver.id, {
          lat: lastLat,
          lng: lastLng,
          timeMin: currentTimeMin,
        })
      }
    }

    const activeMissions: Mission[] = allMissions.filter(m =>
      !m.archived && !m.needsGeocode && !lockedMissionIds.has(m.id),
    )

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
      defaultStartTime: `${Math.floor(currentTimeMin / 60).toString().padStart(2, '0')}:${(currentTimeMin % 60).toString().padStart(2, '0')}`,
      weights: {
        distance: options?.weights?.distance ?? 0.5,
        punctuality: options?.weights?.punctuality ?? 1.0,
        balance: options?.weights?.balance ?? 0.3,
        stability: options?.weights?.stability ?? 0.5,
      },
      tenantId,

      _driverStartOverrides: driverStartOverrides,
    } as Parameters<typeof runVRP>[4] & { _driverStartOverrides: typeof driverStartOverrides })

    for (const driver of drivers) {
      const driverPlan = result.assignments[driver.id]
      if (!driverPlan || driverPlan.length === 0) continue

      await prisma.plan.upsert({
        where: {
          tenantId_driverId_date: { tenantId, driverId: driver.id, date },
        },
        update: {
          missions: driverPlan as unknown as Parameters<typeof prisma.plan.update>[0]['data']['missions'],
        },
        create: {
          tenantId,
          driverId: driver.id,
          date,
          missions: driverPlan as unknown as Parameters<typeof prisma.plan.create>[0]['data']['missions'],
          startTime: `${Math.floor(currentTimeMin / 60).toString().padStart(2, '0')}:${(currentTimeMin % 60).toString().padStart(2, '0')}`,
        },
      })
    }

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
