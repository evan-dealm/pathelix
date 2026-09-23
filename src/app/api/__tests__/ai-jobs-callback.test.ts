import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'node:crypto'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin' })),
}))

const mockAiJobFindFirst  = vi.hoisted(() => vi.fn())
const mockAiJobFindUnique = vi.hoisted(() => vi.fn())
const mockAiJobUpdate     = vi.hoisted(() => vi.fn())
const mockAiJobsCallbackDb = vi.hoisted(() => ({
  aiJob: {
    findFirst:  mockAiJobFindFirst,
    findUnique: mockAiJobFindUnique,
    update:     mockAiJobUpdate,
  },
}))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: mockAiJobsCallbackDb,
  getTenantDb:    () => mockAiJobsCallbackDb,
}))

import { GET } from '@/app/api/ai/jobs/[id]/route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const AI_JOB = { id: 'job-1', tenantId: 't1', type: 'ocr', status: 'pending', outputData: null, errorMsg: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockAiJobFindFirst.mockResolvedValue(AI_JOB)
  mockAiJobFindUnique.mockResolvedValue(AI_JOB)
  mockAiJobUpdate.mockResolvedValue({ ...AI_JOB, status: 'done' })
})

// ─── GET /api/ai/jobs/[id] ────────────────────────────────────────────────────

describe('GET /api/ai/jobs/[id]', () => {
  it('returns 404 when job not found', async () => {
    mockAiJobFindFirst.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost/api/ai/jobs/ghost')
    const res = await GET(req, makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 200 with job data', async () => {
    const req = new NextRequest('http://localhost/api/ai/jobs/job-1')
    const res = await GET(req, makeParams('job-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('job-1')
    expect(body.type).toBe('ocr')
    expect(body.tenantId).toBe('t1')
  })

  it('returns 500 on DB error', async () => {
    mockAiJobFindFirst.mockRejectedValueOnce(new Error('DB crash'))
    const req = new NextRequest('http://localhost/api/ai/jobs/job-1')
    const res = await GET(req, makeParams('job-1'))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/ai/callback (no secret = always 401) ─────────────────────────

describe('POST /api/ai/callback — no secret configured', () => {
  it('returns 401 when AI_CALLBACK_SECRET not set', async () => {
    const { POST } = await import('@/app/api/ai/callback/route')
    const body = JSON.stringify({ jobId: 'job-1', status: 'done' })
    const req = new NextRequest('http://localhost/api/ai/callback', {
      method: 'POST',
      headers: { 'x-ai-signature': 'anysig' },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/ai/callback (with secret) ─────────────────────────────────────

const CB_SECRET = 'test-callback-secret-32chars!!'

function sign(body: string): string {
  return createHmac('sha256', CB_SECRET).update(body).digest('hex')
}

function makeCallback(payload: unknown, secret?: string) {
  const body = JSON.stringify(payload)
  const sig  = secret !== undefined ? secret : sign(body)
  return new NextRequest('http://localhost/api/ai/callback', {
    method:  'POST',
    headers: { 'x-ai-signature': sig },
    body,
  })
}

describe('POST /api/ai/callback — with secret', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('AI_CALLBACK_SECRET', CB_SECRET)
    vi.resetModules()
    vi.mock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.mock('@/lib/tenantDb', () => ({
      unscopedPrisma: mockAiJobsCallbackDb,
      getTenantDb:    () => mockAiJobsCallbackDb,
    }))
    const mod = await import('@/app/api/ai/callback/route')
    POST = mod.POST
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAiJobFindUnique.mockResolvedValue(AI_JOB)
    mockAiJobUpdate.mockResolvedValue({ ...AI_JOB, status: 'done' })
  })

  it('returns 401 on wrong signature', async () => {
    const res = await POST(makeCallback({ jobId: 'job-1', status: 'done' }, 'wrong-sig'))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid JSON (after valid sig)', async () => {
    const body = '{bad json'
    const sig  = sign(body)
    const req = new NextRequest('http://localhost/api/ai/callback', {
      method:  'POST',
      headers: { 'x-ai-signature': sig },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when jobId missing', async () => {
    const res = await POST(makeCallback({ status: 'done' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when status invalid', async () => {
    const res = await POST(makeCallback({ jobId: 'job-1', status: 'running' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when job not found', async () => {
    mockAiJobFindUnique.mockResolvedValueOnce(null)
    const res = await POST(makeCallback({ jobId: 'ghost', status: 'done' }))
    expect(res.status).toBe(404)
  })

  it('returns 200 ignored when job already completed', async () => {
    mockAiJobFindUnique.mockResolvedValueOnce({ ...AI_JOB, status: 'done' })
    const res = await POST(makeCallback({ jobId: 'job-1', status: 'done' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ignored).toBe(true)
    expect(mockAiJobUpdate).not.toHaveBeenCalled()
  })

  it('returns 200 on success update', async () => {
    const res = await POST(makeCallback({ jobId: 'job-1', status: 'done', result: { text: 'Poser benne' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockAiJobUpdate).toHaveBeenCalledOnce()
    expect(mockAiJobUpdate.mock.calls[0][0].data.status).toBe('done')
  })

  it('returns 200 on failed status', async () => {
    const res = await POST(makeCallback({ jobId: 'job-1', status: 'failed', error: 'OCR timed out' }))
    expect(res.status).toBe(200)
    expect(mockAiJobUpdate.mock.calls[0][0].data.status).toBe('failed')
    expect(mockAiJobUpdate.mock.calls[0][0].data.errorMsg).toBe('OCR timed out')
  })

  it('returns 500 on DB error', async () => {
    mockAiJobFindUnique.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeCallback({ jobId: 'job-1', status: 'done' }))
    expect(res.status).toBe(500)
  })
})
