import { NextRequest, NextResponse }   from 'next/server'
import { OptimizeRequestSchema }        from '@/lib/schemas'
import { createLogger }                 from '@/lib/logger'
import { createRateLimiter, createTenantRateLimiter, getTenantPlanLimit, getClientIp } from '@/lib/rateLimit'
import { getRequestContext }             from '@/lib/data/context'
import { hasPermission }                from '@/lib/permissions'
import { getTenantDb, type TenantDb }   from '@/lib/tenantDb'
import { getPlanningDrivers, exclusionMessage, withEstimatedWeights } from '@/lib/data/planning'
import { planningOptionsFromSettings }  from '@/lib/vrp/tenantOptions'
import { getMissionsByDate }            from '@/lib/data/missions'
import { getAllExutoires }              from '@/lib/data/exutoires'
import { drainByDate }                  from '@/lib/missionQueue'
import { loadShedder, shedResponse }   from '@/lib/loadShedder'
import { metrics, METRIC }             from '@/lib/metrics'
import { enqueueVrpJob, hasActiveVrpWorker } from '@/lib/queue/vrpQueue'
import { runVRP }                       from '@/lib/vrp/index'
import type { Mission }                 from '@/lib/types'
import { broadcastToTenant, type PushSubRecord } from '@/lib/webPush'
import { getRedisClient }               from '@/lib/redisClient'

const log   = createLogger('/api/optimize')
const _ipRl = createRateLimiter(10, 60_000)

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
      body:  `${assignedMissions}/${totalMissions} missions assignées pour le ${date}`,
      tag:   `vrp-${tenantId}-${date}`,
      data:  { date, type: 'vrp_complete' },
    })
  } catch {
    // non-critical
  }
}

const _tenantLimiters = new Map<number, ReturnType<typeof createTenantRateLimiter>>()
function _getTenantLimiter(max: number) {
  if (!_tenantLimiters.has(max)) _tenantLimiters.set(max, createTenantRateLimiter(max, 60_000, 'optimize'))
  return _tenantLimiters.get(max)!
}

export async function POST(req: NextRequest): Promise<NextResponse> {

  const loadSlot = loadShedder.acquire()
  if (loadSlot === 'shed') return shedResponse() as NextResponse

  try {

    const ip                       = getClientIp(req.headers)
    const { tenantId, userId, role } = getRequestContext(req)

    if (!await hasPermission(userId, role, 'optimize')) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    if (!await _ipRl.check(ip)) {
      return NextResponse.json(
        { error: 'Trop de requêtes. Réessayez dans une minute.' },
        { status: 429, headers: _ipRl.headers(ip) },
      )
    }

    const planMax   = await getTenantPlanLimit(tenantId, 'optimize')
    const tenantRl  = _getTenantLimiter(planMax)
    if (!await tenantRl.check(tenantId)) {
      return NextResponse.json(
        { error: `Quota dépassé (${planMax} optimisations/min sur votre plan). Réessayez dans une minute.` },
        { status: 429, headers: tenantRl.headers(tenantId) },
      )
    }

    let body: unknown
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

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

    const drivers = (driverIds
      ? planning.drivers.filter(d => driverIds.includes(d.id))
      : planning.drivers
    ).filter(d => !d.archived)
    const excluded = driverIds ? planning.excluded.filter(e => driverIds.includes(e.driverId)) : planning.excluded

    if (driverIds && drivers.length < driverIds.length) {
      log.warn('Some requested drivers not found', { requested: driverIds.length, found: drivers.length })
    }

    if (drivers.length === 0) {
      return NextResponse.json(
        { error: excluded.length > 0
          ? `Aucun chauffeur disponible pour cette date — ${excluded.map(exclusionMessage).join(' ; ')}`
          : 'Aucun chauffeur disponible pour cette date' },
        { status: 422 },
      )
    }

    const nessyMissions: Mission[] = drainByDate(date, tenantId).map((q, _i) => ({
      ...q,
      id: `nessy-${crypto.randomUUID()}`,
    }))

    const missions: Mission[] = await withEstimatedWeights(tenantId, [
      ...allMissions.filter(m => !m.archived && !m.needsGeocode),
      ...nessyMissions,
    ])

    const instanceMin = missions.length < 20  ? 2_000
                      : missions.length < 50  ? 5_000
                      : missions.length < 200 ? 10_000
                      : 15_000
    const autoTimeBudget = Math.min(
      120_000,
      Math.max(instanceMin, Math.ceil(missions.length / 200) * 1_000),
    )
    const effectiveTimeBudget = options?.timeBudgetMs ?? autoTimeBudget

    log.info('enqueue start', {
      tenantId,
      date,
      drivers:    drivers.length,
      missions:   missions.length,
      timeBudget: effectiveTimeBudget,
    })

    const vrpOptions = {
      timeBudgetMs:    effectiveTimeBudget,
      seed:            options?.seed            ?? 42,
      lnsIterations:   options?.lnsIterations,
      lnsDestroyRatio: options?.lnsDestroyRatio,
      existingPlans:   existingPlans ?? {},
      defaultSpeedKmh:  tenantSettings?.defaultSpeedKmh  ?? 50,
      defaultStartTime: tenantSettings?.defaultStartTime ?? '07:00',
      valhallaFactor:   tenantSettings?.valhallaFactor   ?? 1.60,
      weights:          options?.weights ?? undefined,
      usePareto:        options?.usePareto ?? false,
      tenantId,
      ...planningOptionsFromSettings(tenantSettings),
      extraWarnings:    excluded.map(e => ({ driverId: e.driverId, message: exclusionMessage(e), severity: 'warning' as const })),
    }

    try {
      // Bounded: with Redis down this used to hang forever and the sync fallback never ran.
      if (!(await hasActiveVrpWorker())) throw new Error('no-workers')

      const jobId = await enqueueVrpJob({
        tenantId,
        date,
        missions,
        drivers,
        exutoires:    allExutoires,
        existingPlans: existingPlans ?? {},
        options:       vrpOptions,
      })

      metrics.increment(METRIC.VRP_ENQUEUED, { tenantId })
      log.info('enqueue ok', { tenantId, date, jobId, missions: missions.length })

      return NextResponse.json(
        { jobId, status: 'queued', mode: 'async', missions: missions.length, drivers: drivers.length },
        { status: 202 },
      )
    } catch {

      log.info('Exécution VRP directe (Redis indisponible ou aucun worker)', {
        tenantId, date, drivers: drivers.length, missions: missions.length,
      })

      // Mode synchrone = calcul dans le process web : budget plafonné à 15 s pour
      // que le fallback ne puisse jamais monopoliser le serveur (cause d'un
      // blocage CPU observé pendant l'audit)
      const syncOptions = {
        ...vrpOptions,
        timeBudgetMs: Math.min(vrpOptions.timeBudgetMs ?? 15_000, 15_000),
      }
      const result = await runVRP(missions, drivers, allExutoires, date, syncOptions)

      void maybeSendOptimizationPush(db, tenantId, date, result.stats.assignedMissions, missions.length)
      void import('@/lib/events/outbound').then(({ emitBusinessEvent }) => emitBusinessEvent(tenantId, 'route.optimized', {
        date, assignedMissions: result.stats.assignedMissions, totalMissions: result.stats.totalMissions, unassigned: result.unassignedMissions.length,
      })).catch(() => {})

      return NextResponse.json(
        { status: 'completed', mode: 'sync', result, missions: missions.length, drivers: drivers.length },
        { status: 200 },
      )
    }

  } catch (err) {
    log.error('enqueue failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/optimize', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  } finally {
    loadShedder.release()
  }
}
