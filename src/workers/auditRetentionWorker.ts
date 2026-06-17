#!/usr/bin/env tsx

import { Worker, Queue, Job } from 'bullmq'
import { createLogger }       from '@/lib/logger'
import { getRedisClient }     from '@/lib/redisClient'
import prisma                 from '@/lib/db'

const log = createLogger('auditRetentionWorker')

const QUEUE_NAME           = 'audit-retention'
const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '365', 10)

export async function purgeExpiredAuditLogs(): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - AUDIT_RETENTION_DAYS)

  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })

  log.info('Audit log retention purge complete', {
    deleted: result.count,
    cutoffDays: AUDIT_RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
  })

  return { deleted: result.count, cutoff: cutoff.toISOString() }
}

async function processAuditRetention(_job: Job) {
  return purgeExpiredAuditLogs()
}

async function main() {
  const redis = await getRedisClient()
  if (!redis) { log.error('Redis unavailable — audit retention worker cannot start'); process.exit(1) }

  const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10) || 6379,
  }

  const queue = new Queue(QUEUE_NAME, { connection })

  await queue.add('purge', {}, {
    repeat:           { pattern: '0 2 * * *' },
    jobId:            'audit-retention-daily',
    removeOnComplete: 7,
    removeOnFail:     3,
  })

  const worker = new Worker(QUEUE_NAME, processAuditRetention, {
    connection,
    concurrency: 1,
  })

  worker.on('completed', job => log.info('Purge completed', { id: job.id, result: job.returnvalue }))
  worker.on('failed',    (job, err) => log.error('Purge failed', { id: job?.id, err: err.message }))

  log.info(`Audit retention worker started (CRON 02:00 UTC, retention ${AUDIT_RETENTION_DAYS} days)`)
}

const isDirectRun = process.argv[1]
  ? /auditRetentionWorker\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))
  : false

if (isDirectRun) {
  main().catch(err => {
    log.error('Worker crashed', { err: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
