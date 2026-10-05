import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  plan: {
    findMany:   vi.fn(),
    upsert:     vi.fn(),
    deleteMany: vi.fn(),
  },
  driverUnavailability: {
    findMany: vi.fn(),
    count:    vi.fn(),
    create:   vi.fn(),
  },
  mission: {
    groupBy: vi.fn(),
  },
  // Referenced driver ids are verified against the tenant before any write.
  driver: {
    findFirst: vi.fn(async () => ({ id: 'd-1' })),
    count:     vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length),
  },
  $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
}))

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
    getOrSet: vi.fn((_ns: string, _t: string, fn: () => Promise<unknown>) => fn()),
  },
}))

vi.mock('@/lib/integrationEvents', () => ({ emitEvent: vi.fn() }))

vi.mock('@/lib/metrics', () => ({
  metrics: { histogram: vi.fn(), increment: vi.fn() },
  METRIC:  { API_LATENCY_MS: 'api.latency', API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))

import { GET as plansGET, POST as plansPOST, DELETE as plansDELETE } from '@/app/api/plans/route'
import { GET as unavailGET, POST as unavailPOST } from '@/app/api/driver-unavailability/route'
import { GET as kpiGET } from '@/app/api/kpi-history/route'
import { getRequestContext } from '@/lib/data/context'

function makeGet(url: string): NextRequest {
  return new NextRequest(url)
}

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeDelete(url: string): NextRequest {
  return new NextRequest(url, { method: 'DELETE' })
}

function makeBadJson(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  })
}

const samplePlan = {
  driverId: 'd-1',
  date: '2026-04-01',
  missions: [],
}

describe('GET /api/plans', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 400 when date param missing', async () => {
    const res = await plansGET(makeGet('http://localhost:3000/api/plans'))
    expect(res.status).toBe(400)
  })

  it('returns plans for date (200)', async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      { id: 'p-1', driverId: 'd-1', date: '2026-04-01', missions: [], startTime: '07:00', speedKmh: 50 },
    ])

    const res  = await plansGET(makeGet('http://localhost:3000/api/plans?date=2026-04-01'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
    expect(json[0].driverId).toBe('d-1')
  })

  it('returns 500 on DB error', async () => {
    const { redisCache } = await import('@/lib/redisCache')
    vi.mocked(redisCache.getOrSet).mockRejectedValueOnce(new Error('DB fail'))

    const res = await plansGET(makeGet('http://localhost:3000/api/plans?date=2026-04-01'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/plans', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('saves single plan (200)', async () => {
    mockPrisma.plan.upsert.mockResolvedValue({ id: 'p-1', ...samplePlan })

    const res  = await plansPOST(makePost('http://localhost:3000/api/plans', samplePlan))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.saved).toBe(1)
  })

  it('rejects a plan whose driverId belongs to another tenant (422, nothing written)', async () => {
    mockPrisma.driver.count.mockResolvedValueOnce(0)
    mockPrisma.plan.upsert.mockClear()
    const res = await plansPOST(makePost('http://localhost:3000/api/plans', samplePlan))
    expect(res.status).toBe(422)
    expect(mockPrisma.plan.upsert).not.toHaveBeenCalled()
  })

  it('saves array of plans (200)', async () => {
    mockPrisma.plan.upsert.mockResolvedValue({ id: 'p-1', ...samplePlan })

    const res  = await plansPOST(makePost('http://localhost:3000/api/plans', [samplePlan, { ...samplePlan, driverId: 'd-2' }]))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.saved).toBe(2)
  })

  it('returns 400 when batch size exceeds 500', async () => {
    const batch = Array.from({ length: 501 }, (_, i) => ({ ...samplePlan, driverId: `d-${i}` }))
    const res = await plansPOST(makePost('http://localhost:3000/api/plans', batch))
    expect(res.status).toBe(400)
  })

  it('returns 422 for invalid plan (bad date)', async () => {
    const res = await plansPOST(makePost('http://localhost:3000/api/plans', { ...samplePlan, date: 'not-a-date' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await plansPOST(makeBadJson('http://localhost:3000/api/plans'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.plan.upsert.mockRejectedValue(new Error('DB fail'))

    const res = await plansPOST(makePost('http://localhost:3000/api/plans', samplePlan))
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/plans', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes plans for date (200)', async () => {
    mockPrisma.plan.deleteMany.mockResolvedValue({ count: 3 })

    const res  = await plansDELETE(makeDelete('http://localhost:3000/api/plans?date=2026-04-01'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.deleted).toBe(3)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await plansDELETE(makeDelete('http://localhost:3000/api/plans?date=2026-04-01'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when date param missing', async () => {
    const res = await plansDELETE(makeDelete('http://localhost:3000/api/plans'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid date format', async () => {
    const res = await plansDELETE(makeDelete('http://localhost:3000/api/plans?date=01/04/2026'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.plan.deleteMany.mockRejectedValue(new Error('DB fail'))

    const res = await plansDELETE(makeDelete('http://localhost:3000/api/plans?date=2026-04-01'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/driver-unavailability', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated unavailabilities (200)', async () => {
    mockPrisma.driverUnavailability.findMany.mockResolvedValue([
      { id: 'u-1', driverId: 'd-1', startDate: '2026-04-10', endDate: '2026-04-12', reason: 'conge' },
    ])
    mockPrisma.driverUnavailability.count.mockResolvedValue(1)

    const res  = await unavailGET(makeGet('http://localhost:3000/api/driver-unavailability'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.pagination.total).toBe(1)
  })

  it('filters by driverId param', async () => {
    mockPrisma.driverUnavailability.findMany.mockResolvedValue([])
    mockPrisma.driverUnavailability.count.mockResolvedValue(0)

    await unavailGET(makeGet('http://localhost:3000/api/driver-unavailability?driverId=d-1'))

    expect(mockPrisma.driverUnavailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ driverId: 'd-1' }) })
    )
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.driverUnavailability.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await unavailGET(makeGet('http://localhost:3000/api/driver-unavailability'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/driver-unavailability', () => {
  const validBody = {
    driverId: 'd-1', startDate: '2026-04-10', endDate: '2026-04-12', reason: 'conge',
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('creates unavailability (201)', async () => {
    mockPrisma.driverUnavailability.create.mockResolvedValue({ id: 'u-1', ...validBody })

    const res  = await unavailPOST(makePost('http://localhost:3000/api/driver-unavailability', validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.reason).toBe('conge')
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await unavailPOST(makePost('http://localhost:3000/api/driver-unavailability', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid reason', async () => {
    const res = await unavailPOST(makePost('http://localhost:3000/api/driver-unavailability', { ...validBody, reason: 'invalid' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when endDate < startDate', async () => {
    const res = await unavailPOST(makePost('http://localhost:3000/api/driver-unavailability', { ...validBody, endDate: '2026-04-09' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await unavailPOST(makeBadJson('http://localhost:3000/api/driver-unavailability'))
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate (P2002)', async () => {
    const err = Object.assign(new Error('Unique'), { code: 'P2002' })
    mockPrisma.driverUnavailability.create.mockRejectedValue(err)

    const res = await unavailPOST(makePost('http://localhost:3000/api/driver-unavailability', validBody))
    expect(res.status).toBe(409)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.driverUnavailability.create.mockRejectedValue(new Error('DB fail'))

    const res = await unavailPOST(makePost('http://localhost:3000/api/driver-unavailability', validBody))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/kpi-history', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns history array with default 7 days (200)', async () => {
    mockPrisma.mission.groupBy.mockResolvedValue([])

    const planGroupBy = vi.fn().mockResolvedValue([])
    ;(mockPrisma as Record<string, unknown>).plan = { groupBy: planGroupBy }

    const res  = await kpiGET(makeGet('http://localhost:3000/api/kpi-history'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.history).toHaveLength(7)
  })

  it('respects days param', async () => {
    mockPrisma.mission.groupBy.mockResolvedValue([])
    ;(mockPrisma as Record<string, unknown>).plan = { groupBy: vi.fn().mockResolvedValue([]) }

    const res  = await kpiGET(makeGet('http://localhost:3000/api/kpi-history?days=3'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.history).toHaveLength(3)
  })

  it('clamps days to max 30', async () => {
    mockPrisma.mission.groupBy.mockResolvedValue([])
    ;(mockPrisma as Record<string, unknown>).plan = { groupBy: vi.fn().mockResolvedValue([]) }

    const res  = await kpiGET(makeGet('http://localhost:3000/api/kpi-history?days=999'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.history).toHaveLength(30)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.mission.groupBy.mockRejectedValue(new Error('DB fail'))

    const res = await kpiGET(makeGet('http://localhost:3000/api/kpi-history'))
    expect(res.status).toBe(500)
  })
})
