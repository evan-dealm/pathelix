/**
 * Tests for:
 *   GET/POST/DELETE /api/push/subscribe
 *   POST            /api/push/notify
 *   GET             /api/predictions
 *   GET/POST        /api/routing
 *   GET             /api/reports/co2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  pushSubscription: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  plan:             { findMany: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/webPush', () => ({
  VAPID_PUBLIC_KEY:       'BTest1234',
  sendPushNotification:   vi.fn(async () => true),
}))

vi.mock('@/lib/demandPrediction', () => ({
  predictDemand: vi.fn(async () => [{ date: '2026-05-16', predicted: 5 }]),
}))

vi.mock('@/services/trimble', () => ({
  calcRoute: vi.fn(async () => ({ distanceKm: 10, durationMin: 15, geometry: null })),
}))

import {
  GET as pushSubGET, POST as pushSubPOST, DELETE as pushSubDEL,
} from '@/app/api/push/subscribe/route'
import { POST as pushNotifyPOST }   from '@/app/api/push/notify/route'
import { GET as predictionsGET }    from '@/app/api/predictions/route'
import { GET as routingGET, POST as routingPOST } from '@/app/api/routing/route'
import { GET as co2GET }            from '@/app/api/reports/co2/route'
import { getRequestContext }        from '@/lib/data/context'
import { sendPushNotification }     from '@/lib/webPush'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeDelete(url: string): NextRequest { return new NextRequest(url, { method: 'DELETE' }) }

// ── GET /api/push/subscribe (VAPID public key) ────────────────────────────────

describe('GET /api/push/subscribe', () => {
  it('returns VAPID public key (200)', async () => {
    const res  = await pushSubGET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.publicKey).toBe('BTest1234')
  })
})

// ── POST /api/push/subscribe ──────────────────────────────────────────────────

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'driver', requestId: 'req-1', trade: null })
  })

  it('saves subscription and returns ok (200)', async () => {
    mockPrisma.pushSubscription.upsert.mockResolvedValue({})
    const res  = await pushSubPOST(makePost('http://localhost/api/push/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 422 for missing endpoint', async () => {
    const res = await pushSubPOST(makePost('http://localhost/api/push/subscribe', {
      keys: { p256dh: 'key1', auth: 'auth1' },
    }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid endpoint URL', async () => {
    const res = await pushSubPOST(makePost('http://localhost/api/push/subscribe', {
      endpoint: 'not-a-url',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await pushSubPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.pushSubscription.upsert.mockRejectedValue(new Error('DB fail'))
    const res = await pushSubPOST(makePost('http://localhost/api/push/subscribe', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'key1', auth: 'auth1' },
    }))
    expect(res.status).toBe(500)
  })
})

// ── DELETE /api/push/subscribe ────────────────────────────────────────────────

describe('DELETE /api/push/subscribe', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes subscription and returns ok (200)', async () => {
    mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })
    const res  = await pushSubDEL(makeDelete('http://localhost/api/push/subscribe?endpoint=https://fcm.example.com/test'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 400 when endpoint param missing', async () => {
    const res = await pushSubDEL(makeDelete('http://localhost/api/push/subscribe'))
    expect(res.status).toBe(400)
  })
})

// ── POST /api/push/notify ─────────────────────────────────────────────────────

describe('POST /api/push/notify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('sends push to all subscribers and returns sent count (200)', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      { endpoint: 'https://fcm.test/1', p256dh: 'k1', auth: 'a1' },
      { endpoint: 'https://fcm.test/2', p256dh: 'k2', auth: 'a2' },
    ])
    vi.mocked(sendPushNotification).mockResolvedValue(true)
    const res  = await pushNotifyPOST(makePost('http://localhost/api/push/notify', { title: 'Hello', body: 'Test' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.sent).toBe(2)
  })

  it('returns sent: 0 when no subscribers', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([])
    const res  = await pushNotifyPOST(makePost('http://localhost/api/push/notify', { title: 'Hello', body: 'Test' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.sent).toBe(0)
  })

  it('deletes expired subscriptions when push fails', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      { endpoint: 'https://fcm.test/expired', p256dh: 'k1', auth: 'a1' },
    ])
    mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })
    vi.mocked(sendPushNotification).mockResolvedValue(false)
    const res  = await pushNotifyPOST(makePost('http://localhost/api/push/notify', { title: 'Hello', body: 'Test' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.failed).toBe(1)
    expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalled()
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null })
    const res = await pushNotifyPOST(makePost('http://localhost/api/push/notify', { title: 'Hello', body: 'Test' }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for missing title', async () => {
    const res = await pushNotifyPOST(makePost('http://localhost/api/push/notify', { body: 'Test' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/push/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await pushNotifyPOST(req)
    expect(res.status).toBe(400)
  })
})

// ── GET /api/predictions ──────────────────────────────────────────────────────

describe('GET /api/predictions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns demand predictions (200)', async () => {
    const res  = await predictionsGET(makeGet('http://localhost/api/predictions'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json.predictions)).toBe(true)
  })

  it('respects days param (clamped to 1-30)', async () => {
    const { predictDemand } = await import('@/lib/demandPrediction')
    vi.mocked(predictDemand).mockResolvedValue([])
    await predictionsGET(makeGet('http://localhost/api/predictions?days=100'))
    expect(vi.mocked(predictDemand)).toHaveBeenCalledWith('tenant-1', 30)
  })

  it('defaults to 7 days when no param', async () => {
    const { predictDemand } = await import('@/lib/demandPrediction')
    vi.mocked(predictDemand).mockResolvedValue([])
    await predictionsGET(makeGet('http://localhost/api/predictions'))
    expect(vi.mocked(predictDemand)).toHaveBeenCalledWith('tenant-1', 7)
  })
})

// ── GET /api/routing ──────────────────────────────────────────────────────────

describe('GET /api/routing', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns route data for valid coords (200)', async () => {
    const res  = await routingGET(makeGet('http://localhost/api/routing?from=45.75,4.85&to=45.76,4.86'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.distanceKm).toBeDefined()
  })

  it('returns 400 when from param missing', async () => {
    const res = await routingGET(makeGet('http://localhost/api/routing?to=45.76,4.86'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when to param missing', async () => {
    const res = await routingGET(makeGet('http://localhost/api/routing?from=45.75,4.85'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-numeric coords', async () => {
    const res = await routingGET(makeGet('http://localhost/api/routing?from=lat,lng&to=45.76,4.86'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for out-of-range coords', async () => {
    const res = await routingGET(makeGet('http://localhost/api/routing?from=95.0,4.85&to=45.76,4.86'))
    expect(res.status).toBe(400)
  })
})

// ── POST /api/routing ─────────────────────────────────────────────────────────

describe('POST /api/routing', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns route from waypoints (200)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 10000, duration: 900, geometry: { type: 'LineString', coordinates: [] } }],
      }),
    })))
    const res = await routingPOST(makePost('http://localhost/api/routing', {
      waypoints: [[4.85, 45.75], [4.86, 45.76]],
    }))
    expect(res.status).toBe(200)
    vi.unstubAllGlobals()
  })

  it('returns route from from/to objects (200)', async () => {
    const res  = await routingPOST(makePost('http://localhost/api/routing', {
      from: { lat: 45.75, lng: 4.85 },
      to:   { lat: 45.76, lng: 4.86 },
    }))
    expect(res.status).toBe(200)
  })

  it('returns 400 for missing required fields', async () => {
    const res = await routingPOST(makePost('http://localhost/api/routing', { invalid: true }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/routing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await routingPOST(req)
    expect(res.status).toBe(400)
  })
})

// ── GET /api/reports/co2 ──────────────────────────────────────────────────────

// co2 route: USE_MOCK frozen at module load time (true in test env)
// Tests only cover mock-mode behaviour
describe('GET /api/reports/co2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('returns CO2 report with totalKm, totalCO2Kg, byDriver (200)', async () => {
    const res  = await co2GET(makeGet('http://localhost/api/reports/co2'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.totalKm).toBeDefined()
    expect(json.totalCO2Kg).toBeDefined()
    expect(Array.isArray(json.byDriver)).toBe(true)
  })

  it('returns mock data with zero values', async () => {
    const res  = await co2GET(makeGet('http://localhost/api/reports/co2'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.totalKm).toBe(0)
    expect(json.byDriver).toHaveLength(0)
  })
})
