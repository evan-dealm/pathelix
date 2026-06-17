import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

const mockPrisma = vi.hoisted(() => ({
  weeklyPlan: {
    findUnique: vi.fn(),
    findMany:   vi.fn(),
    upsert:     vi.fn(),
    update:     vi.fn(),
  },
  mission: {
    findMany: vi.fn(),
    count:    vi.fn(),
    createMany: vi.fn(),
  },
  driver: {
    findMany:   vi.fn(),
    createMany: vi.fn(),
  },
  plan: {
    findMany: vi.fn(),
    upsert:   vi.fn(),
  },
  driverUnavailability: {
    findFirst: vi.fn(),
    delete:    vi.fn(),
  },
  tenant: {
    update: vi.fn(),
  },
  tenantSettings: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(async (ops: unknown) => {
    if (typeof ops === 'function') return ops(mockPrisma)
    if (Array.isArray(ops)) return Promise.all(ops)
    return ops
  }),
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { histogram: vi.fn(), increment: vi.fn() },
  METRIC:  { API_LATENCY_MS: 'api.latency', API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn().mockResolvedValue([]),
  getDriver:     vi.fn(),
  updateDriver:  vi.fn(),
  deleteDriver:  vi.fn(),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/vrp/index', () => ({
  runVRP: vi.fn().mockResolvedValue({
    routes: [], unassigned: [], stats: { totalDistance: 0 },
  }),
}))

vi.mock('@/lib/delayScoring', () => ({
  getDelayScoresForDate: vi.fn().mockResolvedValue([
    { missionId: 'm-1', score: 0.7, factors: [] },
  ]),
}))

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE:  'session',
  COOKIE_OPTIONS:  { httpOnly: true, sameSite: 'strict' },
  signSession:     vi.fn().mockResolvedValue('new-jwt-token'),
  verifySession:   vi.fn(),
}))

import { GET as weeklyGET, POST as weeklyPOST }           from '@/app/api/weekly-plan/route'
import { GET as complianceGET }                            from '@/app/api/drivers/compliance/route'
import { GET as delayGET }                                 from '@/app/api/predictions/delay/route'
import { DELETE as unavailDEL }                            from '@/app/api/driver-unavailability/[id]/route'
import { GET as onboardGET, POST as onboardPOST }          from '@/app/api/onboarding/route'
import { getRequestContext }                               from '@/lib/data/context'

function makeGet(url: string): NextRequest { return new NextRequest(url) }

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeBadJson(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  })
}

function makeDeleteWithRole(url: string, role = 'admin'): NextRequest {
  return new NextRequest(url, {
    method: 'DELETE', headers: { 'x-user-role': role },
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/weekly-plan', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists recent weekly plans (200)', async () => {
    mockPrisma.weeklyPlan.findMany.mockResolvedValue([
      { id: 'wp-1', weekStart: '2026-04-07', status: 'done', createdAt: new Date(), createdBy: 'user-1' },
    ])

    const res  = await weeklyGET(makeGet('http://localhost:3000/api/weekly-plan'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
  })

  it('returns plan by weekStart (200)', async () => {
    mockPrisma.weeklyPlan.findUnique.mockResolvedValue({ id: 'wp-1', weekStart: '2026-04-07', status: 'done' })

    const res  = await weeklyGET(makeGet('http://localhost:3000/api/weekly-plan?weekStart=2026-04-07'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.weekStart).toBe('2026-04-07')
  })

  it('returns 404 when weekStart not found', async () => {
    mockPrisma.weeklyPlan.findUnique.mockResolvedValue(null)

    const res = await weeklyGET(makeGet('http://localhost:3000/api/weekly-plan?weekStart=2026-01-01'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/weekly-plan', () => {
  const validBody = { weekStart: '2026-04-07' }

  beforeEach(() => { vi.clearAllMocks() })

  it('creates weekly plan and runs VRP (200)', async () => {
    mockPrisma.weeklyPlan.upsert.mockResolvedValue({ id: 'wp-1', weekStart: '2026-04-07', status: 'optimizing' })
    mockPrisma.mission.findMany.mockResolvedValue([])
    mockPrisma.weeklyPlan.update.mockResolvedValue({ id: 'wp-1', status: 'done' })

    const res  = await weeklyPOST(makePost('http://localhost:3000/api/weekly-plan', validBody))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.weekStart).toBe('2026-04-07')
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await weeklyPOST(makePost('http://localhost:3000/api/weekly-plan', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid weekStart', async () => {
    const res = await weeklyPOST(makePost('http://localhost:3000/api/weekly-plan', { weekStart: 'bad-date' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await weeklyPOST(makeBadJson('http://localhost:3000/api/weekly-plan'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/drivers/compliance', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns license and hours alerts (200)', async () => {
    mockPrisma.driver.findMany.mockResolvedValue([])
    mockPrisma.plan.findMany.mockResolvedValue([])

    const res  = await complianceGET(makeGet('http://localhost:3000/api/drivers/compliance'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.licenseAlerts).toBeDefined()
    expect(json.hoursAlerts).toBeDefined()
  })

  it('flags drivers with expiring licenses', async () => {
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + 10)
    mockPrisma.driver.findMany.mockResolvedValue([
      { id: 'd-1', firstName: 'Jean', lastName: 'Dupont', licenseExpiry: expiry },
    ])
    mockPrisma.plan.findMany.mockResolvedValue([])

    const res  = await complianceGET(makeGet('http://localhost:3000/api/drivers/compliance'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.licenseAlerts).toHaveLength(1)
    expect(json.licenseAlerts[0].level).toBe('urgent')
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.driver.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await complianceGET(makeGet('http://localhost:3000/api/drivers/compliance'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/predictions/delay', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns delay scores for date (200)', async () => {
    const res  = await delayGET(makeGet('http://localhost:3000/api/predictions/delay?date=2026-04-01'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.scores).toBeDefined()
    expect(json.date).toBe('2026-04-01')
  })

  it('defaults to today when date not provided', async () => {
    const res  = await delayGET(makeGet('http://localhost:3000/api/predictions/delay'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('DELETE /api/driver-unavailability/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes unavailability (200)', async () => {
    mockPrisma.driverUnavailability.findFirst.mockResolvedValue({ id: 'u-1' })
    mockPrisma.driverUnavailability.delete.mockResolvedValue({ id: 'u-1' })

    const res  = await unavailDEL(makeDeleteWithRole('http://localhost:3000/api/driver-unavailability/u-1'), makeParams('u-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 403 when role is driver', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'user-1', role: 'driver', requestId: 'r1', trade: null })
    const res = await unavailDEL(makeDeleteWithRole('http://localhost:3000/api/driver-unavailability/u-1', 'driver'), makeParams('u-1'))
    expect(res.status).toBe(403)
  })

  it('returns 403 when no role header', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'user-1', role: 'driver', requestId: 'r1', trade: null })
    const req = new NextRequest('http://localhost:3000/api/driver-unavailability/u-1', { method: 'DELETE' })
    const res = await unavailDEL(req, makeParams('u-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when not found', async () => {
    mockPrisma.driverUnavailability.findFirst.mockResolvedValue(null)

    const res = await unavailDEL(makeDeleteWithRole('http://localhost:3000/api/driver-unavailability/nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.driverUnavailability.findFirst.mockResolvedValue({ id: 'u-1' })
    mockPrisma.driverUnavailability.delete.mockRejectedValue(new Error('DB fail'))

    const res = await unavailDEL(makeDeleteWithRole('http://localhost:3000/api/driver-unavailability/u-1'), makeParams('u-1'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/onboarding', () => {
  const validBody = { trade: 'collecte_recyclage' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.tenant.update.mockResolvedValue({ id: 'tenant-test', name: 'Test', trade: 'collecte_recyclage' })
    mockPrisma.tenantSettings.upsert.mockResolvedValue({ tenantId: 'tenant-test' })
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[])
      return (ops as (_tx: unknown) => Promise<unknown>)(mockPrisma)
    })
  })

  it('saves trade and returns tenant (200)', async () => {
    const res  = await onboardPOST(makePost('http://localhost:3000/api/onboarding', validBody))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.trade).toBe('collecte_recyclage')
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await onboardPOST(makePost('http://localhost:3000/api/onboarding', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid trade', async () => {
    const res = await onboardPOST(makePost('http://localhost:3000/api/onboarding', { trade: 'invalid_trade' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await onboardPOST(makeBadJson('http://localhost:3000/api/onboarding'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('DB fail'))

    const res = await onboardPOST(makePost('http://localhost:3000/api/onboarding', validBody))
    expect(res.status).toBe(500)
  })
})
