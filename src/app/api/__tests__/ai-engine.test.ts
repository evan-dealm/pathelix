import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

vi.hoisted(() => {
  process.env.USE_MOCK_DATA = 'false'
  process.env.AI_CALLBACK_SECRET = 'test-secret-32-chars-minimum-here'
})

const mockAiJob = vi.hoisted(() => ({
  create:     vi.fn(),
  findUnique: vi.fn(),
  findFirst:  vi.fn(),
  findMany:   vi.fn(),
  update:     vi.fn(),
}))

const mockMission = vi.hoisted(() => ({
  findFirst: vi.fn(),
}))

const mockAiEngineDb = vi.hoisted(() => ({
  aiJob:   mockAiJob,
  mission: mockMission,
}))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: mockAiEngineDb,
  getTenantDb:    () => mockAiEngineDb,
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/rateLimit', () => ({
  createTenantRateLimiter: () => ({
    check:   vi.fn(() => Promise.resolve(true)),
    headers: vi.fn(() => ({})),
  }),
}))

const mockRedisLpush = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(() => Promise.resolve({ lpush: mockRedisLpush, llen: vi.fn(() => Promise.resolve(0)) })),
}))

import { POST as ocrPOST } from '@/app/api/ai/ocr/route'
import { POST as callbackPOST } from '@/app/api/ai/callback/route'
import { GET as jobsGET } from '@/app/api/ai/jobs/route'
import { GET as jobIdGET } from '@/app/api/ai/jobs/[id]/route'
import { getRequestContext } from '@/lib/data/context'

// ── helpers ────────────────────────────────────────────────────────────────

function makeOcrRequest(fileBytes: ArrayBuffer, missionId?: string): NextRequest {
  const form = new FormData()
  form.append('file', new File([fileBytes], 'ticket.jpg', { type: 'image/jpeg' }))
  if (missionId) form.append('missionId', missionId)
  return new NextRequest('http://localhost:3000/api/ai/ocr', { method: 'POST', body: form })
}

function jpegBytes(extra = 0): ArrayBuffer {
  const buf = new ArrayBuffer(10 + extra)
  const view = new Uint8Array(buf)
  view[0] = 0xFF; view[1] = 0xD8; view[2] = 0xFF
  return buf
}

function pngBytes(): ArrayBuffer {
  const buf = new ArrayBuffer(16)
  const view = new Uint8Array(buf)
  view.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  return buf
}

function makeCallbackRequest(body: unknown, secret = 'test-secret-32-chars-minimum-here'): NextRequest {
  const raw = JSON.stringify(body)
  const sig = createHmac('sha256', secret).update(raw).digest('hex')
  return new NextRequest('http://localhost:3000/api/ai/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ai-signature': sig },
    body: raw,
  })
}

function makeJobsRequest(params = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/ai/jobs${params}`)
}

function makeJobIdRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/ai/jobs/${id}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAiJob.create.mockResolvedValue({ id: 'job-1', status: 'pending' })
  mockAiJob.findUnique.mockResolvedValue(null)
  mockAiJob.findFirst.mockResolvedValue(null)
  mockAiJob.findMany.mockResolvedValue([])
  mockAiJob.update.mockResolvedValue({ id: 'job-1', status: 'done' })
  mockMission.findFirst.mockResolvedValue({ id: 'm-1' })
  mockRedisLpush.mockResolvedValue(1)
})

// ─── POST /api/ai/ocr ──────────────────────────────────────────────────────

describe('POST /api/ai/ocr', () => {
  it('accepts valid JPEG → 202 with jobId', async () => {
    const res = await ocrPOST(makeOcrRequest(jpegBytes()))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toHaveProperty('jobId')
    expect(body.status).toBe('pending')
  })

  it('accepts valid PNG', async () => {
    const form = new FormData()
    form.append('file', new File([pngBytes()], 'ticket.png', { type: 'image/png' }))
    const req = new NextRequest('http://localhost:3000/api/ai/ocr', { method: 'POST', body: form })
    const res = await ocrPOST(req)
    expect(res.status).toBe(202)
  })

  it('rejects file with invalid magic bytes → 415', async () => {
    const fakeBuf = new ArrayBuffer(4)
    const view = new Uint8Array(fakeBuf)
    view.set([0x00, 0x01, 0x02, 0x03])
    const res = await ocrPOST(makeOcrRequest(fakeBuf))
    expect(res.status).toBe(415)
  })

  it('rejects file > 5MB → 413', async () => {
    const bigBytes = jpegBytes(5 * 1024 * 1024 + 1)
    const res = await ocrPOST(makeOcrRequest(bigBytes))
    expect(res.status).toBe(413)
  })

  it('IDOR: missionId from different tenant → 404', async () => {
    mockMission.findFirst.mockResolvedValue(null) // not found for this tenant
    const res = await ocrPOST(makeOcrRequest(jpegBytes(), 'other-tenant-mission'))
    expect(res.status).toBe(404)
  })

  it('valid missionId for same tenant → 202', async () => {
    mockMission.findFirst.mockResolvedValue({ id: 'm-1' })
    const res = await ocrPOST(makeOcrRequest(jpegBytes(), 'm-1'))
    expect(res.status).toBe(202)
  })

  it('pushes job to Redis queue', async () => {
    await ocrPOST(makeOcrRequest(jpegBytes()))
    expect(mockRedisLpush).toHaveBeenCalledWith('ai:ocr:queue', expect.any(String))
  })
})

// ─── POST /api/ai/callback ─────────────────────────────────────────────────

describe('POST /api/ai/callback', () => {
  it('rejects invalid HMAC → 401', async () => {
    const body = JSON.stringify({ jobId: 'job-1', status: 'done' })
    const req = new NextRequest('http://localhost:3000/api/ai/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-signature': 'badsig' },
      body,
    })
    const res = await callbackPOST(req)
    expect(res.status).toBe(401)
  })

  it('accepts valid HMAC + updates job status', async () => {
    mockAiJob.findUnique.mockResolvedValue({ id: 'job-1', status: 'processing' })
    const res = await callbackPOST(makeCallbackRequest({ jobId: 'job-1', status: 'done', result: { weight: '42kg' } }))
    expect(res.status).toBe(200)
    expect(mockAiJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'done' }),
    }))
  })

  it('returns 404 for unknown jobId', async () => {
    mockAiJob.findUnique.mockResolvedValue(null)
    const res = await callbackPOST(makeCallbackRequest({ jobId: 'unknown', status: 'done' }))
    expect(res.status).toBe(404)
  })

  it('idempotent: already-done job returns 200 without updating', async () => {
    mockAiJob.findUnique.mockResolvedValue({ id: 'job-1', status: 'done' })
    const res = await callbackPOST(makeCallbackRequest({ jobId: 'job-1', status: 'done' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ignored).toBe(true)
    expect(mockAiJob.update).not.toHaveBeenCalled()
  })

  it('rejects invalid status value → 422', async () => {
    mockAiJob.findUnique.mockResolvedValue({ id: 'job-1', status: 'pending' })
    const res = await callbackPOST(makeCallbackRequest({ jobId: 'job-1', status: 'unknown' }))
    expect(res.status).toBe(422)
  })
})

// ─── GET /api/ai/jobs ──────────────────────────────────────────────────────

describe('GET /api/ai/jobs', () => {
  it('returns jobs for tenant', async () => {
    mockAiJob.findMany.mockResolvedValue([{ id: 'job-1', status: 'done', type: 'ocr' }])
    const res = await jobsGET(makeJobsRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].id).toBe('job-1')
  })

  it('filters by status param', async () => {
    mockAiJob.findMany.mockResolvedValue([])
    await jobsGET(makeJobsRequest('?status=pending'))
    const callWhere = mockAiJob.findMany.mock.calls[0][0].where
    expect(callWhere.status).toBe('pending')
  })

  it('tenant isolation: uses getTenantDb (structural, see tenant-isolation.test.ts)', async () => {
    await jobsGET(makeJobsRequest())
    expect(mockAiJob.findMany).toHaveBeenCalled()
  })
})

// ─── GET /api/ai/jobs/[id] ─────────────────────────────────────────────────

describe('GET /api/ai/jobs/[id]', () => {
  it('returns job when found', async () => {
    mockAiJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'done', type: 'ocr', tenantId: 'tenant-1' })
    const res = await jobIdGET(makeJobIdRequest('job-1'), { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('job-1')
  })

  it('returns 404 when not found', async () => {
    mockAiJob.findFirst.mockResolvedValue(null)
    const res = await jobIdGET(makeJobIdRequest('missing'), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('tenant isolation: uses getTenantDb (structural, see tenant-isolation.test.ts)', async () => {
    mockAiJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'pending' })
    await jobIdGET(makeJobIdRequest('job-1'), { params: Promise.resolve({ id: 'job-1' }) })
    expect(mockAiJob.findFirst).toHaveBeenCalled()
  })

  it('different tenant cannot see job (IDOR)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'other-tenant', userId: 'u', role: 'admin' } as never)
    mockAiJob.findFirst.mockResolvedValue(null)
    const res = await jobIdGET(makeJobIdRequest('job-1'), { params: Promise.resolve({ id: 'job-1' }) })
    expect(res.status).toBe(404)
  })
})
