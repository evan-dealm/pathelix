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
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    mission: { findFirst: mockMissionFindFirst },
    aiJob:   { create: mockAiJobCreate },
  }),
}))

const mockGetRedis = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisClient', () => ({ getRedisClient: mockGetRedis }))

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
  mockGetRedis.mockResolvedValue(null)
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

  it('returns 202 with job created (no redis)', async () => {
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
    const mockRedis = { lpush: vi.fn().mockResolvedValue(1) }
    mockGetRedis.mockResolvedValueOnce(mockRedis)
    const res = await POST(makeOCRReq(new Blob([PNG_BYTES], { type: 'image/png' }), 'm1'))
    expect(res.status).toBe(202)
    expect(mockRedis.lpush).toHaveBeenCalledWith('ai:ocr:queue', expect.any(String))
    const pushed = JSON.parse(mockRedis.lpush.mock.calls[0][1])
    expect(pushed.missionId).toBe('m1')
    expect(pushed.tenantId).toBe('t1')
  })

  it('returns 500 on DB error', async () => {
    mockAiJobCreate.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeOCRReq())
    expect(res.status).toBe(500)
  })
})
