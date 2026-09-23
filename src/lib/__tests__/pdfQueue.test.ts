import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockJob = vi.hoisted(() => ({
  id:                 'pdf-job-123',
  waitUntilFinished:  vi.fn(async () => ({ base64: Buffer.from('%PDF-fake').toString('base64') })),
}))

const mockQueue = vi.hoisted(() => ({
  add: vi.fn(async () => mockJob),
  on:  vi.fn(),
}))

const mockQueueEvents = vi.hoisted(() => ({
  on: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue:       vi.fn().mockImplementation(() => mockQueue),
  QueueEvents: vi.fn().mockImplementation(() => mockQueueEvents),
}))

vi.mock('@/lib/queue/connection', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  REDIS_URL: undefined,
}))

import { getPdfQueue, generatePdfViaWorker, PDF_QUEUE_NAME, type PdfJobData } from '@/lib/queue/pdfQueue'
import { Queue } from 'bullmq'

const TOUR_JOB: PdfJobData = {
  kind: 'tour',
  tenantId: 'tenant-1',
  props: {} as never,
}

describe('getPdfQueue', () => {
  it('creates the queue once, with the expected name', () => {
    const q1 = getPdfQueue()
    const q2 = getPdfQueue()
    expect(q1).toBe(mockQueue)
    expect(q2).toBe(mockQueue)
    expect(vi.mocked(Queue)).toHaveBeenCalledWith(PDF_QUEUE_NAME, expect.any(Object))
    expect(vi.mocked(Queue).mock.calls.length).toBe(1)
  })
})

describe('generatePdfViaWorker', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('enqueues the job and decodes the base64 result into a Buffer', async () => {
    mockJob.waitUntilFinished.mockResolvedValueOnce({ base64: Buffer.from('%PDF-tour-content').toString('base64') })
    const buf = await generatePdfViaWorker(TOUR_JOB)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.toString()).toBe('%PDF-tour-content')
  })

  it("names the job by kind so the queue dashboard can tell tour and report jobs apart", async () => {
    await generatePdfViaWorker(TOUR_JOB)
    expect(mockQueue.add).toHaveBeenCalledWith('tour', TOUR_JOB, expect.objectContaining({ jobId: expect.any(String) }))
  })

  it('passes waitUntilFinished the shared QueueEvents instance and the given timeout', async () => {
    await generatePdfViaWorker(TOUR_JOB, 5_000)
    expect(mockJob.waitUntilFinished).toHaveBeenCalledWith(mockQueueEvents, 5_000)
  })

  it('defaults the timeout to 20s when not specified', async () => {
    await generatePdfViaWorker(TOUR_JOB)
    expect(mockJob.waitUntilFinished).toHaveBeenCalledWith(mockQueueEvents, 20_000)
  })

  it('propagates a timeout/connection error to the caller (route turns this into a 503)', async () => {
    mockJob.waitUntilFinished.mockRejectedValueOnce(new Error('Job did not complete within timeout'))
    await expect(generatePdfViaWorker(TOUR_JOB)).rejects.toThrow('Job did not complete within timeout')
  })
})
