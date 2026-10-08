import { auditAsync } from '@/lib/audit'
import { NextRequest, NextResponse } from 'next/server'
import { OptimizeRequestSchema } from '@/lib/schemas'
import { createLogger } from '@/lib/logger'
import {
  createRateLimiter,
  createTenantRateLimiter,
  getTenantPlanLimit,
  getClientIp,
} from '@/lib/rateLimit'
import { getRequestContext } from '@/lib/data/context'
import { hasPermission } from '@/lib/permissions'
import { getTenantDb, type TenantDb } from '@/lib/tenantDb'
import { getPlanningDrivers, exclusionMessage, withEstimatedWeights } from '@/lib/data/planning'
import { planningOptionsFromSettings } from '@/lib/vrp/tenantOptions'
import { getMissionsByDate } from '@/lib/data/missions'
import { getAllExutoires } from '@/lib/data/exutoires'
import { loadShedder, shedResponse } from '@/lib/loadShedder'
import { metrics, METRIC } from '@/lib/metrics'
import { enqueueVrpJob, hasActiveVrpWorker } from '@/lib/queue/vrpQueue'
import { runVRPOffThread, SolverBusyError } from '@/lib/vrp/solverPool'
import { isLocked } from '@/lib/vrp/livePlan'
import type { Mission } from '@/lib/types'
import { broadcastToTenant, type PushSubRecord } from '@/lib/webPush'
import { getRedisClient } from '@/lib/redisClient'

const log = createLogger('/api/optimize')
const _ipRl = createRateLimiter(10, 60_000, { redis: true, prefix: 'rl:optimize-ip' })

const PUSH_THROTTLE_TTL_S = 120

async function maybeSendOptimizationPush(
  db: TenantDb,
  tenantId: string,
  date: string,
  assignedMissions: number,
  totalMissions: number,
): Promise<void> {
  try {
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
      title: 'Tournées optimisées',
      body: `${assignedMissions}/${totalMissions} missions assignées pour le ${date}`,
      tag: `vrp-${tenantId}-${date}`,
      data: { date, type: 'vrp_complete' },
    })
  } catch {
    // non-critical
  }
}

const _tenantLimiters = new Map<number, ReturnType<typeof createTenantRateLimiter>>()
function _getTenantLimiter(max: number) {
  if (!_tenantLimiters.has(max))
    _tenantLimiters.set(max, createTenantRateLimiter(max, 60_000, 'optimize'))
  return _tenantLimiters.get(max)!
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const loadSlot = loadShedder.acquire()
  if (loadSlot === 'shed') return shedResponse() as NextResponse

  try {
    const ip = getClientIp(req.headers)
    const { tenantId, userId, role } = getRequestContext(req)

    if (!(await hasPermission(userId, role, 'optimize'))) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    if (!(await _ipRl.check(ip))) {
      return NextResponse.json(
        { error: 'Trop de requêtes. Réessayez dans une minute.' },
        { status: 429, headers: _ipRl.headers(ip) },
      )
    }

    const planMax = await getTenantPlanLimit(tenantId, 'optimize')
    const tenantRl = _getTenantLimiter(planMax)
    if (!(await tenantRl.check(tenantId))) {
      return NextResponse.json(
        {
          error: `Quota dépassé (${planMax} optimisations/min sur votre plan). Réessayez dans une minute.`,
        },
        { status: 429, headers: tenantRl.headers(tenantId) },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    }

    const parsed = OptimizeRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { date, driverIds, existingPlans, options } = parsed.data

    const db = getTenantDb(tenantId)
    const [planning, allMissions, allExutoires, tenantSettings] = await Promise.all([
      getPlanningDrivers(tenantId, date),
      getMissionsByDate(tenantId, date),
      getAllExutoires(tenantId),
      db.tenantSettings.findUnique({ where: { tenantId } }),
    ])

    // A full optimisation re-plans every mission of the day from scratch. Once work has been done
    // in the field, it handed finished stops back as work to do — possibly to another truck. A day
    // in progress is re-optimised by /api/optimize/live, which keeps what is started or done.
    const dayPlans = await db.plan.findMany({ where: { date }, select: { statuses: true } })
    const dayStarted =
      allMissions.some(m => !m.archived && m.completedAt) ||
      dayPlans.some(
        p =>
          p.statuses !== null &&
          typeof p.statuses === 'object' &&
          Object.values(p.statuses as Record<string, unknown>).some(isLocked),
      )
    if (dayStarted) {
      return NextResponse.json(
        {
          error:
            'La journée a commencé : des missions sont en cours ou terminées. Utilisez « Live » pour ré-optimiser le reste de la journée sans toucher à ce qui est fait.',
          code: 'DAY_STARTED',
        },
        { status: 409 },
      )
    }

    const drivers = (
      driverIds ? planning.drivers.filter(d => driverIds.includes(d.id)) : planning.drivers
    ).filter(d => !d.archived)
    const excluded = driverIds
      ? planning.excluded.filter(e => driverIds.includes(e.driverId))
      : planning.excluded

    if (driverIds && drivers.length < driverIds.length) {
      log.warn('Some requested drivers not found', {
        requested: driverIds.length,
        found: drivers.length,
      })
    }

    if (drivers.length === 0) {
      return NextResponse.json(
        {
          error:
            excluded.length > 0
              ? `Aucun chauffeur disponible pour cette date — ${excluded.map(exclusionMessage).join(' ; ')}`
              : 'Aucun chauffeur disponible pour cette date',
        },
        { status: 422 },
      )
    }

    // Nessy missions are recorded by their webhook and come with the day's missions.
    const missions: Mission[] = await withEstimatedWeights(
      tenantId,
      allMissions.filter(m => !m.archived && !m.needsGeocode),
    )

    const instanceMin =
      missions.length < 20
        ? 2_000
        : missions.length < 50
          ? 5_000
          : missions.length < 200
            ? 10_000
            : 15_000
    const autoTimeBudget = Math.min(
      120_000,
      Math.max(instanceMin, Math.ceil(missions.length / 200) * 1_000),
    )
    const effectiveTimeBudget = options?.timeBudgetMs ?? autoTimeBudget

    log.info('enqueue start', {
      tenantId,
      date,
      drivers: drivers.length,
      missions: missions.length,
      timeBudget: effectiveTimeBudget,
    })

    const vrpOptions = {
      timeBudgetMs: effectiveTimeBudget,
      seed: options?.seed ?? 42,
      lnsIterations: options?.lnsIterations,
      lnsDestroyRatio: options?.lnsDestroyRatio,
      existingPlans: existingPlans ?? {},
      defaultSpeedKmh: tenantSettings?.defaultSpeedKmh ?? 50,
      defaultStartTime: tenantSettings?.defaultStartTime ?? '07:00',
      valhallaFactor: tenantSettings?.valhallaFactor ?? 1.6,
      weights: options?.weights ?? undefined,
      usePareto: options?.usePareto ?? false,
      tenantId,
      ...planningOptionsFromSettings(tenantSettings),
      extraWarnings: excluded.map(e => ({
        driverId: e.driverId,
        message: exclusionMessage(e),
        severity: 'warning' as const,
      })),
    }

    try {
      // Bounded: with Redis down this used to hang forever and the sync fallback never ran.
      if (!(await hasActiveVrpWorker())) throw new Error('no-workers')

      const jobId = await enqueueVrpJob({
        tenantId,
        date,
        missions,
        drivers,
        exutoires: allExutoires,
        existingPlans: existingPlans ?? {},
        options: vrpOptions,
      })

      metrics.increment(METRIC.VRP_ENQUEUED, { tenantId })
      log.info('enqueue ok', { tenantId, date, jobId, missions: missions.length })

      return NextResponse.json(
        {
          jobId,
          status: 'queued',
          mode: 'async',
          missions: missions.length,
          drivers: drivers.length,
        },
        { status: 202 },
      )
    } catch (queueErr) {
      // A saturated queue is not a reason to compute here: that would move the overload into
      // the web server. The dispatcher is told to retry.
      if (queueErr instanceof Error && queueErr.name === 'VrpQueueFullError') {
        return NextResponse.json({ error: queueErr.message, code: 'QUEUE_FULL' }, { status: 503, headers: { 'Retry-After': '60' } })
      }
      log.info('Exécution VRP directe (Redis indisponible ou aucun worker)', {
        tenantId,
        date,
        drivers: drivers.length,
        missions: missions.length,
      })

      // Repli sans Redis ni worker : le calcul tourne dans un thread de calcul de ce process
      // (solverPool), pas dans la boucle d'événements — les autres requêtes continuent d'être
      // servies. Budget plafonné à 15 s ; file bornée (503 SOLVER_BUSY au-delà).
      const syncOptions = {
        ...vrpOptions,
        timeBudgetMs: Math.min(vrpOptions.timeBudgetMs ?? 15_000, 15_000),
      }
      const result = await runVRPOffThread(missions, drivers, allExutoires, date, syncOptions)

      auditAsync(req, 'optimization.run', 'Plan', date, {
        planned: result.stats.assignedMissions,
        total: result.stats.totalMissions,
        unassigned: result.unassignedMissions.length,
      })
      void maybeSendOptimizationPush(
        db,
        tenantId,
        date,
        result.stats.assignedMissions,
        missions.length,
      )
      void import('@/lib/events/outbound')
        .then(({ emitBusinessEvent }) =>
          emitBusinessEvent(tenantId, 'route.optimized', {
            date,
            assignedMissions: result.stats.assignedMissions,
            totalMissions: result.stats.totalMissions,
            unassigned: result.unassignedMissions.length,
          }),
        )
        .catch(() => {})

      return NextResponse.json(
        {
          status: 'completed',
          mode: 'sync',
          result,
          missions: missions.length,
          drivers: drivers.length,
        },
        { status: 200 },
      )
    }
  } catch (err) {
    if (err instanceof SolverBusyError) {
      return NextResponse.json({ error: err.message, code: 'SOLVER_BUSY' }, { status: 503, headers: { 'Retry-After': '10' } })
    }
    log.error('enqueue failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/optimize', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  } finally {
    loadShedder.release()
  }
}
