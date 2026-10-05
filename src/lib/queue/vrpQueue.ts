import { Queue, type ConnectionOptions } from 'bullmq'
import type { Mission, Driver, Exutoire, OptimizationResult } from '@/lib/types'
import type { OptimizeOptions } from '@/lib/vrp/types'
import { queueConnectionOptions, withTimeout } from './connection'

/** Bound on any Redis round-trip made while serving an HTTP request. */
const REDIS_OP_TIMEOUT_MS = 3_000

export interface VrpJobData {
  tenantId:      string
  date:          string
  missions:      Mission[]
  drivers:       Driver[]
  exutoires:     Exutoire[]
  existingPlans: Record<string, string[]>
  options:       OptimizeOptions
}

export type VrpJobResult = OptimizationResult

export const VRP_QUEUE_NAME = 'vrp-optimization'

let _vrpQueue: Queue<VrpJobData, VrpJobResult> | null = null

export function getVrpQueue(): Queue<VrpJobData, VrpJobResult> {
  if (!_vrpQueue) {
    _vrpQueue = new Queue<VrpJobData, VrpJobResult>(VRP_QUEUE_NAME, {
      connection:         queueConnectionOptions() as ConnectionOptions,
      defaultJobOptions:  {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 50  },
      },
    })

    _vrpQueue.on('error', () => {})
  }
  return _vrpQueue
}

export async function enqueueVrpJob(
  data:     VrpJobData,
  priority?: number,
): Promise<string> {
  const queue  = getVrpQueue()
  const jobName = `vrp:${data.tenantId}:${data.date}`

  const job = await withTimeout(queue.add(jobName, data, {
    priority,
    jobId: `${data.tenantId}:${data.date}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }), REDIS_OP_TIMEOUT_MS, 'enqueue VRP job')

  if (!job.id) throw new Error('BullMQ did not assign a job ID')
  return job.id
}

export async function getVrpJobStatus(jobId: string): Promise<{
  status:   'waiting' | 'active' | 'completed' | 'failed' | 'unknown'
  result?:  VrpJobResult
  error?:   string
  progress?: number
}> {
  const queue = getVrpQueue()
  const job   = await withTimeout(queue.getJob(jobId), REDIS_OP_TIMEOUT_MS, 'read VRP job')

  if (!job) return { status: 'unknown' }

  const state = await withTimeout(job.getState(), REDIS_OP_TIMEOUT_MS, 'read VRP job state')

  if (state === 'completed') {
    return { status: 'completed', result: job.returnvalue }
  }
  if (state === 'failed') {
    return { status: 'failed', error: job.failedReason ?? 'Erreur inconnue' }
  }
  if (state === 'active') {
    const reportedProgress = typeof job.progress === 'number' ? job.progress : 5

    let progress = reportedProgress
    if (job.processedOn) {
      const timeBudget = job.data.options?.timeBudgetMs ?? 30_000
      const elapsed    = Date.now() - job.processedOn
      const timeEst    = Math.min(92, Math.max(8, Math.round((elapsed / timeBudget) * 87) + 5))
      progress = Math.max(reportedProgress, timeEst)
    }

    return { status: 'active', progress }
  }

  return { status: 'waiting' }
}

/** True when at least one VRP worker is connected — false (not a hang) when Redis is down. */
export async function hasActiveVrpWorker(): Promise<boolean> {
  try {
    const workers = await withTimeout(getVrpQueue().getWorkers(), REDIS_OP_TIMEOUT_MS, 'list VRP workers')
    return workers.length > 0
  } catch {
    return false
  }
}
