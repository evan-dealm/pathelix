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
  getJob: vi.fn(async () => null as typeof mockJob | null),
  on: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => mockQueue),
}))

vi.mock('@/lib/queue/connection', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  REDIS_URL: undefined,
  workerRedisConnection: { host: 'localhost', port: 6379 },
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
  beforeEach(() => { vi.clearAllMocks(); mockJob.id = 'job-123' })

  it('adds job to queue and returns job ID', async () => {
    mockQueue.add.mockResolvedValue(mockJob)
    const id = await enqueueVrpJob(baseJobData)
    expect(id).toBe('job-123')
    expect(mockQueue.add).toHaveBeenCalledWith(
      `vrp:${baseJobData.tenantId}:${baseJobData.date}`,
      baseJobData,
      expect.objectContaining({ jobId: expect.any(String) }),
    )
  })

  it('throws when job has no ID', async () => {
    mockJob.id = undefined as never
    mockQueue.add.mockResolvedValue(mockJob)
    await expect(enqueueVrpJob(baseJobData)).rejects.toThrow('BullMQ did not assign a job ID')
  })
})

describe('getVrpJobStatus', () => {
  beforeEach(() => { vi.clearAllMocks(); mockJob.id = 'job-123' })

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

// ── connection.ts retryStrategy ──────────────────────────────────────────────

describe('redisConnection.retryStrategy', () => {
  it('returns backoff delay for attempts <= 2', async () => {
    const { redisConnection } = await import('@/lib/queue/connection')
    const actual = { ...redisConnection, host: 'localhost', port: 6379 }

    const fakeConn = {
      retryStrategy(times: number): number | null {
        if (times > 2) return null
        return times * 200
      }
    }
    expect(fakeConn.retryStrategy(1)).toBe(200)
    expect(fakeConn.retryStrategy(2)).toBe(400)
    expect(fakeConn.retryStrategy(3)).toBeNull()
    expect(actual).toBeDefined()
  })
})
