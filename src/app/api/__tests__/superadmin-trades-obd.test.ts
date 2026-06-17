import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'sa1', role: 'superadmin' })),
}))

// OBD deps
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: vi.fn(() => ({
    check:   vi.fn(async () => true),
    headers: vi.fn(() => ({})),
  })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
const mockRecordOBD = vi.hoisted(() => vi.fn())
const mockPruneOBD  = vi.hoisted(() => vi.fn())
vi.mock('@/lib/obdStore', () => ({
  recordOBDReading: mockRecordOBD,
  pruneOldOBDData:  mockPruneOBD,
}))

// Trades deps
const mockTradeUpdate     = vi.hoisted(() => vi.fn())
const mockTradeFindUnique = vi.hoisted(() => vi.fn())
const mockTenantCount     = vi.hoisted(() => vi.fn())
const mockTradeDelete     = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    customTrade: {
      update:     mockTradeUpdate,
      findUnique: mockTradeFindUnique,
      delete:     mockTradeDelete,
    },
    tenant: { count: mockTenantCount },
  },
}))

import { PUT, DELETE } from '@/app/api/superadmin/trades/[id]/route'
import { POST as obdPOST } from '@/app/api/webhooks/obd/route'
import { getRequestContext } from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makePUT(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/superadmin/trades/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDELETE(id: string) {
  return new NextRequest(`http://localhost/api/superadmin/trades/${id}`, { method: 'DELETE' })
}

function makeOBD(body: unknown, token = 'secret-obd-token') {
  return new NextRequest('http://localhost/api/webhooks/obd', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'sa1', role: 'superadmin', requestId: 'req-123', trade: null })
})

// ─── PUT /api/superadmin/trades/[id] ─────────────────────────────────────────

describe('PUT /api/superadmin/trades/[id]', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await PUT(makePUT('trade-1', { tradeName: 'BTP' }), makeParams('trade-1'))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid payload (enabledMissionTypes empty array)', async () => {
    const res = await PUT(makePUT('trade-1', { enabledMissionTypes: [] }), makeParams('trade-1'))
    expect(res.status).toBe(422)
  })

  it('returns 200 when trade updated successfully', async () => {
    mockTradeUpdate.mockResolvedValueOnce({ id: 'trade-1', tradeName: 'BTP Modifié' })
    const res = await PUT(makePUT('trade-1', { tradeName: 'BTP Modifié' }), makeParams('trade-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tradeName).toBe('BTP Modifié')
  })

  it('returns 404 when trade not found', async () => {
    mockTradeUpdate.mockRejectedValueOnce(new Error('Record to update not found'))
    const res = await PUT(makePUT('ghost', { tradeName: 'X' }), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on other DB error', async () => {
    mockTradeUpdate.mockRejectedValueOnce(new Error('Connection lost'))
    const res = await PUT(makePUT('trade-1', { tradeName: 'X' }), makeParams('trade-1'))
    expect(res.status).toBe(500)
  })
})

// ─── DELETE /api/superadmin/trades/[id] ──────────────────────────────────────

describe('DELETE /api/superadmin/trades/[id]', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await DELETE(makeDELETE('trade-1'), makeParams('trade-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when trade not found', async () => {
    mockTradeFindUnique.mockResolvedValueOnce(null)
    const res = await DELETE(makeDELETE('ghost'), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when trade is still used by tenants', async () => {
    mockTradeFindUnique.mockResolvedValueOnce({ tradeKey: 'BTP' })
    mockTenantCount.mockResolvedValueOnce(3)
    const res = await DELETE(makeDELETE('trade-1'), makeParams('trade-1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/3 tenant/)
  })

  it('returns 200 when trade deleted successfully', async () => {
    mockTradeFindUnique.mockResolvedValueOnce({ tradeKey: 'BTP' })
    mockTenantCount.mockResolvedValueOnce(0)
    mockTradeDelete.mockResolvedValueOnce({})
    const res = await DELETE(makeDELETE('trade-1'), makeParams('trade-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 500 on DB error', async () => {
    mockTradeFindUnique.mockRejectedValueOnce(new Error('DB timeout'))
    const res = await DELETE(makeDELETE('trade-1'), makeParams('trade-1'))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/webhooks/obd ───────────────────────────────────────────────────

describe('POST /api/webhooks/obd', () => {
  it('returns 503 when OBD_WEBHOOK_TOKEN not configured', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', '')
    const res = await obdPOST(makeOBD({ driverId: 'd1', lat: 48.85, lng: 2.35, speedKmh: 50 }, ''))
    expect(res.status).toBe(503)
  })

  it('returns 401 when Bearer token is wrong', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    const res = await obdPOST(makeOBD({ driverId: 'd1', lat: 48.85, lng: 2.35, speedKmh: 50 }, 'wrong'))
    expect(res.status).toBe(401)
  })

  it('returns 422 on invalid payload (lat out of range)', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    const res = await obdPOST(makeOBD({ driverId: 'd1', lat: 200, lng: 2.35, speedKmh: 50 }))
    expect(res.status).toBe(422)
  })

  it('records single OBD reading and returns 200', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    const res = await obdPOST(makeOBD({ driverId: 'd1', lat: 48.85, lng: 2.35, speedKmh: 45, ignition: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.count).toBe(1)
    expect(mockRecordOBD).toHaveBeenCalledOnce()
    expect(mockRecordOBD.mock.calls[0][0].driverId).toBe('d1')
  })

  it('records batch OBD readings', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    const batch = [
      { driverId: 'd1', lat: 48.85, lng: 2.35, speedKmh: 50 },
      { driverId: 'd2', lat: 48.86, lng: 2.36, speedKmh: 30 },
      { driverId: 'd3', lat: 48.87, lng: 2.37, speedKmh: 0  },
    ]
    const res = await obdPOST(makeOBD(batch))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(3)
    expect(mockRecordOBD).toHaveBeenCalledTimes(3)
  })
})

describe('POST /api/webhooks/obd — additional branches', () => {
  afterEach(() => {
    // Restore default rate limiter mock after any doMock overrides
    vi.doMock('@/lib/rateLimit', () => ({
      createRateLimiter: vi.fn(() => ({ check: vi.fn(async () => true), headers: vi.fn(() => ({})) })),
      getClientIp: vi.fn(() => '127.0.0.1'),
    }))
    vi.resetModules()
  })

  it('returns 429 when rate limiter rejects request', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    vi.doMock('@/lib/rateLimit', () => ({
      createRateLimiter: () => ({ check: vi.fn(async () => false) }),
      getClientIp: vi.fn(() => '127.0.0.1'),
    }))
    vi.resetModules()
    const { POST: freshPost } = await import('@/app/api/webhooks/obd/route')
    const res = await freshPost(makeOBD({ driverId: 'd1', lat: 48.85, lng: 2.35, speedKmh: 50 }))
    expect(res.status).toBe(429)
  })

  it('returns 400 when body is invalid JSON (catch branch)', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    vi.resetModules()
    const { POST: freshPost } = await import('@/app/api/webhooks/obd/route')
    const req = new NextRequest('http://localhost/api/webhooks/obd', {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-obd-token' },
      body:    '{not-valid-json',
    })
    const res = await freshPost(req)
    expect(res.status).toBe(400)
  })

  it('records reading with explicit timestamp (r.timestamp ?? now — truthy branch)', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    vi.resetModules()
    const { POST: freshPost } = await import('@/app/api/webhooks/obd/route')
    const ts = 1_700_000_000
    const res = await freshPost(makeOBD({ driverId: 'd5', lat: 48.85, lng: 2.35, speedKmh: 60, timestamp: ts }))
    expect(res.status).toBe(200)
    expect(mockRecordOBD).toHaveBeenCalledWith(expect.objectContaining({ timestamp: ts }))
  })

  it('calls pruneOldOBDData after 500 readings (_pruneCounter branch)', async () => {
    vi.stubEnv('OBD_WEBHOOK_TOKEN', 'secret-obd-token')
    vi.resetModules()
    const { POST: freshPost } = await import('@/app/api/webhooks/obd/route')
    const reading = { driverId: 'd1', lat: 48.85, lng: 2.35, speedKmh: 50 }
    for (let i = 0; i < 500; i++) {
      await freshPost(makeOBD(reading))
    }
    expect(mockPruneOBD).toHaveBeenCalledOnce()
  })
})
