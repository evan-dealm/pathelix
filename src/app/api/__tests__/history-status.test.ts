/**
 * Tests for:
 *   GET/POST /api/history    (uses globalThis.__historyMock in mock mode)
 *   DELETE   /api/history/[id]
 *   GET      /api/status
 *   GET/POST /api/driver-status
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  tourHistory: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  driver:      { findUnique: vi.fn() },
  $queryRaw:   vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(async () => null),
}))

vi.mock('@/lib/session', () => ({
  verifySession:  vi.fn(),
  SESSION_COOKIE: 'session',
}))

vi.mock('@/lib/statusStore', () => {
  const store = new Map<string, Record<string, string>>()
  return {
    _statusStore:          store,
    pruneOldStatusEntries: vi.fn(),
    getStatusFromStore: vi.fn(async (tenantId: string, driverId: string, date: string) => {
      const key = `${encodeURIComponent(tenantId)}|${encodeURIComponent(driverId)}|${date}`
      return store.get(key) ?? {}
    }),
    getAllStatusesForDate: vi.fn(async (tenantId: string, date: string) => {
      const result: Record<string, Record<string, string>> = {}
      const encodedTenant = encodeURIComponent(tenantId)
      for (const [key, statuses] of store.entries()) {
        const [kTenant, kDriver, kDate] = key.split('|')
        if (kDate === date && kTenant === encodedTenant && kDriver) {
          result[decodeURIComponent(kDriver)] = statuses
        }
      }
      return result
    }),
    setStatusInStore: vi.fn(async (tenantId: string, driverId: string, date: string, statuses: Record<string, string>) => {
      const key = `${encodeURIComponent(tenantId)}|${encodeURIComponent(driverId)}|${date}`
      store.set(key, statuses)
    }),
  }
})

// History uses mock mode (process.env.USE_MOCK_DATA !== 'false')
// At module load time this is evaluated, so we keep mock mode ON (default)
// by NOT setting USE_MOCK_DATA = 'false'

import { GET as historyGET, POST as historyPOST } from '@/app/api/history/route'
import { DELETE as historyDEL }                    from '@/app/api/history/[id]/route'
import { GET as statusGET }                        from '@/app/api/status/route'
import { GET as driverStatusGET }                  from '@/app/api/driver-status/route'
import { _statusStore }                            from '@/lib/statusStore'
import { getTenantId }                             from '@/lib/data/context'
import { verifySession }                           from '@/lib/session'

function makeGet(url: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, { headers })
}
function makeGetAuth(url: string): NextRequest {
  return new NextRequest(url, { headers: { Cookie: 'session=test-token' } })
}
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

// Reset the global mock history between tests
function clearMockHistory() {
  if (globalThis.__historyMock) {
    (globalThis.__historyMock as unknown[]).length = 0
  }
}

// ── GET /api/history (mock mode) ──────────────────────────────────────────────

describe('GET /api/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearMockHistory()
    // Ensure mock mode is ON (default)
    delete process.env.USE_MOCK_DATA
  })

  it('returns empty list when no history (200)', async () => {
    const res  = await historyGET(makeGet('http://localhost/api/history', { 'x-tenant-id': 'tenant-1' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(0)
  })

  it('returns 404 for unknown id in mock mode', async () => {
    const res = await historyGET(makeGet('http://localhost/api/history?id=missing', { 'x-tenant-id': 'tenant-1' }))
    expect(res.status).toBe(404)
  })

  it('returns history list with items after POST', async () => {
    // First POST to add an entry
    await historyPOST(new NextRequest('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ date: '2026-05-15', label: 'Tour 1', snapshot: [] }),
    }))

    const res  = await historyGET(makeGet('http://localhost/api/history', { 'x-tenant-id': 'tenant-1' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.length).toBeGreaterThan(0)
  })

  it('GET with id returns single entry from mock store', async () => {
    // POST first
    const postRes = await historyPOST(new NextRequest('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ date: '2026-05-15', label: 'Tour 2', snapshot: [1, 2, 3] }),
    }))
    const posted = await postRes.json()

    const res  = await historyGET(makeGet(`http://localhost/api/history?id=${posted.id}`, { 'x-tenant-id': 'tenant-1' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.id).toBe(posted.id)
    expect(Array.isArray(json.snapshot)).toBe(true)
  })
})

// ── POST /api/history (mock mode) ─────────────────────────────────────────────

describe('POST /api/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearMockHistory()
    delete process.env.USE_MOCK_DATA
  })

  it('creates history entry (201)', async () => {
    const res  = await historyPOST(new NextRequest('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ date: '2026-05-15', label: 'Tour', snapshot: [] }),
    }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.id).toBeDefined()
    expect(json.date).toBe('2026-05-15')
  })

  it('returns 400 when date missing', async () => {
    const res = await historyPOST(makePost('http://localhost/api/history', { snapshot: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid date format', async () => {
    const res = await historyPOST(makePost('http://localhost/api/history', { date: 'not-a-date', snapshot: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid calendar date (2026-02-30)', async () => {
    const res = await historyPOST(makePost('http://localhost/api/history', { date: '2026-02-30', snapshot: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await historyPOST(req)
    expect(res.status).toBe(400)
  })
})

// ── DELETE /api/history/[id] (mock mode) ──────────────────────────────────────

describe('DELETE /api/history/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearMockHistory()
    delete process.env.USE_MOCK_DATA
  })

  it('deletes history entry and returns ok (200)', async () => {
    // First create an entry
    const postRes = await historyPOST(new NextRequest('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ date: '2026-05-15', label: 'Tour', snapshot: [] }),
    }))
    const posted = await postRes.json()

    const req = new NextRequest(`http://localhost/api/history/${posted.id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': 'tenant-1' },
    })
    const res  = await historyDEL(req, makeParams(posted.id))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 404 when entry not found in tenant', async () => {
    const req = new NextRequest('http://localhost/api/history/missing', {
      method: 'DELETE',
      headers: { 'x-tenant-id': 'tenant-1' },
    })
    const res = await historyDEL(req, makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('cross-tenant: cannot delete entry from another tenant', async () => {
    // Create entry for tenant-1
    const postRes = await historyPOST(new NextRequest('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-1' },
      body: JSON.stringify({ date: '2026-05-15', label: 'Tour', snapshot: [] }),
    }))
    const posted = await postRes.json()

    // Delete attempt from tenant-2 — override getTenantId to simulate different tenant
    vi.mocked(getTenantId).mockReturnValueOnce('tenant-2')
    const req = new NextRequest(`http://localhost/api/history/${posted.id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': 'tenant-2' },
    })
    const res = await historyDEL(req, makeParams(posted.id))
    expect(res.status).toBe(404)
  })
})

// ── GET /api/status ───────────────────────────────────────────────────────────

describe('GET /api/status', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns status object with services array (200)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ 1: 1 }])
    const res  = await statusGET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(typeof json.status).toBe('string')
    expect(Array.isArray(json.services)).toBe(true)
    expect(json.sla).toBeDefined()
    expect(json.timestamp).toBeDefined()
  })

  it('includes no-cache header', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ 1: 1 }])
    const res = await statusGET()
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
  })

  it('returns outage status when DB unavailable', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'))
    const res  = await statusGET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.status).toBe('outage')
    const dbService = json.services.find((s: { name: string }) => s.name.includes('Database'))
    expect(dbService?.status).toBe('outage')
  })
})

// ── GET /api/driver-status ────────────────────────────────────────────────────

const MOCK_SESSION = { sub: 'user-1', role: 'admin' as const, tenantId: 'tenant-1', iat: 0, exp: 9999999999 }

describe('GET /api/driver-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(_statusStore as Map<string, unknown>).clear()
    vi.mocked(verifySession).mockResolvedValue(MOCK_SESSION)
  })

  it('returns 400 when date param missing', async () => {
    const res = await driverStatusGET(makeGet('http://localhost/api/driver-status', { 'x-tenant-id': 'tenant-1' }))
    expect(res.status).toBe(400)
  })

  it('returns empty status map when no statuses set (200)', async () => {
    const res  = await driverStatusGET(makeGetAuth('http://localhost/api/driver-status?date=2026-05-15'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(typeof json).toBe('object')
  })

  it('returns driver-specific status from store when driverId param given', async () => {
    const tenantKey = encodeURIComponent('tenant-1')
    const driverKey = encodeURIComponent('driver-1')
    _statusStore.set(`${tenantKey}|${driverKey}|2026-05-15`, { 'mission-1': 'done' })

    const res  = await driverStatusGET(makeGetAuth('http://localhost/api/driver-status?date=2026-05-15&driverId=driver-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json['driver-1']).toBeDefined()
    expect(json['driver-1']['mission-1']).toBe('done')
  })

  it('returns full status map (200) when no driverId param', async () => {
    const res  = await driverStatusGET(makeGetAuth('http://localhost/api/driver-status?date=2026-05-15'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(typeof json).toBe('object')
  })
})
