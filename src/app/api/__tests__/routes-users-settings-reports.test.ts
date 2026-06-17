import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    user: {
      findMany: vi.fn(), count: vi.fn(), create: vi.fn(),
      findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    tenantSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    tenant: { findUnique: vi.fn() },
    mission: { count: vi.fn(), groupBy: vi.fn() },
    plan: { count: vi.fn(), groupBy: vi.fn() },
    driver: { count: vi.fn() },
    vehicle: { count: vi.fn() },
    exutoire: { count: vi.fn() },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC: { API_LATENCY_MS: 'l', API_REQUESTS: 'r', API_ERRORS: 'e' },
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(() => Promise.resolve('$2a$12$hashed')), compare: vi.fn() },
}))

import { GET as getUsers, POST as postUser } from '@/app/api/users/route'
import { GET as getSettings, PUT as putSettings } from '@/app/api/settings/route'
import { GET as getReports } from '@/app/api/reports/route'
import { getRequestContext } from '@/lib/data/context'

function makeGet(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function makePost(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makePut(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

const resetCtx = () => vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' } as never)

describe('GET /api/users', () => {
  beforeEach(() => { vi.clearAllMocks(); resetCtx() })

  it('returns users list for admins', async () => {
    const users = [{ id: 'u1', email: 'a@b.c', role: 'admin', firstName: 'A', lastName: 'B' }]
    mockPrisma.user.findMany.mockResolvedValue(users)
    mockPrisma.user.count.mockResolvedValue(1)

    const res = await getUsers(makeGet('/api/users'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.pagination.total).toBe(1)
  })

  it('returns 403 for non-admin roles', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u1', role: 'driver', requestId: 'r1' } as never)

    const res = await getUsers(makeGet('/api/users'))
    expect(res.status).toBe(403)
  })

  it('supports pagination', async () => {
    mockPrisma.user.findMany.mockResolvedValue([])
    mockPrisma.user.count.mockResolvedValue(50)

    const res = await getUsers(makeGet('/api/users', { page: '2', limit: '10' }))
    const json = await res.json()

    expect(json.pagination.page).toBe(2)
    expect(json.pagination.limit).toBe(10)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.user.findMany.mockRejectedValue(new Error('fail'))

    const res = await getUsers(makeGet('/api/users'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/users', () => {
  beforeEach(() => { vi.clearAllMocks(); resetCtx() })

  const validBody = {
    email: 'new@user.com', password: 'Str0ngP@ss!2024xx',
    firstName: 'Jean', lastName: 'Dupont', role: 'DISPATCHER',
  }

  it('creates a user with valid input (201)', async () => {
    mockPrisma.user.create.mockResolvedValue({ id: 'u-new', ...validBody })

    const res = await postUser(makePost('/api/users', validBody))
    expect(res.status).toBe(201)
  })

  it('rejects missing fields (422)', async () => {
    const res = await postUser(makePost('/api/users', { email: 'a@b.c' }))
    expect(res.status).toBe(422)
  })

  it('returns 409 on duplicate email', async () => {
    const err = new Error('dup') as Error & { code: string }
    err.code = 'P2002'
    mockPrisma.user.create.mockRejectedValue(err)

    const res = await postUser(makePost('/api/users', validBody))
    expect(res.status).toBe(409)
  })

  it('rejects invalid JSON (400)', async () => {
    const req = new NextRequest('http://localhost:3000/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid',
    })
    const res = await postUser(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/settings', () => {
  beforeEach(() => { vi.clearAllMocks(); resetCtx() })

  it('returns default settings when none exist', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ trade: 'dechets' })

    const res = await getSettings(makeGet('/api/settings'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.defaultSpeedKmh).toBe(50)
    expect(json.trade).toBe('dechets')
    expect(res.headers.get('Cache-Control')).toContain('max-age=120')
  })

  it('returns saved settings', async () => {
    const settings = { tenantId: 'tenant-test', defaultSpeedKmh: 70, costPerKm: 0.5 }
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(settings)
    mockPrisma.tenant.findUnique.mockResolvedValue({ trade: null })

    const res = await getSettings(makeGet('/api/settings'))
    const json = await res.json()

    expect(json.defaultSpeedKmh).toBe(70)
    expect(json.costPerKm).toBe(0.5)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenantSettings.findUnique.mockRejectedValue(new Error('fail'))

    const res = await getSettings(makeGet('/api/settings'))
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/settings', () => {
  beforeEach(() => { vi.clearAllMocks(); resetCtx() })

  it('updates settings for admin', async () => {
    const updated = { tenantId: 'tenant-test', defaultSpeedKmh: 60 }
    mockPrisma.tenantSettings.upsert.mockResolvedValue(updated)

    const res = await putSettings(makePut('/api/settings', { defaultSpeedKmh: 60 }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.defaultSpeedKmh).toBe(60)
  })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await putSettings(makePut('/api/settings', { defaultSpeedKmh: 60 }))
    expect(res.status).toBe(403)
  })

  it('rejects invalid JSON (400)', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{{bad',
    })
    const res = await putSettings(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/reports', () => {
  beforeEach(() => { vi.clearAllMocks(); resetCtx() })

  it('returns report data for admin', async () => {
    mockPrisma.mission.count.mockResolvedValue(100)
    mockPrisma.plan.count.mockResolvedValue(10)
    mockPrisma.driver.count.mockResolvedValue(5)
    mockPrisma.vehicle.count.mockResolvedValue(3)
    mockPrisma.exutoire.count.mockResolvedValue(2)
    mockPrisma.mission.groupBy.mockResolvedValue([])
    mockPrisma.plan.groupBy.mockResolvedValue([])

    const res = await getReports(makeGet('/api/reports', { period: 'week', date: '2026-03-15' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.period).toBe('week')
    expect(json.kpis.drivers).toBe(5)
    expect(json.kpis.vehicles).toBe(3)
    expect(res.headers.get('Cache-Control')).toContain('max-age=60')
  })

  it('returns 403 for drivers', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await getReports(makeGet('/api/reports'))
    expect(res.status).toBe(403)
  })

  it('supports month period by default', async () => {
    mockPrisma.mission.count.mockResolvedValue(0)
    mockPrisma.plan.count.mockResolvedValue(0)
    mockPrisma.driver.count.mockResolvedValue(0)
    mockPrisma.vehicle.count.mockResolvedValue(0)
    mockPrisma.exutoire.count.mockResolvedValue(0)
    mockPrisma.mission.groupBy.mockResolvedValue([])
    mockPrisma.plan.groupBy.mockResolvedValue([])

    const res = await getReports(makeGet('/api/reports'))
    const json = await res.json()

    expect(json.period).toBe('month')
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.mission.count.mockRejectedValue(new Error('fail'))

    const res = await getReports(makeGet('/api/reports'))
    expect(res.status).toBe(500)
  })
})
