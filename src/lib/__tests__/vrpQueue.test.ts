import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockJob = vi.hoisted(() => ({
  id: 'job-123',
  data: { options: { timeBudgetMs: 10_000 } },
  returnvalue: null as unknown,
  failedReason: null as string | null,
  progress: 0 as number | object,
  processedOn: null as number | null,
  getState: vi.fn(async () => 'waiting' as 'waiting' | 'active' | 'completed' | 'failed'),
}))

const mockQueue = vi.hoisted(() => ({
  add: vi.fn(async () => mockJob),
  // Queue depth is read before every enqueue (VRP_QUEUE_MAX_WAITING).
  getWaitingCount: vi.fn(async () => 0),
  getJob: vi.fn(async () => null as typeof mockJob | null),
  on: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => mockQueue),
}))

vi.mock('@/lib/queue/connection', async orig => ({
  ...(await orig<typeof import('@/lib/queue/connection')>()),
  queueConnectionOptions: () => ({ host: 'localhost', port: 6379 }),
}))

import { getVrpQueue, enqueueVrpJob, getVrpJobStatus, VRP_QUEUE_NAME } from '@/lib/queue/vrpQueue'

const baseJobData = {
  tenantId: 'tenant-1',
  date: '2026-06-15',
  missions: [],
  drivers: [],
  exutoires: [],
  existingPlans: {},
  options: { timeBudgetMs: 5_000 } as never,
}

import { Queue } from 'bullmq'

describe('getVrpQueue', () => {
  it('creates queue with correct name', () => {
    const q = getVrpQueue()
    expect(q).toBe(mockQueue)
    expect(vi.mocked(Queue)).toHaveBeenCalledWith(VRP_QUEUE_NAME, expect.any(Object))
  })

  it('returns cached queue on second call', () => {
    const callCount = vi.mocked(Queue).mock.calls.length
    getVrpQueue()
    getVrpQueue()
    expect(vi.mocked(Queue).mock.calls.length).toBe(callCount)
  })
})

describe('enqueueVrpJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJob.id = 'job-123'
  })

  it('adds job to queue and returns job ID', async () => {
    mockQueue.add.mockResolvedValue(mockJob)
    const id = await enqueueVrpJob(baseJobData)
    expect(id).toBe('job-123')
    expect(mockQueue.add).toHaveBeenCalledWith(
      `vrp:${baseJobData.tenantId}:${baseJobData.date}`,
      baseJobData,
      expect.objectContaining({
        jobId: expect.any(String),
        deduplication: { id: expect.stringContaining('tenant-1:2026-06-15:') },
      }),
    )
  })

  it('refuses a new job when the queue is full', async () => {
    mockQueue.getWaitingCount.mockResolvedValueOnce(10_000)
    await expect(enqueueVrpJob(baseJobData)).rejects.toThrow('saturé')
    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('throws when job has no ID', async () => {
    mockJob.id = undefined as never
    mockQueue.add.mockResolvedValue(mockJob)
    await expect(enqueueVrpJob(baseJobData)).rejects.toThrow('BullMQ did not assign a job ID')
  })
})

describe('getVrpJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJob.id = 'job-123'
  })

  it('returns unknown when job not found', async () => {
    mockQueue.getJob.mockResolvedValue(null)
    const status = await getVrpJobStatus('missing-id')
    expect(status.status).toBe('unknown')
  })

  it('returns waiting status', async () => {
    mockQueue.getJob.mockResolvedValue(mockJob)
    mockJob.getState.mockResolvedValue('waiting')
    const status = await getVrpJobStatus('job-123')
    expect(status.status).toBe('waiting')
  })

  it('returns completed status with result', async () => {
    const result = { assignments: {}, stats: {} as never, warnings: [] }
    mockJob.returnvalue = result
    mockJob.getState.mockResolvedValue('completed')
    mockQueue.getJob.mockResolvedValue(mockJob)
    const status = await getVrpJobStatus('job-123')
    expect(status.status).toBe('completed')
    expect(status.result).toBe(result)
  })

  it('returns failed status with reason', async () => {
    mockJob.failedReason = 'Out of memory'
    mockJob.getState.mockResolvedValue('failed')
    mockQueue.getJob.mockResolvedValue(mockJob)
    const status = await getVrpJobStatus('job-123')
    expect(status.status).toBe('failed')
    expect(status.error).toBe('Out of memory')
  })

  it('returns active status with time-based progress', async () => {
    mockJob.getState.mockResolvedValue('active')
    mockJob.progress = 5
    mockJob.processedOn = Date.now() - 2_000
    mockJob.data = { options: { timeBudgetMs: 10_000 } } as never
    mockQueue.getJob.mockResolvedValue(mockJob)
    const status = await getVrpJobStatus('job-123')
    expect(status.status).toBe('active')
    expect(status.progress).toBeGreaterThanOrEqual(5)
  })

  it('returns active with no processedOn uses reported progress', async () => {
    mockJob.getState.mockResolvedValue('active')
    mockJob.progress = 42
    mockJob.processedOn = null
    mockQueue.getJob.mockResolvedValue(mockJob)
    const status = await getVrpJobStatus('job-123')
    expect(status.status).toBe('active')
    expect(status.progress).toBe(42)
  })
})

describe('getVrpJobStatus — job orphaned by a dead worker', () => {
  const setWorkers = (workers: unknown[]) => {
    ;(mockQueue as unknown as { getWorkers: unknown }).getWorkers = vi
      .fn()
      .mockResolvedValue(workers)
  }

  it('reports the failure when the job is active but no worker is left to finish it', async () => {
    // The progress bar used to stay frozen at 92 % for ten minutes.
    const { getVrpJobStatus } = await import('@/lib/queue/vrpQueue')
    mockJob.getState.mockResolvedValue('active')
    mockJob.processedOn = Date.now() - 40_000
    mockQueue.getJob.mockResolvedValue(mockJob)
    setWorkers([])
    const status = await getVrpJobStatus('job-123')
    expect(status.status).toBe('failed')
    expect(status.error).toMatch(/serveur de calcul s'est arrêté/i)
  })

  it('keeps waiting while a worker is connected, and during the first seconds of a job', async () => {
    const { getVrpJobStatus } = await import('@/lib/queue/vrpQueue')
    mockJob.getState.mockResolvedValue('active')
    mockQueue.getJob.mockResolvedValue(mockJob)
    mockJob.processedOn = Date.now() - 40_000
    setWorkers([{ id: 'w1' }])
    expect((await getVrpJobStatus('job-123')).status).toBe('active')
    mockJob.processedOn = Date.now() - 3_000
    setWorkers([])
    expect((await getVrpJobStatus('job-123')).status).toBe('active')
  })
})

describe('hasActiveVrpWorker', () => {
  it('reports no worker (instead of hanging) when listing workers fails or stalls', async () => {
    const { hasActiveVrpWorker } = await import('@/lib/queue/vrpQueue')
    ;(mockQueue as unknown as { getWorkers: unknown }).getWorkers = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection is closed.'))
    expect(await hasActiveVrpWorker()).toBe(false)
    ;(mockQueue as unknown as { getWorkers: unknown }).getWorkers = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'w1' }])
    expect(await hasActiveVrpWorker()).toBe(true)
  })
})
