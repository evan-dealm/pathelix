import 'dotenv/config'
import { validateEnv } from '@/lib/env'
import { Queue, Worker } from 'bullmq'
import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'
import { createLogger } from '@/lib/logger'
import { workerConnectionOptions } from '@/lib/queue/connection'
import { installWorkerLifecycle } from './lifecycle'

// The helpers below are importable (tests) — the worker only starts when this file is the entry.
const isMainEntry = process.argv[1]
  ? /mlProfileWorker\.(ts|js|mjs)$/.test(process.argv[1].replace(/\\/g, '/'))
  : false
if (isMainEntry) validateEnv()

const log = createLogger('mlProfileWorker')

function createWorkerPrisma(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  })
  return new PrismaClient({ adapter, log: ['error'] })
}

export function trimmedMedian(values: number[]): number | null {
  if (values.length === 0) return null
  if (values.length < 5) {

    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  const sorted = [...values].sort((a, b) => a - b)
  const p10 = Math.floor(sorted.length * 0.10)
  const p90 = Math.ceil(sorted.length * 0.90)
  const trimmed = sorted.slice(p10, p90)

  if (trimmed.length === 0) return sorted[Math.floor(sorted.length / 2)]
  return trimmed[Math.floor(trimmed.length / 2)]
}

export function safeCoeff(actualMedian: number | null, estimatedMedian: number | null): number {
  if (actualMedian === null || estimatedMedian === null) return 1.0
  if (estimatedMedian <= 0) return 1.0
  const ratio = actualMedian / estimatedMedian

  return Math.max(0.3, Math.min(3.0, ratio))
}

const MIN_SAMPLES_GLOBAL = 30
const MIN_SAMPLES_TYPE   = 15
const MIN_SAMPLES_DRIVER = 20
const MIN_SAMPLES_SITE   = 10

async function computeProfiles(): Promise<void> {
  const prisma = createWorkerPrisma()
  const t0 = Date.now()

  try {

    const tenants = await prisma.tenant.findMany({
      where: { suspendedAt: null },
      select: { id: true, name: true },
    })

    log.info(`Processing ${tenants.length} tenants`)

    let totalUpserts = 0

    let failedTenants = 0
    for (const tenant of tenants) {
      // One tenant's bad data must not stop the nightly run for every tenant after it.
      try {
        const upserts = await computeTenantProfile(prisma, tenant.id)
        totalUpserts += upserts
        if (upserts > 0) log.info(`Tenant ${tenant.name}: ${upserts} coefficients updated`)
      } catch (err) {
        failedTenants++
        log.error('ML profile failed for tenant — skipped', { tenantId: tenant.id, err: err instanceof Error ? err.message : String(err) })
      }
    }
    if (failedTenants > 0) log.warn('ML profile run finished with failures', { failedTenants })

    log.info(`ML profile computation complete`, {
      tenants: tenants.length,
      upserts: totalUpserts,
      durationMs: Date.now() - t0,
    })
  } finally {
    await prisma.$disconnect()
  }
}

export async function computeTenantProfile(prisma: PrismaClient, tenantId: string): Promise<number> {

  const metrics = await prisma.interventionMetric.findMany({
    where: { tenantId, isReliable: true },
    select: {
      driverId:             true,
      siteId:               true,
      missionType:          true,
      estimatedDurationMin: true,
      estimatedManeuverMin: true,
      estimatedTravelMin:   true,
      actualDurationMin:    true,
      actualManeuverMin:    true,
      actualTravelMin:      true,
      confidenceScore:      true,
    },
  })

  if (metrics.length < MIN_SAMPLES_GLOBAL) return 0

  let upserts = 0

  upserts += await upsertProfile(prisma, tenantId, 'global', '', '_ALL_', metrics)

  const byType = groupBy(metrics, m => m.missionType)
  for (const [type, group] of byType) {
    if (group.length >= MIN_SAMPLES_TYPE) {
      upserts += await upsertProfile(prisma, tenantId, 'type', type, type, group)
    }
  }

  const byDriver = groupBy(metrics, m => m.driverId)
  for (const [driverId, group] of byDriver) {
    if (group.length >= MIN_SAMPLES_DRIVER) {
      upserts += await upsertProfile(prisma, tenantId, 'driver', driverId, '_ALL_', group)
    }
  }

  const bySite = groupBy(metrics.filter(m => m.siteId), m => m.siteId!)
  for (const [siteId, group] of bySite) {
    if (group.length >= MIN_SAMPLES_SITE) {
      upserts += await upsertProfile(prisma, tenantId, 'site', siteId, '_ALL_', group)
    }
  }

  return upserts
}

interface MetricRow {
  estimatedDurationMin: number
  estimatedManeuverMin: number
  estimatedTravelMin:   number | null
  actualDurationMin:    number
  actualManeuverMin:    number
  actualTravelMin:      number | null
  confidenceScore:      number
}

async function upsertProfile(
  prisma:     PrismaClient,
  tenantId:   string,
  scope:      string,
  scopeId:    string,
  missionType: string,
  metrics:    MetricRow[],
): Promise<number> {

  const good = metrics.filter(m => m.confidenceScore >= 0.5)
  if (good.length === 0) return 0

  const actualDurations  = good.map(m => m.actualDurationMin)
  const actualManeuvers  = good.map(m => m.actualManeuverMin)
  const actualTravels    = good.filter(m => m.actualTravelMin !== null).map(m => m.actualTravelMin!)
  const estDurations     = good.map(m => m.estimatedDurationMin)
  const estManeuvers     = good.map(m => m.estimatedManeuverMin)
  const estTravels       = good.filter(m => m.estimatedTravelMin !== null).map(m => m.estimatedTravelMin!)

  const medDuration = trimmedMedian(actualDurations)
  const medManeuver = trimmedMedian(actualManeuvers)
  const medTravel   = trimmedMedian(actualTravels)
  const medEstDur   = trimmedMedian(estDurations)
  const medEstMan   = trimmedMedian(estManeuvers)
  const medEstTrav  = trimmedMedian(estTravels)

  const data = {
    durationCoeff:     safeCoeff(medDuration, medEstDur),
    maneuverCoeff:     safeCoeff(medManeuver, medEstMan),
    travelCoeff:       safeCoeff(medTravel, medEstTrav),
    sampleCount:       good.length,
    medianDurationMin: medDuration,
    medianManeuverMin: medManeuver,
    medianTravelMin:   medTravel,
    lastComputedAt:    new Date(),
  }

  const profileMissionType = (missionType || '_ALL_') as never
  await prisma.tenantMLProfile.upsert({
    where: {
      tenantId_scope_scopeId_missionType: { tenantId, scope, scopeId, missionType: profileMissionType },
    },
    update: data,
    create: {
      tenantId, scope, scopeId,
      missionType: profileMissionType,
      ...data,
    },
  })

  return 1
}

export function groupBy<T>(items: T[], keyFn: (_item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const arr = map.get(key)
    if (arr) { arr.push(item) } else { map.set(key, [item]) }
  }
  return map
}

async function computeProfilesWithRetry(maxAttempts = 3, delayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await computeProfiles()
      return
    } catch (err) {
      log.error(`Attempt ${attempt}/${maxAttempts} failed`, {
        err: err instanceof Error ? err.message : String(err),
      })
      if (attempt === maxAttempts) throw err
      log.info(`Retrying in ${delayMs / 1000}s...`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
}

const QUEUE_NAME = 'ml-profiles'

/**
 * Long-running mode (default, what docker-compose runs): a BullMQ repeatable job recomputes the
 * coefficients every night at 03:00. The process used to compute once and exit — under a
 * `restart: unless-stopped` policy that meant recomputing in a tight loop all day.
 * `--once` keeps the one-shot behaviour for an external cron or a manual run.
 */
async function main(): Promise<void> {
  if (process.argv.includes('--once')) {
    await computeProfilesWithRetry()
    log.info('ML profile worker finished successfully')
    process.exit(0)
  }

  const connection = workerConnectionOptions()
  const queue = new Queue(QUEUE_NAME, { connection })
  queue.on('error', err => log.warn('Queue error', { err: err.message }))
  await queue.add('compute', {}, {
    repeat:           { pattern: process.env.ML_PROFILE_CRON ?? '0 3 * * *' },
    jobId:            'ml-profiles-nightly',
    removeOnComplete: 7,
    removeOnFail:     3,
  })

  const worker = new Worker(QUEUE_NAME, () => computeProfilesWithRetry(), { connection, concurrency: 1 })
  worker.on('completed', job => log.info('ML profiles computed', { id: job.id }))
  worker.on('failed',    (job, err) => log.error('ML profile computation failed', { id: job?.id, err: err.message }))
  worker.on('error',     err => log.error('Worker error', { err: err.message }))

  installWorkerLifecycle(log, [() => worker.close(), () => queue.close()])
  log.info('ML profile worker started', { cron: process.env.ML_PROFILE_CRON ?? '0 3 * * *' })
}

if (isMainEntry) {
  main().catch(err => {
    log.error('ML profile worker failed', { err: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
