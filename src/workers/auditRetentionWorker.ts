#!/usr/bin/env tsx

import { Worker, Queue, type Job } from 'bullmq'
import { createLogger }       from '@/lib/logger'
import prisma                 from '@/lib/db'
import { validateEnv }        from '@/lib/env'
import { workerConnectionOptions } from '@/lib/queue/connection'
import { installWorkerLifecycle } from './lifecycle'

// The purge functions below are also usable as plain library functions — validateEnv() (which
// can process.exit) must only run when this file is the worker entry point.
const isMainEntry = process.argv[1]
  ? /auditRetentionWorker\.(ts|js|mjs)$/.test(process.argv[1].replace(/\\/g, '/'))
  : false
if (isMainEntry) validateEnv()

const log = createLogger('auditRetentionWorker')

const QUEUE_NAME = 'audit-retention'
const AUDIT_RETENTION_DAYS        = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '365', 10)
const POSITION_RETENTION_DAYS     = parseInt(process.env.POSITION_RETENTION_DAYS ?? '30', 10)
const IDEMPOTENCY_RETENTION_HOURS = 48
/** Rows deleted per statement: keeps each DELETE short so it never holds long locks. */
const BATCH_SIZE = 5_000

type PurgeResult = { deleted: number; cutoff: string }

/**
 * Deletes rows older than `cutoff` in batches of BATCH_SIZE ids. A single unbounded DELETE on a
 * large table (GPS positions grow by one row per driver every 30 s) would lock and bloat it.
 */
async function purgeInBatches(
  table: 'AuditLog' | 'DriverPosition' | 'IdempotencyKey' | 'AiJob',
  column: 'createdAt' | 'recordedAt' | 'expiresAt',
  cutoff: Date,
): Promise<number> {
  let total = 0
  for (;;) {
    // Identifiers come from the literal unions above, never from input.
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE id IN (SELECT id FROM "${table}" WHERE "${column}" < $1 LIMIT ${BATCH_SIZE})`,
      cutoff,
    )
    total += deleted
    if (deleted < BATCH_SIZE) return total
  }
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

export async function purgeExpiredAuditLogs(): Promise<PurgeResult> {
  const cutoff = daysAgo(AUDIT_RETENTION_DAYS)
  const deleted = await purgeInBatches('AuditLog', 'createdAt', cutoff)
  log.info('Audit log retention purge complete', { deleted, cutoffDays: AUDIT_RETENTION_DAYS })
  return { deleted, cutoff: cutoff.toISOString() }
}

/** GPS trail: only recent positions are used (live map, ETA, ML metrics of the day). */
export async function purgeExpiredDriverPositions(): Promise<PurgeResult> {
  const cutoff = daysAgo(POSITION_RETENTION_DAYS)
  const deleted = await purgeInBatches('DriverPosition', 'recordedAt', cutoff)
  log.info('Driver position retention purge complete', { deleted, cutoffDays: POSITION_RETENTION_DAYS })
  return { deleted, cutoff: cutoff.toISOString() }
}

// Idempotency keys only need to outlive a realistic replay window (offline queue retries).
export async function purgeExpiredIdempotencyKeys(): Promise<PurgeResult> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_RETENTION_HOURS * 3_600_000)
  const deleted = await purgeInBatches('IdempotencyKey', 'createdAt', cutoff)
  log.info('Idempotency key retention purge complete', { deleted, cutoffHours: IDEMPOTENCY_RETENTION_HOURS })
  return { deleted, cutoff: cutoff.toISOString() }
}

/** OCR jobs carry the uploaded ticket image; they are useless once past their own expiry. */
export async function purgeExpiredAiJobs(): Promise<PurgeResult> {
  const cutoff = new Date()
  const deleted = await purgeInBatches('AiJob', 'expiresAt', cutoff)
  log.info('Expired AI jobs purged', { deleted })
  return { deleted, cutoff: cutoff.toISOString() }
}

async function processAuditRetention(_job: Job) {
  // Sequential: these are maintenance deletes, no reason to compete for the pool.
  const auditLogs       = await purgeExpiredAuditLogs()
  const driverPositions = await purgeExpiredDriverPositions()
  const idempotencyKeys = await purgeExpiredIdempotencyKeys()
  const aiJobs          = await purgeExpiredAiJobs()
  return { auditLogs, driverPositions, idempotencyKeys, aiJobs }
}

async function main() {
  const connection = workerConnectionOptions()
  const queue = new Queue(QUEUE_NAME, { connection })
  queue.on('error', err => log.warn('Queue error', { err: err.message }))

  await queue.add('purge', {}, {
    repeat:           { pattern: '0 2 * * *' },
    jobId:            'audit-retention-daily',
    removeOnComplete: 7,
    removeOnFail:     3,
  })

  const worker = new Worker(QUEUE_NAME, processAuditRetention, { connection, concurrency: 1 })
  worker.on('completed', job => log.info('Purge completed', { id: job.id, result: job.returnvalue }))
  worker.on('failed',    (job, err) => log.error('Purge failed', { id: job?.id, err: err.message }))
  worker.on('error',     err => log.error('Worker error', { err: err.message }))

  installWorkerLifecycle(log, [() => worker.close(), () => queue.close(), () => prisma.$disconnect()])
  log.info('Retention worker started (daily 02:00)', {
    auditDays: AUDIT_RETENTION_DAYS, positionDays: POSITION_RETENTION_DAYS,
  })
}

if (isMainEntry) {
  main().catch(err => {
    log.error('Worker crashed', { err: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
