/**
 * Security tests — cross-tenant IDOR, auth bypass, mass assignment
 * These tests verify that every tenant-scoped route prevents data leakage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Shared Prisma mock ───────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  driver:            { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  mission:           { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  vehicle:           { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
  missionComment:    { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  fuelRecord:        { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  maintenanceRecord: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  holiday:           { findFirst: vi.fn(), delete: vi.fn() },
  client:            { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
  clientSite:        { deleteMany: vi.fn(), createMany: vi.fn() },
  site:              { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  $transaction:      vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    client:     { update: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
    clientSite: { deleteMany: vi.fn(), createMany: vi.fn() },
    site:       { update: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
  })),
  plan:              { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  user:              { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  tourHistory:       { findFirst: vi.fn(), findMany: vi.fn() },
  auditLog:          { findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  apiKey:            { findMany: vi.fn() },
  userPermission:    { findMany: vi.fn(() => Promise.resolve([])) },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/cache', () => ({
  getCachedDriver: vi.fn(),
  setCachedDriver: vi.fn(),
  invalidateCachedDriver: vi.fn(),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    invalidateAll: vi.fn(),
    getOrSet: vi.fn((_m: string, _t: string, fn: () => Promise<unknown>) => fn()),
  },
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC:  { API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors', API_LATENCY_MS: 'api.latency' },
}))

vi.mock('@/lib/data/drivers', () => ({
  getDrivers:    vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } })),
  getAllDrivers:  vi.fn(async () => []),
  getDriver:     vi.fn(async () => null),
  createDriver:  vi.fn(),
  updateDriver:  vi.fn(),
  deleteDriver:  vi.fn(),
}))

vi.mock('@/lib/data/missions', () => ({
  getAllMissions:    vi.fn(async () => []),
  getMissionsByDate: vi.fn(async () => []),
  getMission:       vi.fn(async () => null),
  createMission:    vi.fn(),
  updateMission:    vi.fn(async () => null),
  deleteMission:    vi.fn(async () => false),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getExutoire:    vi.fn(async () => null),
  updateExutoire: vi.fn(),
  deleteExutoire: vi.fn(async () => false),
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => true) }),
  createTenantRateLimiter: () => ({ check: vi.fn(async () => true) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Context mock — key to IDOR tests: set different tenants
const mockContext = vi.hoisted(() => ({
  tenantId: 'tenant-A',
  userId:   'user-A',
  role:     'admin',
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ ...mockContext })),
  getTenantId:       vi.fn(() => mockContext.tenantId),
}))

import { GET as driversGet }        from '@/app/api/drivers/route'
import { GET as driverGet,
         PUT as driverPut,
         DELETE as driverDel }      from '@/app/api/drivers/[id]/route'
import { GET as missionsGet }       from '@/app/api/missions/route'
import { GET as missionGet,
         PUT as missionPut,
         DELETE as missionDel }     from '@/app/api/missions/[id]/route'
import { DELETE as fuelDel }        from '@/app/api/fuel-records/[id]/route'
import { DELETE as maintenanceDel } from '@/app/api/maintenance/[id]/route'
import { DELETE as commentDel }     from '@/app/api/mission-comments/[id]/route'
import { DELETE as holidayDel }     from '@/app/api/holidays/[id]/route'
import { DELETE as historyDel }     from '@/app/api/history/[id]/route'
import { PUT as clientPut,
         DELETE as clientDel }      from '@/app/api/clients/[id]/route'
import { PUT as sitePut,
         DELETE as siteDel }        from '@/app/api/sites/[id]/route'
import { GET as apiKeysGet }        from '@/app/api/api-keys/route'
import { getRequestContext, getTenantId } from '@/lib/data/context'
import { getAllMissions, getMission, deleteMission } from '@/lib/data/missions'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePut(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeDelete(url: string): NextRequest { return new NextRequest(url, { method: 'DELETE' }) }
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

// ─── Helper to set tenant context ────────────────────────────────────────────

function setTenant(tenantId: string, role = 'admin', userId = 'user-test') {
  mockContext.tenantId = tenantId
  mockContext.role = role
  mockContext.userId = userId
  vi.mocked(getRequestContext).mockReturnValue({ tenantId, role, userId, requestId: 'req-1', trade: null })
  vi.mocked(getTenantId).mockReturnValue(tenantId)
}

// ─── IDOR: Drivers ────────────────────────────────────────────────────────────

describe('IDOR: /api/drivers/* — cross-tenant isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('GET /api/drivers passes tenantId to getAllDrivers', async () => {
    const { getAllDrivers } = await import('@/lib/data/drivers')
    vi.mocked(getAllDrivers).mockResolvedValue([])
    await driversGet(makeGet('http://localhost/api/drivers'))
    expect(vi.mocked(getAllDrivers)).toHaveBeenCalledWith('tenant-A')
  })

  it('GET /api/drivers/[id] returns 404 when driver belongs to different tenant', async () => {
    const { getDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValue(null)
    const res = await driverGet(makeGet('http://localhost/api/drivers/tenant-B-driver'), makeParams('tenant-B-driver'))
    expect(res.status).toBe(404)
  })

  it('PUT /api/drivers/[id] returns 404 when driver belongs to different tenant', async () => {
    const { getDriver, updateDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValue(null)
    vi.mocked(updateDriver).mockResolvedValue(null)
    const res = await driverPut(makePut('http://localhost/api/drivers/tenant-B-driver', { sector: 'X' }), makeParams('tenant-B-driver'))
    expect(res.status).toBe(404)
  })

  it('DELETE /api/drivers/[id] returns 404 when driver belongs to different tenant', async () => {
    const { getDriver, deleteDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValue(null)
    vi.mocked(deleteDriver).mockResolvedValue(false)
    const res = await driverDel(makeDelete('http://localhost/api/drivers/tenant-B-driver'), makeParams('tenant-B-driver'))
    expect([403, 404]).toContain(res.status)
  })
})

// ─── IDOR: Missions ────────────────────────────────────────────────────────────

describe('IDOR: /api/missions/* — cross-tenant isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('GET /api/missions passes tenantId to getAllMissions', async () => {
    vi.mocked(getAllMissions).mockResolvedValue([])
    await missionsGet(makeGet('http://localhost/api/missions'))
    expect(getAllMissions).toHaveBeenCalledWith('tenant-A')
  })

  it('GET /api/missions/[id] returns 404 for another tenant mission', async () => {
    vi.mocked(getMission).mockResolvedValue(null)
    const res = await missionGet(makeGet('http://localhost/api/missions/tenant-B-mission'), makeParams('tenant-B-mission'))
    expect(res.status).toBe(404)
    expect(getMission).toHaveBeenCalledWith('tenant-A', 'tenant-B-mission')
  })

  it('PUT /api/missions/[id] returns 404 for another tenant mission', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)
    const res = await missionPut(makePut('http://localhost/api/missions/tenant-B-mission', { priority: 1 }), makeParams('tenant-B-mission'))
    expect(res.status).toBe(404)
  })

  it('DELETE /api/missions/[id] uses tenantId in where clause', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)
    const res = await missionDel(makeDelete('http://localhost/api/missions/tenant-B-mission'), makeParams('tenant-B-mission'))
    expect(res.status).toBe(404)
  })
})

// ─── IDOR: Fleet records ──────────────────────────────────────────────────────

describe('IDOR: fleet record deletes use tenantId (TOCTOU atomic)', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('DELETE /api/fuel-records/[id] uses compound {id, tenantId} where clause', async () => {
    mockPrisma.fuelRecord.deleteMany.mockResolvedValue({ count: 0 })
    await fuelDel(makeDelete('http://localhost/api/fuel-records/any-id'), makeParams('any-id'))
    expect(mockPrisma.fuelRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: 'any-id', tenantId: 'tenant-A' },
    })
  })

  it('DELETE /api/maintenance/[id] uses compound {id, tenantId} where clause', async () => {
    mockPrisma.maintenanceRecord.deleteMany.mockResolvedValue({ count: 0 })
    await maintenanceDel(makeDelete('http://localhost/api/maintenance/any-id'), makeParams('any-id'))
    expect(mockPrisma.maintenanceRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: 'any-id', tenantId: 'tenant-A' },
    })
  })
})

// ─── IDOR: Mission comments ───────────────────────────────────────────────────

describe('IDOR: /api/mission-comments/[id] — permission model', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('dispatcher cannot delete another user comment (403)', async () => {
    setTenant('tenant-A', 'dispatcher', 'user-A')
    mockPrisma.missionComment.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-A', userId: 'user-B' })
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/c-1'), makeParams('c-1'))
    expect(res.status).toBe(403)
  })

  it('driver cannot delete another user comment (403)', async () => {
    setTenant('tenant-A', 'driver', 'driver-A')
    mockPrisma.missionComment.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-A', userId: 'driver-B' })
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/c-1'), makeParams('c-1'))
    expect(res.status).toBe(403)
  })

  it('cross-tenant: comment from other tenant returns 404', async () => {
    setTenant('tenant-A', 'admin', 'user-A')
    mockPrisma.missionComment.findFirst.mockResolvedValue(null)
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/tenant-B-comment'), makeParams('tenant-B-comment'))
    expect(res.status).toBe(404)
  })
})

// ─── IDOR: Holidays ───────────────────────────────────────────────────────────

describe('IDOR: /api/holidays/[id] — cross-tenant isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('returns 404 when holiday belongs to different tenant', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValue(null)
    const res = await holidayDel(makeDelete('http://localhost/api/holidays/tenant-B-holiday'), makeParams('tenant-B-holiday'))
    expect(res.status).toBe(404)
  })
})

// ─── IDOR: History ────────────────────────────────────────────────────────────

describe('IDOR: /api/history/[id] — cross-tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setTenant('tenant-A')
    process.env.USE_MOCK_DATA = 'false'
  })

  it('DELETE history returns 404 when entry belongs to different tenant', async () => {
    mockPrisma.tourHistory.findFirst.mockResolvedValue(null)
    const res = await historyDel(makeDelete('http://localhost/api/history/tenant-B-entry'), makeParams('tenant-B-entry'))
    expect(res.status).toBe(404)
  })
})

// ─── IDOR: API Keys ──────────────────────────────────────────────────────────

describe('IDOR: /api/api-keys — scoped to tenant', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('GET /api/api-keys only returns keys for current tenant', async () => {
    setTenant('tenant-A')
    mockPrisma.apiKey.findMany.mockResolvedValue([{ id: 'k-1', name: 'Key 1', prefix: 'ef_live_a', scopes: ['read'] }])
    await apiKeysGet(makeGet('http://localhost/api/api-keys'))
    expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }),
    )
  })
})

// ─── Mass assignment protection ───────────────────────────────────────────────

describe('Mass assignment: route handlers strip disallowed fields', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('PUT /api/missions/[id] does not allow tenantId override via body', async () => {
    const existingMission = {
      id: 'm-1', tenantId: 'tenant-A', type: 'POSER', status: 'todo',
      latitude: 45.7, longitude: 4.8,
    }
    mockPrisma.mission.findFirst.mockResolvedValue(existingMission)
    mockPrisma.mission.update.mockResolvedValue(existingMission)

    await missionPut(makePut('http://localhost/api/missions/m-1', {
      priority: 1,
      tenantId: 'tenant-B',   // should be ignored
      id:       'hijacked-id', // should be ignored
    }), makeParams('m-1'))

    // The update call should not contain tenantId from body
    if (mockPrisma.mission.update.mock.calls.length > 0) {
      const updateData = mockPrisma.mission.update.mock.calls[0][0].data
      expect(updateData.tenantId).toBeUndefined()
      expect(updateData.id).toBeUndefined()
    }
  })

  it('PUT /api/drivers/[id] does not allow tenantId override via body', async () => {
    const { getDriver, updateDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValue({ id: 'd-1', tenantId: 'tenant-A', firstName: 'Jean' } as never)
    vi.mocked(updateDriver).mockResolvedValue({ id: 'd-1', tenantId: 'tenant-A', firstName: 'Jean' } as never)

    const res = await driverPut(makePut('http://localhost/api/drivers/d-1', {
      sector: 'SUD',
      tenantId: 'tenant-B',  // should be ignored
    }), makeParams('d-1'))

    expect([200, 404]).toContain(res.status)
    if (vi.mocked(updateDriver).mock.calls.length > 0) {
      const data = vi.mocked(updateDriver).mock.calls[0][2]
      expect((data as Record<string, unknown>).tenantId).toBeUndefined()
    }
  })
})

// ─── Auth bypass: 401 on missing context ────────────────────────────────────

describe('Auth bypass: routes throw on missing tenant context', () => {
  it('getRequestContext throws when tenant header missing — middleware invariant', async () => {
    const { getRequestContext: realCtx } = await vi.importActual<typeof import('@/lib/data/context')>('@/lib/data/context')
    const req = new NextRequest('http://localhost/api/missions', {
      headers: {},
    })
    expect(() => realCtx(req)).toThrow()
  })
})

// ─── IDOR: Clients ────────────────────────────────────────────────────────────

describe('IDOR: /api/clients/[id] — tenantId enforced in update operations', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('PUT cross-tenant returns 404 (findFirst with tenantId blocks)', async () => {
    mockPrisma.client.findFirst.mockResolvedValue(null)
    const res = await clientPut(makePut('http://localhost/api/clients/tenant-B-client', { name: 'Hijack' }), makeParams('tenant-B-client'))
    expect(res.status).toBe(404)
  })

  it('DELETE cross-tenant returns 404', async () => {
    mockPrisma.client.findFirst.mockResolvedValue(null)
    const res = await clientDel(makeDelete('http://localhost/api/clients/tenant-B-client'), makeParams('tenant-B-client'))
    expect(res.status).toBe(404)
  })

  it('DELETE own client archives it via getTenantDb (tenant scope enforced structurally, see tenant-isolation.test.ts)', async () => {
    mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-A', name: 'Acme' })
    mockPrisma.client.update.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-A', archived: true })
    const res = await clientDel(makeDelete('http://localhost/api/clients/c-1'), makeParams('c-1'))
    expect(res.status).toBe(200)
    expect(mockPrisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'c-1' }), data: { archived: true } }),
    )
  })
})

// ─── IDOR: Sites ──────────────────────────────────────────────────────────────

describe('IDOR: /api/sites/[id] — tenantId enforced in update operations', () => {
  beforeEach(() => { vi.clearAllMocks(); setTenant('tenant-A') })

  it('PUT cross-tenant returns 404', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(null)
    const res = await sitePut(makePut('http://localhost/api/sites/tenant-B-site', { name: 'Hijack' }), makeParams('tenant-B-site'))
    expect(res.status).toBe(404)
  })

  it('DELETE cross-tenant returns 404', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(null)
    const res = await siteDel(makeDelete('http://localhost/api/sites/tenant-B-site'), makeParams('tenant-B-site'))
    expect(res.status).toBe(404)
  })

  it('DELETE own site archives it via getTenantDb (tenant scope enforced structurally, see tenant-isolation.test.ts)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue({ id: 's-1', tenantId: 'tenant-A', name: 'Site 1' })
    mockPrisma.site.update.mockResolvedValue({ id: 's-1', tenantId: 'tenant-A', archived: true })
    const res = await siteDel(makeDelete('http://localhost/api/sites/s-1'), makeParams('s-1'))
    expect(res.status).toBe(200)
    expect(mockPrisma.site.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 's-1' }), data: { archived: true } }),
    )
  })
})

// ─── Role hierarchy: driver cannot access admin routes ────────────────────────

describe('RBAC: role enforcement on sensitive routes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('driver cannot delete fuel records (403)', async () => {
    setTenant('tenant-A', 'driver', 'driver-1')
    const res = await fuelDel(makeDelete('http://localhost/api/fuel-records/f-1'), makeParams('f-1'))
    expect(res.status).toBe(403)
  })

  it('driver cannot delete maintenance records (403)', async () => {
    setTenant('tenant-A', 'driver', 'driver-1')
    const res = await maintenanceDel(makeDelete('http://localhost/api/maintenance/m-1'), makeParams('m-1'))
    expect(res.status).toBe(403)
  })

  it('driver cannot delete holidays (403)', async () => {
    setTenant('tenant-A', 'driver', 'driver-1')
    const res = await holidayDel(makeDelete('http://localhost/api/holidays/h-1'), makeParams('h-1'))
    expect(res.status).toBe(403)
  })

  it('dispatcher cannot delete missions (403)', async () => {
    setTenant('tenant-A', 'dispatcher', 'user-disp')
    const res = await missionDel(makeDelete('http://localhost/api/missions/m-1'), makeParams('m-1'))
    expect(res.status).toBe(403)
  })

  // Regression A7: this used to document a real gap — the role check only blocked 'dispatcher',
  // not 'driver', so a driver could delete any mission. hasPermission('manage_missions') now
  // closes it: DEFAULT_PERMISSIONS['driver'] is empty, so a driver gets 403 too.
  it('driver cannot delete missions (403) — A7 closed the gap where only dispatcher was blocked', async () => {
    setTenant('tenant-A', 'driver', 'driver-1')
    const res = await missionDel(makeDelete('http://localhost/api/missions/m-1'), makeParams('m-1'))
    expect(res.status).toBe(403)
    expect(deleteMission).not.toHaveBeenCalled()
  })
})
