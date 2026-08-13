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
    customTrade: { findUnique: vi.fn((): Promise<Record<string, unknown> | null> => Promise.resolve(null)) },
    mission: { count: vi.fn(), groupBy: vi.fn() },
    plan: { count: vi.fn(), groupBy: vi.fn() },
    driver: { count: vi.fn() },
    vehicle: { count: vi.fn() },
    exutoire: { count: vi.fn() },
    userPermission: { findMany: vi.fn(() => Promise.resolve([])) },
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

  // A7 note: hasPermission('manage_users') is wired here for consistency with the other route
  // families, but it's structurally a no-op on this specific route — manage_users is only
  // reachable by admin/superadmin (the pre-existing role check above already excludes everyone
  // else), and hasPermission() unconditionally returns true for admin/superadmin before ever
  // consulting UserPermission (see src/lib/permissions.ts:35). A revoked UserPermission for
  // manage_users cannot block an admin here — documented as accepted, not a bug.
  it('admin still succeeds even with manage_users explicitly revoked (hasPermission bypasses admin unconditionally)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'admin-revoked', role: 'admin', requestId: 'r' } as never)
    // No userPermission.findMany mock here: hasPermission() bypasses admin before ever querying
    // it (see comment above), so queuing an unconsumed mockResolvedValueOnce would sit in the
    // mock's call queue and get consumed by a LATER, unrelated findMany() call instead — vi.clearAllMocks()
    // in beforeEach clears call history but not queued Once return values.
    mockPrisma.user.create.mockResolvedValueOnce({ id: 'u-new', ...validBody })

    const res = await postUser(makePost('/api/users', validBody))
    expect(res.status).toBe(201)
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

  // Regression A9 (AUDIT_BUGS.md M5): custom trade config must be resolved and included in the
  // response so the client can hydrate TradeProvider — the server-side registry never reaches
  // the browser's own JS bundle.
  it('includes resolved customTradeConfig when trade is not a built-in TradeId', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ trade: 'transport_medical' })
    mockPrisma.customTrade.findUnique.mockResolvedValue({
      tradeKey: 'transport_medical', tradeName: 'Transport Médical', tradeDescription: '', tradeIcon: '🚑',
      vocabulary: { driver: 'Ambulancier' }, enabledMissionTypes: ['POSER', 'RETIRER'],
    })

    const res = await getSettings(makeGet('/api/settings'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockPrisma.customTrade.findUnique).toHaveBeenCalledWith({ where: { tradeKey: 'transport_medical' } })
    expect(json.customTradeConfig).toBeTruthy()
    expect(json.customTradeConfig.id).toBe('transport_medical')
    expect(json.customTradeConfig.vocabulary.driver).toBe('Ambulancier')
  })

  it('does not look up customTrade when trade is a built-in TradeId', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ trade: 'collecte_recyclage' })

    const res = await getSettings(makeGet('/api/settings'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockPrisma.customTrade.findUnique).not.toHaveBeenCalled()
    expect(json.customTradeConfig).toBeNull()
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

  // Regression A7: hasPermission('view_reports') wired on top of the existing role check.
  // Distinct userIds per test — hasPermission()'s DB lookup is cached per userId for 60s.
  it('dispatcher with no custom UserPermission gets the role default (view_reports included, 200)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'disp-default', role: 'dispatcher', requestId: 'r' } as never)
    mockPrisma.userPermission.findMany.mockResolvedValueOnce([])
    mockPrisma.mission.count.mockResolvedValue(0)
    mockPrisma.plan.count.mockResolvedValue(0)
    mockPrisma.driver.count.mockResolvedValue(0)
    mockPrisma.vehicle.count.mockResolvedValue(0)
    mockPrisma.exutoire.count.mockResolvedValue(0)
    mockPrisma.mission.groupBy.mockResolvedValue([])
    mockPrisma.plan.groupBy.mockResolvedValue([])

    const res = await getReports(makeGet('/api/reports'))
    expect(res.status).toBe(200)
  })

  it('dispatcher with view_reports explicitly revoked gets 403', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'disp-revoked', role: 'dispatcher', requestId: 'r' } as never)
    mockPrisma.userPermission.findMany.mockResolvedValueOnce([{ permission: 'manage_missions' }] as never)

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
