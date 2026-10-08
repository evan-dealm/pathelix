import { createHash } from 'node:crypto'
import { Queue, type ConnectionOptions } from 'bullmq'
import type { Mission, Driver, Exutoire, OptimizationResult } from '@/lib/types'
import type { OptimizeOptions } from '@/lib/vrp/types'
import { queueConnectionOptions, withTimeout } from './connection'

/** Bound on any Redis round-trip made while serving an HTTP request. */
const REDIS_OP_TIMEOUT_MS = 3_000

export interface VrpJobData {
  tenantId: string
  date: string
  missions: Mission[]
  drivers: Driver[]
  exutoires: Exutoire[]
  existingPlans: Record<string, string[]>
  options: OptimizeOptions
}

export type VrpJobResult = OptimizationResult

export const VRP_QUEUE_NAME = 'vrp-optimization'

const RESULT_TTL_S = parseInt(process.env.VRP_RESULT_TTL_S ?? '3600', 10) || 3600

let _vrpQueue: Queue<VrpJobData, VrpJobResult> | null = null

export function getVrpQueue(): Queue<VrpJobData, VrpJobResult> {
  if (!_vrpQueue) {
    _vrpQueue = new Queue<VrpJobData, VrpJobResult>(VRP_QUEUE_NAME, {
      connection: queueConnectionOptions() as ConnectionOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        // A result is read by the screen that asked for it within seconds. Kept an hour (a
        // closed laptop, a slow network), never by count alone: one result of a large
        // organisation is several MB, and Redis runs with noeviction — 200 of them filled it.
        removeOnComplete: { age: RESULT_TTL_S, count: 100 },
        removeOnFail: { age: 24 * 3600, count: 50 },
      },
    })

    _vrpQueue.on('error', () => {})
  }
  return _vrpQueue
}

/** The queue is refused beyond this many waiting jobs (each waits one search budget per job ahead). */
const MAX_WAITING = parseInt(process.env.VRP_QUEUE_MAX_WAITING ?? '200', 10) || 200

export class VrpQueueFullError extends Error {
  constructor() {
    super('Le serveur de calcul est saturé. Réessayez dans quelques minutes.')
    this.name = 'VrpQueueFullError'
  }
}

/** Stable fingerprint of what a job computes (key order of the payload is fixed by the route). */
function fingerprint(data: VrpJobData): string {
  return createHash('sha256').update(JSON.stringify([data.missions, data.drivers, data.exutoires, data.existingPlans, data.options])).digest('hex').slice(0, 24)
}

/**
 * Queues an optimisation and returns its job id.
 *
 * Two identical requests for the same organisation and day (double click, two dispatchers at the
 * same moment, a client retry after a timeout) are ONE job: while the first is waiting or
 * running, the second gets the same job id back and both screens follow the same computation.
 * A request with different inputs (a mission was added) is a different job.
 */
export async function enqueueVrpJob(data: VrpJobData, priority?: number): Promise<string> {
  const queue = getVrpQueue()
  const jobName = `vrp:${data.tenantId}:${data.date}`

  const waiting = await withTimeout(queue.getWaitingCount(), REDIS_OP_TIMEOUT_MS, 'read VRP queue depth')
  if (waiting >= MAX_WAITING) throw new VrpQueueFullError()

  const job = await withTimeout(
    queue.add(jobName, data, {
      priority,
      jobId: `${data.tenantId}:${data.date}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deduplication: { id: `${data.tenantId}:${data.date}:${fingerprint(data)}` },
    }),
    REDIS_OP_TIMEOUT_MS,
    'enqueue VRP job',
  )

  if (!job.id) throw new Error('BullMQ did not assign a job ID')
  return job.id
}

/** A worker being restarted is absent for a few seconds: not yet a lost job. */
const ORPHAN_GRACE_MS = 15_000

export async function getVrpJobStatus(jobId: string): Promise<{
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown'
  result?: VrpJobResult
  error?: string
  progress?: number
}> {
  const queue = getVrpQueue()
  const job = await withTimeout(queue.getJob(jobId), REDIS_OP_TIMEOUT_MS, 'read VRP job')

  if (!job) return { status: 'unknown' }

  const state = await withTimeout(job.getState(), REDIS_OP_TIMEOUT_MS, 'read VRP job state')

  if (state === 'completed') {
    return { status: 'completed', result: job.returnvalue }
  }
  if (state === 'failed') {
    return { status: 'failed', error: job.failedReason ?? 'Erreur inconnue' }
  }
  if (state === 'active') {
    // Held by a worker that no longer exists (crash, stop): nothing will finish this job until a
    // worker is back AND its lock has expired. Say so instead of a progress bar frozen for minutes.
    if (
      job.processedOn &&
      Date.now() - job.processedOn > ORPHAN_GRACE_MS &&
      !(await hasActiveVrpWorker())
    ) {
      return {
        status: 'failed',
        error: "Le serveur de calcul s'est arrêté pendant l'optimisation. Relancez-la.",
      }
    }

    const reportedProgress = typeof job.progress === 'number' ? job.progress : 5

    let progress = reportedProgress
    if (job.processedOn) {
      const timeBudget = job.data.options?.timeBudgetMs ?? 30_000
      const elapsed = Date.now() - job.processedOn
      const timeEst = Math.min(92, Math.max(8, Math.round((elapsed / timeBudget) * 87) + 5))
      progress = Math.max(reportedProgress, timeEst)
    }

    return { status: 'active', progress }
  }

  return { status: 'waiting' }
}

/** True when at least one VRP worker is connected — false (not a hang) when Redis is down. */
export async function hasActiveVrpWorker(): Promise<boolean> {
  try {
    const workers = await withTimeout(
      getVrpQueue().getWorkers(),
      REDIS_OP_TIMEOUT_MS,
      'list VRP workers',
    )
    return workers.length > 0
  } catch {
    return false
  }
}
