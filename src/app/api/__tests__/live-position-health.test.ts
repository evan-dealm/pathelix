import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    driver: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    mission: {
      findMany: vi.fn(),
    },
    plan: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    tenantSettings: {
      findUnique: vi.fn(),
    },
    exutoire: {
      findMany: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

const { getRequestContext } = vi.hoisted(() => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1' })),
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext,
  getTenantId: vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), timer: () => () => 0,
  }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC: { VRP_ENQUEUED: 'vrp.enqueued', API_ERRORS: 'api.errors', API_REQUESTS: 'api.requests' },
}))

vi.mock('@/lib/loadShedder', () => ({
  loadShedder: { acquire: vi.fn(() => 'ok'), release: vi.fn() },
  shedResponse: vi.fn(() => new Response('Service Unavailable', { status: 503 })),
}))

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(() => []),
  getDriver: vi.fn(),
}))

vi.mock('@/lib/data/missions', () => ({
  getMissionsByDate: vi.fn(() => []),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(() => []),
}))

vi.mock('@/lib/vrp/index', () => ({
  runVRP: vi.fn(() => ({
    assignments: {},
    unassignedMissions: [],
    stats: { assignedMissions: 0, totalMissions: 0 },
    warnings: [],
  })),
}))

vi.mock('@/lib/integrationEvents', () => ({
  emitEvent: vi.fn(),
}))

vi.mock('@/lib/obdStore', () => ({
  getAllCurrentPositions: vi.fn(() => []),
  recordOBDReading: vi.fn(),
  getSpeedHistoryForDate: vi.fn(() => []),
  getAllSpeedHistories: vi.fn(() => ({})),
}))

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(() => ({ sub: 'user-1', role: 'admin', tenantId: 'tenant-1' })),
  SESSION_COOKIE: 'session',
  COOKIE_OPTIONS: {},
}))

function makeRequest(url: string, opts?: { method?: string; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const init: Record<string, unknown> = { method: opts?.method ?? 'GET' }
  if (opts?.body) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'Content-Type': 'application/json', ...opts?.headers }
  }
  const req = new NextRequest(url, init)
  if (opts?.cookies) {
    for (const [k, v] of Object.entries(opts.cookies)) {
      req.cookies.set(k, v)
    }
  }
  return req
}

describe('POST /api/optimize/live', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRequestContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'u', role: 'admin', requestId: 'r' })
  })

  it('rejects non-admin/dispatcher role', async () => {
    getRequestContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'u', role: 'driver', requestId: 'r' })

    const { POST } = await import('@/app/api/optimize/live/route')
    const req = makeRequest('http://localhost:3000/api/optimize/live', {
      method: 'POST',
      body: { date: '2026-03-22' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('rejects invalid date format', async () => {
    const { POST } = await import('@/app/api/optimize/live/route')
    const req = makeRequest('http://localhost:3000/api/optimize/live', {
      method: 'POST',
      body: { date: 'invalid' },
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns message when no active missions', async () => {
    mockPrisma.driver.findMany.mockResolvedValue([])
    mockPrisma.mission.findMany.mockResolvedValue([])
    mockPrisma.plan.findMany.mockResolvedValue([])
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.exutoire.findMany.mockResolvedValue([])

    const { getAllDrivers } = await import('@/lib/data/drivers')
    vi.mocked(getAllDrivers).mockResolvedValue([
      { id: 'd1', firstName: 'Test', lastName: 'Driver', sector: 'S1', depotName: 'D', depotLat: 45.76, depotLng: 6.05 },
    ])

    const { POST } = await import('@/app/api/optimize/live/route')
    const req = makeRequest('http://localhost:3000/api/optimize/live', {
      method: 'POST',
      body: { date: '2026-03-22' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
  })
})

describe('POST /api/driver-position', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects unauthenticated request', async () => {
    const { verifySession } = await import('@/lib/session')
    vi.mocked(verifySession).mockResolvedValue(null)

    const { POST } = await import('@/app/api/driver-position/route')
    const req = makeRequest('http://localhost:3000/api/driver-position', {
      method: 'POST',
      body: { driverId: 'd1', latitude: 45.76, longitude: 6.05 },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects invalid coordinates', async () => {
    const { verifySession } = await import('@/lib/session')
    vi.mocked(verifySession).mockResolvedValue({ sub: 'u1', role: 'driver', tenantId: 'tenant-1' })

    const { POST } = await import('@/app/api/driver-position/route')
    const req = makeRequest('http://localhost:3000/api/driver-position', {
      method: 'POST',
      body: { driverId: 'd1', latitude: 999, longitude: 6.05 },
      cookies: { session: 'valid-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('rejects driver not found', async () => {
    const { verifySession } = await import('@/lib/session')
    vi.mocked(verifySession).mockResolvedValue({ sub: 'u1', role: 'driver', tenantId: 'tenant-1' })
    const { getDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValue(null)

    const { POST } = await import('@/app/api/driver-position/route')
    const req = makeRequest('http://localhost:3000/api/driver-position', {
      method: 'POST',
      body: { driverId: 'd-nonexistent', latitude: 45.76, longitude: 6.05 },
      cookies: { session: 'valid-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('records position for valid driver', async () => {
    const { verifySession } = await import('@/lib/session')
    vi.mocked(verifySession).mockResolvedValue({ sub: 'd1', role: 'driver', tenantId: 'tenant-rec', driverRef: 'd1' })
    // POST now uses getTenantDriverIds → findMany cache instead of getDriver
    mockPrisma.driver.findMany.mockResolvedValue([{ id: 'd1' }])

    const { recordOBDReading } = await import('@/lib/obdStore')

    const { POST } = await import('@/app/api/driver-position/route')
    const req = makeRequest('http://localhost:3000/api/driver-position', {
      method: 'POST',
      body: { driverId: 'd1', latitude: 45.76, longitude: 6.05, speedKmh: 42 },
      cookies: { session: 'valid-token' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(recordOBDReading).toHaveBeenCalledWith(expect.objectContaining({
      driverId: 'd1',
      lat: 45.76,
      lng: 6.05,
      speedKmh: 42,
    }))
  })

  it('[SEC-C1] driver cannot post position for another driver in same tenant', async () => {
    const { verifySession } = await import('@/lib/session')
    vi.mocked(verifySession).mockResolvedValue({ sub: 'driver-a', role: 'driver', tenantId: 'tenant-sec1', driverRef: 'driver-a' })
    mockPrisma.driver.findMany.mockResolvedValue([{ id: 'driver-b' }])

    const { POST } = await import('@/app/api/driver-position/route')
    const req = makeRequest('http://localhost:3000/api/driver-position', {
      method: 'POST',
      body: { driverId: 'driver-b', latitude: 45.76, longitude: 6.05 },
      cookies: { session: 'valid-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('[SEC-C1] admin can post position for any driver in same tenant', async () => {
    const { verifySession } = await import('@/lib/session')
    vi.mocked(verifySession).mockResolvedValue({ sub: 'admin-user', role: 'admin', tenantId: 'tenant-sec2' })
    mockPrisma.driver.findMany.mockResolvedValue([{ id: 'driver-b' }])

    const { POST } = await import('@/app/api/driver-position/route')
    const req = makeRequest('http://localhost:3000/api/driver-position', {
      method: 'POST',
      body: { driverId: 'driver-b', latitude: 45.76, longitude: 6.05 },
      cookies: { session: 'valid-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})