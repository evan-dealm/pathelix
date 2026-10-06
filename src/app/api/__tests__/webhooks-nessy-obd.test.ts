/**
 * Tests for:
 *   POST /api/webhooks/nessy
 *   GET/POST /api/webhooks/obd
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  integration: { findMany: vi.fn() },
  driver:      { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  vehicle:     { findFirst: vi.fn() },
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


// Missions are recorded straight away (no in-memory queue any more).
const createMission = vi.hoisted(() => vi.fn(async () => ({ id: 'm-new' })))
const missionFindFirst = vi.hoisted(() => vi.fn(async () => null as null | { id: string }))
vi.mock('@/lib/data/missions', () => ({ createMission }))
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => ({ mission: { findFirst: missionFindFirst } }) }))

vi.mock('@/services/nessy', () => ({
  verifyNessySignature:  vi.fn(async () => true),
  nessyPayloadToMission: vi.fn((p: unknown) => p),
}))

const mockRedisCache = vi.hoisted(() => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}))
vi.mock('@/lib/redisCache', () => ({ redisCache: mockRedisCache }))

vi.mock('@/lib/obdStore', () => ({
  recordOBDReading: vi.fn(),
  pruneOldOBDData:  vi.fn(),
  getOBDPositions:  vi.fn(() => []),
}))

import { POST as nessyPOST }                            from '@/app/api/webhooks/nessy/route'
import { verifyNessySignature, nessyPayloadToMission }   from '@/services/nessy'

function makeNessyPost(body: unknown, signature = 'valid-sig'): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/nessy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nessy-signature': signature,
    },
    body: JSON.stringify(body),
  })
}

const NESSY_INTEGRATION = { tenantId: 'tenant-1', config: { webhookSecret: 'tenant-1-secret' } }

// ── POST /api/webhooks/nessy ──────────────────────────────────────────────────

describe('POST /api/webhooks/nessy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rlAllowed.value = true
    mockPrisma.integration.findMany.mockResolvedValue([NESSY_INTEGRATION])
  })

  it('returns 429 when rate limit exceeded — regression: webhook must be rate limited', async () => {
    rlAllowed.value = false
    const res = await nessyPOST(makeNessyPost({ missions: [] }))
    expect(res.status).toBe(429)
  })

  it('processes valid webhook payload (200)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
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
    const res = await nessyPOST(makeNessyPost({ data: 'no missions field' }))
    expect(res.status).toBe(400)
  })

  // Regression M12/A1: tenant is resolved by matching the request signature against each
  // enabled Nessy integration's OWN secret — a client can no longer just assert x-tenant-id.
  it('returns 401 when no configured integration secret verifies the signature', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([NESSY_INTEGRATION])
    vi.mocked(verifyNessySignature).mockResolvedValue(false)
    const res = await nessyPOST(makeNessyPost({ missions: [] }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when no tenant has a Nessy integration configured at all', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([])
    const res = await nessyPOST(makeNessyPost({ missions: [] }))
    expect(res.status).toBe(401)
  })

  it('resolves the correct tenant among several configured Nessy integrations', async () => {
    const integrations = [
      { tenantId: 'tenant-a', config: { webhookSecret: 'secret-a' } },
      { tenantId: 'tenant-b', config: { webhookSecret: 'secret-b' } },
    ]
    mockPrisma.integration.findMany.mockResolvedValue(integrations)
    // Only tenant-b's secret verifies this particular request
    vi.mocked(verifyNessySignature).mockImplementation(async (_body, _sig, secret) => secret === 'secret-b')

    const now = new Date(Date.now() - 30_000).toISOString()
    const res  = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER', address: '1 rue Test' }], sentAt: now }))
    expect(res.status).toBe(200)

    expect(createMission).toHaveBeenCalledWith('tenant-b', expect.anything())
  })

  it('skips a tenant whose config fails to decrypt and still matches a later valid integration', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-broken', config: { v: 1, iv: 'ab', tag: 'cd', data: 'ef' } },
      { tenantId: 'tenant-1',      config: { webhookSecret: 'tenant-1-secret' } },
    ])
    vi.mocked(verifyNessySignature).mockImplementation(async (_body, _sig, secret) => secret === 'tenant-1-secret')

    const now = new Date(Date.now() - 30_000).toISOString()
    const res = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER', address: '1 rue Test' }], sentAt: now }))
    // tenant-broken's config isn't a valid encrypted shape without INTEGRATION_ENCRYPTION_KEY
    // configured in this test env, so decryptConfig passes it through as-is (no webhookSecret
    // field) — verifyNessySignature is called with an empty secret and returns false for it,
    // then tenant-1 is tried and matches. Not a crash either way.
    expect(res.status).not.toBe(500)
    expect(res.status).toBe(200)
  })

  it('returns 400 when batch size exceeds 500', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    const missions = Array.from({ length: 501 }, (_, i) => ({ type: 'POSER', address: `${i} rue Test` }))
    const res = await nessyPOST(makeNessyPost({ missions }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when sentAt timestamp is expired (> 5 min ago)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    const expiredTs = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const res = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER' }], sentAt: expiredTs }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    const req = new NextRequest('http://localhost/api/webhooks/nessy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nessy-signature': 'sig' },
      body: '{bad json',
    })
    const res = await nessyPOST(req)
    expect([400, 401]).toContain(res.status)
  })

  it('returns 400 when sentAt is an invalid date string (NaN sentMs branch)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
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
    const now = new Date(Date.now() - 30_000).toISOString()
    const res  = await nessyPOST(makeNessyPost({
      missions: [{ type: 'INVALID' }, { type: 'POSER', address: '1 rue Test' }],
      sentAt:   now,
    }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.received).toBe(1)
  })

  it('handles non-Error thrown from nessyPayloadToMission (String(err) in catch)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    // eslint-disable-next-line no-throw-literal -- teste volontairement le chemin String(err) avec un throw non-Error
    vi.mocked(nessyPayloadToMission).mockImplementationOnce(() => { throw 'not-an-error-object' })
    const now = new Date(Date.now() - 30_000).toISOString()
    const res  = await nessyPOST(makeNessyPost({ missions: [{ type: 'POSER' }], sentAt: now }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.received).toBe(0)
  })

  it('[SEC-M2] replayed webhook returns deduplicated response without re-enqueueing', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    const now = new Date(Date.now() - 30_000).toISOString()
    const payload = { missions: [{ type: 'POSER', address: '10 rue Test' }], sentAt: now }

    mockRedisCache.get.mockResolvedValue(null)
    const res1 = await nessyPOST(makeNessyPost(payload))
    expect(res1.status).toBe(200)
    const callCountAfterFirst = createMission.mock.calls.length

    mockRedisCache.get.mockResolvedValue('1' as unknown as null)
    const res2 = await nessyPOST(makeNessyPost(payload))
    const json2 = await res2.json()
    expect(res2.status).toBe(200)
    expect(json2.deduplicated).toBe(true)
    expect(createMission.mock.calls.length).toBe(callCountAfterFirst)
  })

  it('records a re-sent mission only once (same Nessy id)', async () => {
    vi.mocked(verifyNessySignature).mockResolvedValue(true)
    mockRedisCache.get.mockResolvedValue(null)
    const now = new Date(Date.now() - 30_000).toISOString()
    createMission.mockClear()
    missionFindFirst.mockResolvedValueOnce({ id: 'already' })
    const res = await nessyPOST(makeNessyPost({ missions: [{ id: 'N-1', type: 'POSER', address: '3 rue Test' }], sentAt: now }))
    expect(await res.json()).toMatchObject({ received: 0, duplicates: 1 })
    expect(createMission).not.toHaveBeenCalled()
  })
})
