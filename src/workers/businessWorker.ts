#!/usr/bin/env tsx

import { Worker, Queue, type Job } from 'bullmq'
import { createLogger } from '@/lib/logger'
import { validateEnv } from '@/lib/env'
import { workerConnectionOptions } from '@/lib/queue/connection'
import { unscopedPrisma } from '@/lib/tenantDb'
import { processDueDeliveries } from '@/lib/webhooks/outbox'
import { runDailyBusinessChecks } from '@/lib/notifications/daily'
import { installWorkerLifecycle } from './lifecycle'

const isMainEntry = process.argv[1] ? /businessWorker\.(ts|js|mjs)$/.test(process.argv[1].replace(/\\/g, '/')) : false
if (isMainEntry) validateEnv()

const log = createLogger('businessWorker')
const QUEUE_NAME = 'business-schedule'
const DELIVERY_RETENTION_DAYS = 30

/**
 * Scheduled business work of every tenant (cross-tenant by design, like the other workers):
 * - every 30 s: webhook deliveries due for (re)try;
 * - daily 06:00: expired quotes, overdue invoices, long bin stays, contracts ending, …
 *   (notifications, see src/lib/notifications/daily.ts), and purge of old successful deliveries.
 */
async function handleJob(job: Job): Promise<unknown> {
  if (job.name === 'webhooks') return { attempted: await processDueDeliveries(100) }
  if (job.name === 'daily') {
    const today = new Date().toISOString().slice(0, 10)
    const expired = await unscopedPrisma.quote.updateMany({ where: { status: 'SENT', validUntil: { lt: today } }, data: { status: 'EXPIRED' } })
    const purged = await unscopedPrisma.webhookDelivery.deleteMany({
      where: { status: 'SUCCESS', createdAt: { lt: new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000) } },
    })
    const notified = await runDailyBusinessChecks()
    return { expiredQuotes: expired.count, purgedDeliveries: purged.count, notified }
  }
  return null
}

async function main() {
  const connection = workerConnectionOptions()
  const queue = new Queue(QUEUE_NAME, { connection })
  queue.on('error', err => log.warn('Queue error', { err: err.message }))
  await queue.add('webhooks', {}, { repeat: { every: 30_000 }, jobId: 'business-webhooks', removeOnComplete: 10, removeOnFail: 10 })
  await queue.add('daily', {}, { repeat: { pattern: '0 6 * * *' }, jobId: 'business-daily', removeOnComplete: 7, removeOnFail: 7 })
  const worker = new Worker(QUEUE_NAME, handleJob, { connection, concurrency: 1 })
  worker.on('failed', (job, err) => log.error('Job failed', { name: job?.name, err: err.message }))
  worker.on('error', err => log.error('Worker error', { err: err.message }))
  installWorkerLifecycle(log, [() => worker.close(), () => queue.close(), () => unscopedPrisma.$disconnect()])
  log.info('Business worker started (webhooks every 30 s, daily checks 06:00)')
}

if (isMainEntry) {
  main().catch(err => {
    log.error('Worker crashed', { err: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
