import dotenv from 'dotenv'
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })
import { validateEnv } from '@/lib/env'
validateEnv()
import { Worker, type Job } from 'bullmq'
import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'
import { VRP_QUEUE_NAME, type VrpJobData, type VrpJobResult } from '@/lib/queue/vrpQueue'
import { workerConnectionOptions } from '@/lib/queue/connection'
import { installWorkerLifecycle } from './lifecycle'
import { runVRP } from '@/lib/vrp/index'
import { buildWarmStartFromReference } from '@/lib/vrp/warmStart'
import { createLogger } from '@/lib/logger'
import type { PlannedMission } from '@/lib/types'
import { startTrafficAggregation, stopTrafficAggregation } from '@/services/trafficAggregator'
import { broadcastToTenant, type PushSubRecord } from '@/lib/webPush'
import { getRedisClient } from '@/lib/redisClient'

const log = createLogger('vrpWorker')

let _prisma: PrismaClient | null = null

function getPrisma(): PrismaClient {
  if (!_prisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 3 })
    _prisma = new PrismaClient({ adapter, log: ['error'] })
  }
  return _prisma
}

function getJ7Date(dateStr: string): string {
  // A date-only string parses as UTC midnight — mixing in setDate()/getDate() (LOCAL time) here
  // would round-trip through the server process's local timezone and could shift the result by
  // a day near midnight if TZ isn't UTC. Stay in UTC throughout.
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
}

async function loadWarmStart(
  tenantId: string,
  date: string,
  missions: VrpJobData['missions'],
): Promise<Record<string, string[]> | null> {
  try {
    const j7Date = getJ7Date(date)
    const prisma  = getPrisma()
    const plans   = await prisma.plan.findMany({
      where: { tenantId, date: j7Date },
      select: { driverId: true, missions: true },
    })

    if (plans.length === 0) return null

    const referencePlan: Array<{
      missionId: string; siteId?: string; clientId?: string; type: string; driverId: string
    }> = []

    for (const plan of plans) {
      const planMissions = plan.missions as unknown as PlannedMission[]
      if (!Array.isArray(planMissions)) continue
      for (const pm of planMissions) {
        if (!pm.id || !pm.type) continue
        referencePlan.push({
          missionId: pm.id,
          siteId:    pm.siteId,
          clientId:  pm.clientId,
          type:      pm.type,
          driverId:  plan.driverId,
        })
      }
    }

    if (referencePlan.length === 0) return null

    const { existingPlans } = buildWarmStartFromReference(missions, referencePlan)
    return Object.keys(existingPlans).length > 0 ? existingPlans : null
  } catch (err) {
    log.warn?.('Warm-start J-7 unavailable', { err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

const PUSH_THROTTLE_TTL_S = 120

async function maybeSendOptimizationPush(
  tenantId: string,
  date: string,
  assignedMissions: number,
  totalMissions: number,
): Promise<void> {
  try {
    const prisma = getPrisma()
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
      title: 'Tournées optimisées',
      body:  `${assignedMissions}/${totalMissions} missions assignées pour le ${date}`,
      tag:   `vrp-${tenantId}-${date}`,
      data:  { date, type: 'vrp_complete' },
    })
  } catch {
    // non-critical — never block job completion
  }
}

async function processJob(job: Job<VrpJobData, VrpJobResult>): Promise<VrpJobResult> {
  const { missions, drivers, exutoires, date, existingPlans, options, tenantId } = job.data

  if (!Array.isArray(missions)) throw new Error('Invalid input: missions must be an array')
  if (!Array.isArray(drivers)) throw new Error('Invalid input: drivers must be an array')
  if (!Array.isArray(exutoires)) throw new Error('Invalid input: exutoires must be an array')
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid input: date must be YYYY-MM-DD format, got "${date}"`)
  }
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('Invalid input: tenantId is required')
  }

  for (let i = 0; i < missions.length; i++) {
    const m = missions[i]
    if (!m.id || typeof m.latitude !== 'number' || !isFinite(m.latitude)
            || typeof m.longitude !== 'number' || !isFinite(m.longitude)) {
      throw new Error(`Invalid mission at index ${i} (id=${m?.id}): missing or invalid coordinates`)
    }
  }

  for (let i = 0; i < drivers.length; i++) {
    const d = drivers[i]
    if (!d.id || typeof d.depotLat !== 'number' || !isFinite(d.depotLat)
            || typeof d.depotLng !== 'number' || !isFinite(d.depotLng)) {
      throw new Error(`Invalid driver at index ${i} (id=${d?.id}): missing or invalid depot coordinates`)
    }
  }

  log.info('Job start', {
    jobId:        job.id,
    tenantId,
    date,
    missions:     missions.length,
    drivers:      drivers.length,
    weights:      options.weights ?? 'NONE',
  })

  const elapsed = log.timer()

  const safeProgress = async (pct: number) => {
    try { await job.updateProgress(pct) } catch {  }
  }

  await safeProgress(5)
  await new Promise<void>(resolve => setImmediate(resolve))
  await safeProgress(10)

  const resolvedExistingPlans = existingPlans && Object.keys(existingPlans).length > 0
    ? existingPlans
    : await loadWarmStart(tenantId, date, missions)

  if (resolvedExistingPlans) {
    log.info('Warm-start J-7 loaded', {
      jobId: job.id,
      drivers: Object.keys(resolvedExistingPlans).length,
    })
  }

  const result = await runVRP(
    missions,
    drivers.filter(d => !d.archived),
    exutoires,
    date,
    {
      timeBudgetMs:    options.timeBudgetMs    ?? 30_000,
      seed:            options.seed            ?? 42,
      lnsIterations:   options.lnsIterations   ?? 120,
      lnsDestroyRatio: options.lnsDestroyRatio ?? 0.3,
      existingPlans:   resolvedExistingPlans   ?? {},
      weights:         options.weights         ?? undefined,
      tenantId,
    },
  )

  await new Promise<void>(resolve => setImmediate(resolve))
  await safeProgress(100)

  const elapsedMs = elapsed()

  log.info('Job complete', {
    jobId:    job.id,
    tenantId,
    ms:       elapsedMs,
    assigned: result.stats.assignedMissions,
    total:    result.stats.totalMissions,
  })

  import('@/lib/integrationEvents').then(({ emitEvent }) => {
    void emitEvent(tenantId, 'tour.optimized', {
      assignedMissions: result.stats.assignedMissions,
      totalMissions: result.stats.totalMissions,
      driverCount: drivers.length,
      score: result.stats.globalScore ?? result.stats.score ?? 0,
      timeTakenMs: elapsedMs,
      date,
    })
  }).catch(() => {})

  void maybeSendOptimizationPush(tenantId, date, result.stats.assignedMissions, result.stats.totalMissions)

  return result
}

const concurrency = parseInt(process.env.VRP_CONCURRENCY ?? '1', 10) || 1

const worker = new Worker<VrpJobData, VrpJobResult>(
  VRP_QUEUE_NAME,
  processJob,
  {
    connection:  workerConnectionOptions() as never,
    concurrency,

    lockDuration: 300_000,
  },
)

worker.on('completed', (job, result) => {
  log.info('Job completed', {
    jobId:    job.id,
    assigned: result.stats.assignedMissions,
  })
})

worker.on('failed', (job, err) => {
  log.error('Job failed', {
    jobId: job?.id,
    err:   err instanceof Error ? err.message : String(err),
  })
})

worker.on('error', err => {
  log.error('Worker error', { err: err instanceof Error ? err.message : String(err) })
})

installWorkerLifecycle(log, [
  () => worker.close(),
  async () => stopTrafficAggregation(),
  async () => { await _prisma?.$disconnect() },
])

log.info('VRP Worker started', { queue: VRP_QUEUE_NAME, concurrency })

if (process.env.VALHALLA_URL) {
  startTrafficAggregation()
}
