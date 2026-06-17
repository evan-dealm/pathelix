/**
 * Tests for cache TTL values, cross-namespace invalidation, and mission pagination.
 * Each section is isolated via vi.mock at file scope — imports must be dynamic (after mocks are set up).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Shared cache mock ────────────────────────────────────────────────────────

const mockCache = vi.hoisted(() => ({
  getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
  invalidate:    vi.fn(),
  invalidateAll: vi.fn(),
  get:           vi.fn(async () => null),
  set:           vi.fn(),
}))
vi.mock('@/lib/redisCache', () => ({ redisCache: mockCache }))

// ─── Shared infrastructure mocks ─────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC:  { API_LATENCY_MS: 'latency', API_REQUESTS: 'req', API_ERRORS: 'err' },
}))
vi.mock('@/lib/audit', () => ({ auditAsync: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  createTenantRateLimiter: () => ({ check: vi.fn(async () => true) }),
}))
vi.mock('@/lib/missionQueue', () => ({ peekQueue: vi.fn(() => []) }))

// ─── Context mock (shared) ────────────────────────────────────────────────────

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-1'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'u1', role: 'admin' })),
}))

// ─── Session mock (for driver-list) ──────────────────────────────────────────

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession:  vi.fn(async () => ({ tenantId: 'tenant-1', role: 'admin', sub: 'u1' })),
}))

// ─── Data layer mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(async () => []),
  createDriver: vi.fn(async () => ({ id: 'drv-1', firstName: 'Jean', lastName: 'Dupont', sector: 'Nord' })),
  getDriver:    vi.fn(async () => ({ id: 'drv-1', firstName: 'Jean', lastName: 'Dupont', sector: 'Nord' })),
  updateDriver: vi.fn(async () => ({ id: 'drv-1', firstName: 'Marie', lastName: 'Dupont', sector: 'Nord' })),
  deleteDriver: vi.fn(async () => true),
}))

vi.mock('@/lib/data/missions', () => ({
  getAllMissions:     vi.fn(async () =>
    Array.from({ length: 200 }, (_, i) => ({ id: `m-${i}`, type: 'POSER', date: '2026-05-18', archived: false })),
  ),
  getMissionsByDate: vi.fn(async () => []),
  createMission:     vi.fn(async () => ({ id: 'new-m', type: 'POSER', date: '2026-05-18' })),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(async () => []),
  createExutoire: vi.fn(async () => ({ id: 'ex-1', name: 'Centre de tri', lat: 45.0, lng: 4.8 })),
}))

// ─── Schemas mock ─────────────────────────────────────────────────────────────

vi.mock('@/lib/schemas', () => ({
  DriverSchema:         { partial: () => ({ safeParse: vi.fn(() => ({ success: true, data: { firstName: 'Marie' } })) }),
                          safeParse: vi.fn(() => ({ success: true, data: { firstName: 'Jean', lastName: 'Dupont', sector: 'Nord', depotName: 'D', depotLat: 45.0, depotLng: 4.8, vehicleCapacity: 15, weeklyHoursMax: 48 } })) },
  MissionSchema:        { safeParse: vi.fn(() => ({ success: true, data: { type: 'POSER', date: '2026-05-18', address: '1 Rue Test', latitude: 45.0, longitude: 4.8 } })) },
  HolidaySchema:        { safeParse: vi.fn(() => ({ success: true, data: { date: '2026-05-01', name: 'Fête du Travail' } })) },
  TenantSettingsSchema: { safeParse: vi.fn(() => ({ success: true, data: { valhallaFactor: 1.6 } })) },
}))

// ─── Prisma mock (all models used across test sections) ──────────────────────

const mockPrisma = vi.hoisted(() => {
  // Set before any module import — routes read USE_MOCK_DATA at module init time
  process.env.USE_MOCK_DATA = 'false'
  return {
  tenant:  { findUnique: vi.fn(async () => ({ maxDrivers: null as number | null, maxMissions: null as number | null, trade: null as string | null })) },
  driver:  { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  mission: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) },
  vehicle: {
    findMany: vi.fn(async () => [{
      id: 'v1', licensePlate: 'AA-123-BB', gabaritProfile: 'pl_26t',
      weightTon: 26, heightM: 4, widthM: 2.55, lengthM: 12,
      axleCount: 3, hazmat: false, archived: false,
      gpsDeviceId: null, assignedDriverId: null,
    }]),
    count: vi.fn(async () => 1),
  },
  tenantSettings: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
  holiday: {
    findMany:  vi.fn(async () => [{ id: 'h1', date: '2026-01-01', name: 'Jour de l\'an' }]),
    count:     vi.fn(async () => 1),
    create:    vi.fn(async () => ({ id: 'h2', date: '2026-05-01', name: 'Fête du Travail' })),
    findFirst: vi.fn(async () => ({ id: 'h1', tenantId: 'tenant-1' })),
    delete:    vi.fn(async () => ({})),
  },
  }
})
vi.mock('@/lib/db', () => ({ default: mockPrisma }))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGet(url: string, params: Record<string, string> = {}): NextRequest {
  const u = new URL(`http://localhost${url}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return new NextRequest(u)
}

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function makePut(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function makeDel(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'DELETE' })
}

beforeEach(() => vi.clearAllMocks())

// ═════════════════════════════════════════════════════════════════════════════
// 1. driver-list — TTL 60s
// ═════════════════════════════════════════════════════════════════════════════

describe('driver-list — cache TTL 60s', () => {
  it('getOrSet called with 60_000ms TTL', async () => {
    const { GET } = await import('@/app/api/driver-list/route')
    const req = new NextRequest('http://localhost/api/driver-list')
    req.cookies.set('session', 'tok')
    await GET(req)
    const ttl = (mockCache.getOrSet.mock.calls[0] as unknown[])[3] as number
    expect(ttl).toBe(60_000)
  })

  it('Cache-Control header is max-age=60', async () => {
    const { GET } = await import('@/app/api/driver-list/route')
    const req = new NextRequest('http://localhost/api/driver-list')
    req.cookies.set('session', 'tok')
    const res = await GET(req)
    expect(res.headers.get('Cache-Control')).toContain('max-age=60')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. drivers POST — parallel fetch + driver-list invalidation
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/drivers — parallel fetch + driver-list invalidation', () => {
  const validBody = {
    firstName: 'Jean', lastName: 'Dupont', sector: 'Nord',
    depotName: 'Depot', depotLat: 45.0, depotLng: 4.8,
    vehicleCapacity: 15, weeklyHoursMax: 48,
  }

  it('invalidates both "drivers" and "driver-list" caches', async () => {
    const { POST } = await import('@/app/api/drivers/route')
    const res = await POST(makePost('/api/drivers', validBody))
    expect(res.status).toBe(201)
    const namespaces = mockCache.invalidateAll.mock.calls.map(c => c[0])
    expect(namespaces).toContain('drivers')
    expect(namespaces).toContain('driver-list')
  })

  it('calls tenant.findUnique and driver.count in the same tick (both called once)', async () => {
    const { POST } = await import('@/app/api/drivers/route')
    await POST(makePost('/api/drivers', validBody))
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(1)
    expect(mockPrisma.driver.count).toHaveBeenCalledTimes(1)
  })

  it('returns 403 when driver limit is reached', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ maxDrivers: 2, maxMissions: null, trade: null })
    mockPrisma.driver.count.mockResolvedValueOnce(2)
    const { POST } = await import('@/app/api/drivers/route')
    const res = await POST(makePost('/api/drivers', validBody))
    expect(res.status).toBe(403)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. drivers/[id] PUT + DELETE — driver-list invalidation
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT/DELETE /api/drivers/[id] — driver-list invalidation', () => {
  const params = { params: Promise.resolve({ id: 'drv-1' }) }

  it('PUT invalidates "drivers" and "driver-list"', async () => {
    const { PUT } = await import('@/app/api/drivers/[id]/route')
    const res = await PUT(makePut('/api/drivers/drv-1', { firstName: 'Marie' }), params)
    expect(res.status).toBe(200)
    const ns = mockCache.invalidateAll.mock.calls.map(c => c[0])
    expect(ns).toContain('drivers')
    expect(ns).toContain('driver-list')
  })

  it('DELETE invalidates "drivers" and "driver-list"', async () => {
    const { DELETE } = await import('@/app/api/drivers/[id]/route')
    const res = await DELETE(makeDel('/api/drivers/drv-1'), params)
    expect(res.status).toBe(200)
    const ns = mockCache.invalidateAll.mock.calls.map(c => c[0])
    expect(ns).toContain('drivers')
    expect(ns).toContain('driver-list')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. vehicles — select{} + TTL 60s
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/vehicles — select and TTL 60s', () => {
  it('getOrSet called with 60_000ms TTL', async () => {
    const { GET } = await import('@/app/api/vehicles/route')
    await GET(makeGet('/api/vehicles'))
    const ttl = (mockCache.getOrSet.mock.calls[0] as unknown[])[3] as number
    expect(ttl).toBe(60_000)
  })

  it('findMany receives a select clause with required fields', async () => {
    const { GET } = await import('@/app/api/vehicles/route')
    await GET(makeGet('/api/vehicles'))
    const arg = (mockPrisma.vehicle.findMany.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    const sel = arg.select as Record<string, unknown>
    expect(sel).toBeDefined()
    expect(sel.licensePlate).toBe(true)
    expect(sel.gabaritProfile).toBe(true)
    expect(sel.assignedDriverId).toBe(true)
  })

  it('select does NOT include brand or model', async () => {
    const { GET } = await import('@/app/api/vehicles/route')
    await GET(makeGet('/api/vehicles'))
    const arg = (mockPrisma.vehicle.findMany.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    const sel = arg.select as Record<string, unknown>
    expect(sel.brand).toBeUndefined()
    expect(sel.model).toBeUndefined()
  })

  it('Cache-Control header is max-age=60', async () => {
    const { GET } = await import('@/app/api/vehicles/route')
    const res = await GET(makeGet('/api/vehicles'))
    expect(res.headers.get('Cache-Control')).toContain('max-age=60')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. settings — TTL 120s
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/settings — TTL 120s', () => {
  it('getOrSet called with 120_000ms TTL', async () => {
    const { GET } = await import('@/app/api/settings/route')
    await GET(makeGet('/api/settings'))
    const ttl = (mockCache.getOrSet.mock.calls[0] as unknown[])[3] as number
    expect(ttl).toBe(120_000)
  })

  it('Cache-Control header is max-age=120', async () => {
    const { GET } = await import('@/app/api/settings/route')
    const res = await GET(makeGet('/api/settings'))
    expect(res.headers.get('Cache-Control')).toContain('max-age=120')
  })

  it('PUT invalidates the settings cache', async () => {
    const { PUT } = await import('@/app/api/settings/route')
    await PUT(makePut('/api/settings', { valhallaFactor: 1.6 }))
    expect(mockCache.invalidate).toHaveBeenCalledWith('settings', 'tenant-1')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. holidays — TTL 3600s
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/holidays — TTL 3600s', () => {
  it('getOrSet called with 3_600_000ms TTL', async () => {
    const { GET } = await import('@/app/api/holidays/route')
    await GET(makeGet('/api/holidays'))
    const ttl = (mockCache.getOrSet.mock.calls[0] as unknown[])[3] as number
    expect(ttl).toBe(3_600_000)
  })

  it('Cache-Control header is max-age=3600', async () => {
    const { GET } = await import('@/app/api/holidays/route')
    const res = await GET(makeGet('/api/holidays'))
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
  })

  it('POST invalidates "holidays" cache', async () => {
    const { POST } = await import('@/app/api/holidays/route')
    await POST(makePost('/api/holidays', { date: '2026-05-01', name: 'Fête du Travail' }))
    expect(mockCache.invalidateAll).toHaveBeenCalledWith('holidays', 'tenant-1')
  })

  it('DELETE [id] invalidates "holidays" cache', async () => {
    const { DELETE } = await import('@/app/api/holidays/[id]/route')
    await DELETE(makeDel('/api/holidays/h1'), { params: Promise.resolve({ id: 'h1' }) })
    expect(mockCache.invalidateAll).toHaveBeenCalledWith('holidays', 'tenant-1')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. missions GET — pagination defaults pageSize=50, max=100
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/missions — pagination', () => {
  it('defaults to pageSize=50', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions'))
    const json = await res.json()
    expect(json.data).toHaveLength(50)
    expect(json.pageSize).toBe(50)
    expect(json.total).toBe(200)
  })

  it('caps pageSize at 100', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions', { pageSize: '9999' }))
    const json = await res.json()
    expect(json.data).toHaveLength(100)
    expect(json.pageSize).toBe(100)
  })

  it('accepts explicit pageSize', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions', { pageSize: '25' }))
    const json = await res.json()
    expect(json.data).toHaveLength(25)
    expect(json.pageSize).toBe(25)
  })

  it('accepts legacy limit param', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions', { limit: '30' }))
    const json = await res.json()
    expect(json.data).toHaveLength(30)
  })

  it('returns totalPages, total, page fields', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions', { pageSize: '50' }))
    const json = await res.json()
    expect(json.total).toBe(200)
    expect(json.totalPages).toBe(4)
    expect(json.page).toBe(1)
    expect(json.pageSize).toBe(50)
  })

  it('paginates to page 2 correctly', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions', { page: '2', pageSize: '50' }))
    const json = await res.json()
    expect(json.data).toHaveLength(50)
    expect(json.data[0].id).toBe('m-50')
    expect(json.page).toBe(2)
  })

  it('backwards-compatible pagination object still present', async () => {
    const { GET } = await import('@/app/api/missions/route')
    const res  = await GET(makeGet('/api/missions'))
    const json = await res.json()
    expect(json.pagination).toBeDefined()
    expect(json.pagination.total).toBe(200)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. missions POST — parallel tenant+count
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/missions — parallel tenant+count', () => {
  const validBody = { type: 'POSER', date: '2026-05-18', address: '1 Rue Test', latitude: 45.0, longitude: 4.8 }

  it('calls tenant.findUnique and mission.count exactly once each', async () => {
    const { POST } = await import('@/app/api/missions/route')
    const res = await POST(makePost('/api/missions', validBody))
    expect(res.status).toBe(201)
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(1)
    expect(mockPrisma.mission.count).toHaveBeenCalledTimes(1)
  })

  it('returns 403 when mission limit is reached', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ maxMissions: 5, maxDrivers: null, trade: null })
    mockPrisma.mission.count.mockResolvedValueOnce(5)
    const { POST } = await import('@/app/api/missions/route')
    const res = await POST(makePost('/api/missions', validBody))
    expect(res.status).toBe(403)
  })
})
