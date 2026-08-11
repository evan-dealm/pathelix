/**
 * Tests for:
 *   POST /api/webhooks/nessy
 *   GET/POST /api/webhooks/obd
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  tenant:  { findUnique: vi.fn() },
  driver:  { findUnique: vi.fn(), upsert: vi.fn() },
  vehicle: { findFirst: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const rlAllowed = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => rlAllowed.value) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/missionQueue', () => ({
  enqueueMission: vi.fn(),
}))

vi.mock('@/services/nessy', () => ({
  verifyNessySignature:  vi.fn(async () => true),
  nessyPayloadToMission: vi.fn((p: unknown) => p),
  NESSY_WEBHOOK_SECRET:  'test-nessy-secret',
  IS_DEV_SECRET:         false,
}))

const mockRedisCache = vi.hoisted(() => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => {}),
}))
vi.mock('@/lib/redisCache', () => ({ redisCache: mockRedisCache }))

vi.mock('@/lib/obdStore', () => ({
  recordOBDReading: vi.fn(),
  pruneOldOBDData:  vi.fn(),
  getOBDPositions:  vi.fn(() => []),
}))

import { POST as nessyPOST }                              from '@/app/api/webhooks/nessy/route'
import { verifyNessySignature, nessyPayloadToMission }   from '@/services/nessy'

function makeNessyPost(body: unknown, signature = 'valid-sig', tenantId = 'tenant-1'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/nessy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nessy-signature': signature,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(body),
  })
}

// ── POST /api/webhooks/nessy ──────────────────────────────────────────────────

describe('POST /api/webhooks/nessy', () => {
  beforeEach(() => { vi.clearAllMocks(); rlAllowed.value = true })

  it('returns 429 when rate limit exceeded — regression: webhook must be rate limited', async () => {
    rlAllowed.value = false
    const res = await nessyPOST(makeNessyPost({ missions: [] }))
    expect(res.status).toBe(429)
  })

  it('processes valid webhook payload (200)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const now = new Date(Date.now() - 30_000).toISOString()
    const res  = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER', address: '14 rue Test' }], sentAt: now }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.received).toBe(1)
  })

  it('returns 401 for invalid signature', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(false)
    const res = await nessyPOST(makeNessyPost({ missions: [] }, 'bad-signature'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when missions field missing', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const res = await nessyPOST(makeNessyPost({ data: 'no missions field' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when x-tenant-id header missing', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    const req = new NextRequest('http://localhost/api/webhooks/nessy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nessy-signature': 'sig' },
      body: JSON.stringify({ missions: [] }),
    })
    const res = await nessyPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when tenant not found', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const res = await nessyPOST(makeNessyPost({ missions: [] }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when batch size exceeds 500', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const missions = Array.from({ length: 501 }, (_, i) => ({ type: 'POSER', address: `${i} rue Test` }))
    const res = await nessyPOST(makeNessyPost({ missions }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when sentAt timestamp is expired (> 5 min ago)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const expiredTs = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const res = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER' }], sentAt: expiredTs }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const req = new NextRequest('http://localhost/api/webhooks/nessy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nessy-signature': 'sig', 'x-tenant-id': 'tenant-1' },
      body: '{bad json',
    })
    // The signature verification passes on raw body but JSON parse will fail after
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    const res = await nessyPOST(req)
    expect([400, 401]).toContain(res.status)
  })

  it('returns 500 on DB error during tenant validation', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const now = new Date(Date.now() - 30_000).toISOString()
    const res = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER' }], sentAt: now }))
    expect(res.status).toBe(500)
  })

  it('returns 400 when sentAt is an invalid date string (NaN sentMs branch)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const res = await nessyPOST(makeNessyPost({
      missions: [{ type: 'POSER', address: '1 rue Test' }],
      sentAt:   'not-a-valid-date',
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/expir|timestamp/i)
  })

  it('skips invalid mission and continues processing — error branch in mission loop', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    vi.mocked(nessyPayloadToMission)
      .mockImplementationOnce(() => { throw new Error('GPS invalide') })
      .mockImplementationOnce((p) => p as ReturnType<typeof nessyPayloadToMission>)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const now = new Date(Date.now() - 30_000).toISOString()
    const res  = await nessyPOST(makeNessyPost({
      missions: [{ type: 'INVALID' }, { type: 'POSER', address: '1 rue Test' }],
      sentAt:   now,
    }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.received).toBe(1)
  })

  it('[SEC] returns 503 in production when IS_DEV_SECRET is true', async () => {
    vi.doMock('@/services/nessy', () => ({
      verifyNessySignature:  vi.fn(async () => true),
      nessyPayloadToMission: vi.fn((p: unknown) => p),
      NESSY_WEBHOOK_SECRET:  'dev-secret-change-me-in-production',
      IS_DEV_SECRET:         true,
    }))
    const env = process.env as Record<string, string | undefined>
    const origNodeEnv = env.NODE_ENV
    env.NODE_ENV = 'production'
    vi.resetModules()
    let POST: typeof nessyPOST
    try {
      const mod = await import('@/app/api/webhooks/nessy/route')
      POST = mod.POST
      const res = await POST(makeNessyPost({ missions: [] }))
      expect(res.status).toBe(503)
    } finally {
      env.NODE_ENV = origNodeEnv
      // Restore the original mock — do NOT vi.doUnmock (that would break subsequent tests)
      vi.doMock('@/services/nessy', () => ({
        verifyNessySignature:  vi.fn(async () => true),
        nessyPayloadToMission: vi.fn((p: unknown) => p),
        NESSY_WEBHOOK_SECRET:  'test-nessy-secret',
        IS_DEV_SECRET:         false,
      }))
      vi.resetModules()
    }
  })

  it('returns 500 when tenant DB throws a non-Error value (String(err) branch)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockRejectedValue('plain string error — not an Error instance')
    const now = new Date(Date.now() - 30_000).toISOString()
    const res = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER' }], sentAt: now }))
    expect(res.status).toBe(500)
  })

  it('handles non-Error thrown from nessyPayloadToMission (String(err) in catch)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    // eslint-disable-next-line no-throw-literal -- teste volontairement le chemin String(err) avec un throw non-Error
    vi.mocked(nessyPayloadToMission).mockImplementationOnce(() => { throw 'not-an-error-object' })
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const now = new Date(Date.now() - 30_000).toISOString()
    const res  = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER' }], sentAt: now }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.received).toBe(0)
  })

  it('[SEC-M2] replayed webhook returns deduplicated response without re-enqueueing', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' })
    const { enqueueMission } = await import('@/lib/missionQueue')
    const now = new Date(Date.now() - 30_000).toISOString()
    const payload = { missions: [{ type: 'POSER', address: '10 rue Test' }], sentAt: now }

    mockRedisCache.get.mockResolvedValue(null)
    const res1 = await nessyPOST(makeNessyPost(payload))
    expect(res1.status).toBe(200)
    const callCountAfterFirst = vi.mocked(enqueueMission).mock.calls.length

    mockRedisCache.get.mockResolvedValue('1' as unknown as null)
    const res2 = await nessyPOST(makeNessyPost(payload))
    const json2 = await res2.json()
    expect(res2.status).toBe(200)
    expect(json2.deduplicated).toBe(true)
    expect(vi.mocked(enqueueMission).mock.calls.length).toBe(callCountAfterFirst)
  })
})
