import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

const mockPrisma = vi.hoisted(() => ({
  driver: {
    findUnique: vi.fn(),
    findMany:   vi.fn(),
  },
  plan: {
    findFirst:   vi.fn(),
    findMany:    vi.fn(),
    updateMany:  vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
    update:    vi.fn(),
  },
  exutoire: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
  checkTenantSuspension: vi.fn(async () => null),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: vi.fn(),
  signSession:   vi.fn().mockResolvedValue('mock-jwt-token'),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet: vi.fn((_ns: string, _t: string, fn: () => Promise<unknown>) => fn()),
    invalidate: vi.fn(),
  },
}))

vi.mock('@/lib/prismaMappers', () => ({
  prismaRowToDriver:   vi.fn((raw: Record<string, unknown>) => raw),
  prismaRowToExutoire: vi.fn((raw: Record<string, unknown>) => raw),
}))

vi.mock('@/lib/mockData', () => ({
  getMockDrivers: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/vrp/routeCost', () => ({
  computeRouteCost:      vi.fn().mockReturnValue(100),
  computePrefixStates:   vi.fn().mockReturnValue([]),
  computeInsertionDelta: vi.fn().mockReturnValue(10),
}))

import { GET as driverListGET }                        from '@/app/api/driver-list/route'
import { GET as driverPlanGET }                        from '@/app/api/driver-plan/[id]/route'
import { POST as redistributePOST }                    from '@/app/api/redistribute/route'
import { verifySession }                               from '@/lib/session'
import { getRequestContext }                           from '@/lib/data/context'

function makeGet(url: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (cookie) headers['Cookie'] = `session=${cookie}`
  return new NextRequest(url, { headers })
}

function makePost(url: string, body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers['Cookie'] = `session=${cookie}`
  return new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

function makeBadJson(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const adminSession = {
  sub: 'user-1', role: 'admin', tenantId: 'tenant-test',
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
}

const sampleDriver = {
  id: 'd-1', firstName: 'Jean', lastName: 'Dupont',
  sector: 'Nord', depotName: 'Lyon', depotLat: 45.764, depotLng: 4.836,
  tenantId: 'tenant-test', archived: false,
}

describe('GET /api/driver-list', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when no session cookie', async () => {
    vi.mocked(verifySession).mockResolvedValue(null as never)

    const res = await driverListGET(makeGet('http://localhost:3000/api/driver-list'))
    expect(res.status).toBe(401)
  })

  it('returns drivers grouped by sector (200)', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)
    mockPrisma.driver.findMany.mockResolvedValue([sampleDriver])

    const res  = await driverListGET(makeGet('http://localhost:3000/api/driver-list', 'token'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(json)).toBe(true)
    const sector = json.find((g: { sector: string }) => g.sector === 'Nord')
    expect(sector?.drivers).toHaveLength(1)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)
    const { redisCache } = await import('@/lib/redisCache')
    vi.mocked(redisCache.getOrSet).mockRejectedValueOnce(new Error('DB fail'))

    const res = await driverListGET(makeGet('http://localhost:3000/api/driver-list', 'token'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/driver-plan/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 400 when date param missing', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)

    const res = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/d-1', 'token'), makeParams('d-1'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no valid session', async () => {
    vi.mocked(verifySession).mockResolvedValue(null as never)

    const res = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/d-1?date=2026-04-01'), makeParams('d-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when driver not found', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)
    mockPrisma.driver.findUnique.mockResolvedValue(null)

    const res = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/nope?date=2026-04-01', 'token'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when session is driver for another driver', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'other-user', role: 'driver', tenantId: 'tenant-test', driverRef: 'other-driver',
      iat: 0, exp: 9999999999,
    } as never)
    mockPrisma.driver.findUnique.mockResolvedValue({ ...sampleDriver })

    const res = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/d-1?date=2026-04-01', 'token'), makeParams('d-1'))
    expect(res.status).toBe(403)
  })

  it('returns plan for admin of same tenant (200)', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)
    mockPrisma.driver.findUnique.mockResolvedValue({ ...sampleDriver })
    mockPrisma.plan.findFirst.mockResolvedValue({ missions: [], startTime: '07:00', speedKmh: 50 })
    mockPrisma.tenant.findUnique.mockResolvedValue({ trade: 'bennes' })
    mockPrisma.exutoire.findMany.mockResolvedValue([])

    const res  = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/d-1?date=2026-04-01', 'token'), makeParams('d-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.driver.id).toBe('d-1')
    expect(json.plan).toBeDefined()
    expect(json.exutoires).toEqual([])
  })

  it('returns exutoires belonging to the driver\'s tenant', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)
    mockPrisma.driver.findUnique.mockResolvedValue({ ...sampleDriver })
    mockPrisma.plan.findFirst.mockResolvedValue({ missions: [], startTime: '07:00', speedKmh: 50 })
    mockPrisma.tenant.findUnique.mockResolvedValue({ trade: 'bennes' })
    mockPrisma.exutoire.findMany.mockResolvedValue([
      { id: 'ex-1', name: 'Centre Nord', address: 'a', lat: 45, lng: 4 },
    ])

    const res  = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/d-1?date=2026-04-01', 'token'), makeParams('d-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.exutoires).toHaveLength(1)
    expect(json.exutoires[0].id).toBe('ex-1')
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(verifySession).mockResolvedValue(adminSession as never)
    mockPrisma.driver.findUnique.mockRejectedValue(new Error('DB fail'))

    const res = await driverPlanGET(makeGet('http://localhost:3000/api/driver-plan/d-1?date=2026-04-01', 'token'), makeParams('d-1'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/redistribute', () => {
  const validBody = { driverId: 'd-1', date: '2026-04-01' }

  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await redistributePOST(makePost('http://localhost:3000/api/redistribute', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await redistributePOST(makeBadJson('http://localhost:3000/api/redistribute'))
    expect(res.status).toBe(400)
  })

  it('returns 422 for invalid body (missing driverId)', async () => {
    const res = await redistributePOST(makePost('http://localhost:3000/api/redistribute', { date: '2026-04-01' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when no plan found for driver', async () => {
    mockPrisma.plan.findMany.mockResolvedValue([])

    const res = await redistributePOST(makePost('http://localhost:3000/api/redistribute', validBody))
    expect(res.status).toBe(404)
  })

  it('returns 422 when no other drivers available', async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      { driverId: 'd-1', missions: [{ id: 'm-1', type: 'POSER', status: 'todo', latitude: 45, longitude: 4, estimatedDurationMin: 30, maneuverTimeMin: 5 }], startTime: '07:00', speedKmh: 50, locked: false },
    ])

    const res = await redistributePOST(makePost('http://localhost:3000/api/redistribute', validBody))
    expect(res.status).toBe(422)
  })

  it('returns preview assignments (200)', async () => {
    const brokenMission = { id: 'm-1', type: 'POSER', status: 'todo', latitude: 45, longitude: 4, estimatedDurationMin: 30, maneuverTimeMin: 5, priority: 2 }
    mockPrisma.plan.findMany.mockResolvedValue([
      { driverId: 'd-1', missions: [brokenMission], startTime: '07:00', speedKmh: 50, locked: false },
      { driverId: 'd-2', missions: [], startTime: '07:00', speedKmh: 50, locked: false },
    ])
    mockPrisma.driver.findMany.mockResolvedValue([
      { id: 'd-2', firstName: 'Marie', lastName: 'Martin', sector: 'Sud', depotName: 'Lyon', depotLat: 45, depotLng: 4, maxBinSizeM3: null, vehicleCapacity: null },
    ])
    mockPrisma.exutoire.findMany.mockResolvedValue([])

    const res  = await redistributePOST(makePost('http://localhost:3000/api/redistribute', validBody))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.assignments).toBeDefined()
    expect(json.applied).toBe(false)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.plan.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await redistributePOST(makePost('http://localhost:3000/api/redistribute', validBody))
    expect(res.status).toBe(500)
  })
})

// POST/GET /api/tracking are covered in tracking.test.ts (opaque tokens, expiry, staff-only creation).
