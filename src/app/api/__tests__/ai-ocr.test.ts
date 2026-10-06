import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockOcrCheck = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/rateLimit', () => ({
  createTenantRateLimiter: vi.fn(() => ({ check: mockOcrCheck })),
  createRateLimiter:       vi.fn(() => ({ check: vi.fn(async () => true) })),
  getClientIp:             vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin' })),
}))

const mockMissionFindFirst = vi.hoisted(() => vi.fn())
const mockAiJobCreate      = vi.hoisted(() => vi.fn())
const mockAiJobUpdate      = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    mission: { findFirst: mockMissionFindFirst },
    aiJob:   { create: mockAiJobCreate, update: mockAiJobUpdate },
  }),
}))

const mockGetRedis = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisClient', () => ({ getRedisClient: mockGetRedis }))
const mockStoreDocument = vi.hoisted(() => vi.fn(async () => ({ id: 'doc-1' })))
vi.mock('@/lib/documents/archive', async (orig) => ({ ...(await orig<typeof import('@/lib/documents/archive')>()), storeDocument: mockStoreDocument }))

import { POST } from '@/app/api/ai/ocr/route'

// JPEG magic bytes
const JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0x01, 0x00, 0x00])
// PNG magic bytes
const PNG_BYTES  = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

function makeOCRReq(file?: Blob | null, missionId?: string) {
  const fd = new FormData()
  if (file !== null) {
    fd.append('file', file ?? new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'photo.jpg')
  }
  if (missionId) fd.append('missionId', missionId)
  return new NextRequest('http://localhost/api/ai/ocr', {
    method: 'POST',
    body: fd,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOcrCheck.mockReset()
  mockOcrCheck.mockResolvedValue(true)
  mockMissionFindFirst.mockResolvedValue({ id: 'm1' })
  mockAiJobCreate.mockResolvedValue({ id: 'job-1', tenantId: 't1' })
  mockGetRedis.mockResolvedValue({ exists: vi.fn().mockResolvedValue(1), llen: vi.fn().mockResolvedValue(0), lpush: vi.fn().mockResolvedValue(1) })
})

describe('POST /api/ai/ocr', () => {
  it('returns 429 when rate limited', async () => {
    mockOcrCheck.mockResolvedValueOnce(false)
    const res = await POST(makeOCRReq())
    expect(res.status).toBe(429)
  })

  it('returns 400 when content-type is not multipart', async () => {
    const req = new NextRequest('http://localhost/api/ai/ocr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/multipart/)
  })

  it('returns 400 when no file field in formData', async () => {
    const fd = new FormData()
    fd.append('missionId', 'm1') // no file
    const req = new NextRequest('http://localhost/api/ai/ocr', {
      method: 'POST',
      body: fd,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Fichier/)
  })

  it('returns 413 when file too large', async () => {
    const hugeFile = new Blob([new Uint8Array(5 * 1024 * 1024 + 100)], { type: 'image/jpeg' })
    const res = await POST(makeOCRReq(hugeFile))
    expect(res.status).toBe(413)
  })

  it('returns 415 when file has invalid magic bytes', async () => {
    const badFile = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])], { type: 'application/octet-stream' })
    const res = await POST(makeOCRReq(badFile))
    expect(res.status).toBe(415)
  })

  it('returns 404 when missionId not in tenant', async () => {
    mockMissionFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makeOCRReq(new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'ghost'))
    expect(res.status).toBe(404)
  })

  it('503 without Redis — never accepted as a job that can only stay pending', async () => {
    mockGetRedis.mockResolvedValueOnce(null)
    const res = await POST(makeOCRReq())
    expect(res.status).toBe(503)
    expect(mockAiJobCreate).not.toHaveBeenCalled()
  })

  it('503 when the queue is full (AI engine down)', async () => {
    mockGetRedis.mockResolvedValueOnce({ exists: vi.fn().mockResolvedValue(1), llen: vi.fn().mockResolvedValue(200), lpush: vi.fn() })
    expect((await POST(makeOCRReq())).status).toBe(503)
    expect(mockAiJobCreate).not.toHaveBeenCalled()
  })

  it('marks the job failed and answers 503 when the push fails', async () => {
    const r = { exists: vi.fn().mockResolvedValue(1), llen: vi.fn().mockResolvedValue(0), lpush: vi.fn().mockRejectedValue(new Error('READONLY')) }
    mockGetRedis.mockResolvedValue(r)
    expect((await POST(makeOCRReq())).status).toBe(503)
    expect(mockAiJobUpdate).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { status: 'failed', errorMsg: 'queue_unavailable' } })
  })

  it('returns 202 with job created', async () => {
    const res = await POST(makeOCRReq())
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe('job-1')
    expect(body.status).toBe('pending')
    expect(mockAiJobCreate).toHaveBeenCalledOnce()
    const createData = mockAiJobCreate.mock.calls[0][0].data
    expect(createData.type).toBe('ocr')
    expect(createData.status).toBe('pending')
  })

  it('returns 202 with PNG file and missionId, pushes to Redis', async () => {
    const mockRedis = { exists: vi.fn().mockResolvedValue(1), llen: vi.fn().mockResolvedValue(0), lpush: vi.fn().mockResolvedValue(1) }
    mockGetRedis.mockResolvedValueOnce(mockRedis)
    const res = await POST(makeOCRReq(new Blob([PNG_BYTES], { type: 'image/png' }), 'm1'))
    expect(res.status).toBe(202)
    expect(mockRedis.lpush).toHaveBeenCalledWith('ai-jobs:pending', expect.any(String))
    // The contract the engine (ai-engine/app/workers/ocr_worker.py) reads.
    const pushed = JSON.parse(mockRedis.lpush.mock.calls[0][1])
    expect(pushed).toMatchObject({ id: 'job-1', type: 'ocr', tenantId: 't1', missionId: 'm1', filename: 'photo.jpg' })
    expect(Buffer.from(pushed.image, 'base64')).toEqual(Buffer.from(PNG_BYTES))
  })

  it('503 without a live engine (no heartbeat): the driver types the weight at once', async () => {
    mockGetRedis.mockResolvedValue({ exists: vi.fn().mockResolvedValue(0), llen: vi.fn(), lpush: vi.fn() })
    const res = await POST(makeOCRReq())
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('OCR_ENGINE_DOWN')
    expect(mockAiJobCreate).not.toHaveBeenCalled()
  })

  it('keeps the ticket photo as evidence for the reviewer', async () => {
    await POST(makeOCRReq(new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'm1'))
    expect(mockStoreDocument).toHaveBeenCalledWith(expect.anything(), 't1', expect.objectContaining({ kind: 'WEIGHING_TICKET', missionId: 'm1', mimeType: 'image/jpeg' }))
    expect(mockAiJobUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { inputData: expect.objectContaining({ documentId: 'doc-1' }) } }))
  })

  it('returns 500 on DB error', async () => {
    mockAiJobCreate.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeOCRReq())
    expect(res.status).toBe(500)
  })
})
