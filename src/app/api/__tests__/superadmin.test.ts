/**
 * Tests for superadmin routes:
 *   GET/POST /api/superadmin/tenants
 *   GET/PUT/DELETE /api/superadmin/tenants/[id]
 *   POST /api/superadmin/tenants/[id]/suspend
 *   POST /api/superadmin/tenants/[id]/activate
 *   GET  /api/superadmin/stats
 *   POST /api/superadmin/impersonate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/sessionRevocation', () => ({
  revokeUserSessions:   vi.fn(async () => undefined),
  forgetSessionVersion: vi.fn(),
  isSessionCurrent:     vi.fn(async () => true),
}))

const mockPrisma = vi.hoisted(() => ({
  tenant: {
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    create:     vi.fn(),
    update:     vi.fn(),
    delete:     vi.fn(),
    count:      vi.fn(),
    groupBy:    vi.fn(),
  },
  user:        { count: vi.fn(), findUnique: vi.fn(async () => ({ sessionVersion: 0 })) },
  driver:      { count: vi.fn() },
  mission:     { count: vi.fn(), groupBy: vi.fn() },
  vehicle:     { count: vi.fn() },
  plan:        { count: vi.fn(), groupBy: vi.fn() },
  exutoire:    { count: vi.fn() },
  client:      { count: vi.fn() },
  site:        { count: vi.fn() },
  auditLog:    { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'system', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'system'),
  invalidateSuspensionCache: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/session', () => ({
  signSession:              vi.fn(async () => 'signed-token'),
  SESSION_COOKIE:           'session',
  COOKIE_OPTIONS:           { httpOnly: true, secure: true, sameSite: 'strict' },
  revokeSessionsForTenant:  vi.fn(),
  unrevokeSessionsForTenant: vi.fn(),
}))

vi.mock('@/lib/superadminAudit', () => ({
  logSuperadminAction: vi.fn(),
}))

import { GET as tenantsGet, POST as tenantsPost }              from '@/app/api/superadmin/tenants/route'
import { GET as tenantGet, PUT as tenantPut, DELETE as tenantDel } from '@/app/api/superadmin/tenants/[id]/route'
import { POST as activatePost }                                from '@/app/api/superadmin/tenants/[id]/activate/route'
import { POST as suspendPost }                                 from '@/app/api/superadmin/tenants/[id]/suspend/route'
import { GET as statsGet }                                     from '@/app/api/superadmin/stats/route'
import { POST as impersonatePost }                             from '@/app/api/superadmin/impersonate/route'
import { getRequestContext }                                   from '@/lib/data/context'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makePut(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeDelete(url: string): NextRequest { return new NextRequest(url, { method: 'DELETE' }) }
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

const mockTenant = {
  id: 't-1', name: 'Acme Corp', slug: 'acme', plan: 'PRO', trade: null,
  maxDrivers: null, maxMissions: null, suspendedAt: null, suspendedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
  _count: { users: 2, drivers: 5, missions: 100, vehicles: 3, plans: 10 },
}

// ── GET /api/superadmin/tenants ───────────────────────────────────────────────

describe('GET /api/superadmin/tenants', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns tenants list with stats (200)', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([mockTenant])
    const res  = await tenantsGet(makeGet('http://localhost/api/superadmin/tenants'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json)).toBe(true)
    expect(json[0].slug).toBe('acme')
    expect(json[0].stats.users).toBe(2)
  })

  it('returns empty array when no tenants', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([])
    const res  = await tenantsGet(makeGet('http://localhost/api/superadmin/tenants'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toHaveLength(0)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenant.findMany.mockRejectedValue(new Error('DB fail'))
    const res = await tenantsGet(makeGet('http://localhost/api/superadmin/tenants'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/superadmin/tenants ──────────────────────────────────────────────

describe('POST /api/superadmin/tenants', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates tenant (201)', async () => {
    mockPrisma.tenant.create.mockResolvedValue({ id: 't-new', name: 'New Corp', slug: 'new-corp', plan: 'FREE', createdAt: new Date() })
    const res  = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', { name: 'New Corp', slug: 'new-corp' }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.slug).toBe('new-corp')
  })

  // An organisation created without any account was unusable: nobody could log in to it.
  it('creates the first administrator account with the organisation, password hashed', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null as never)
    mockPrisma.tenant.create.mockResolvedValue({ id: 't-new', name: 'New Corp', slug: 'new-corp', plan: 'FREE', createdAt: new Date() })
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', {
      name: 'New Corp', slug: 'new-corp',
      admin: { email: 'Boss@New-Corp.fr', password: 'motdepasse-solide', firstName: 'Léa' },
    }))
    expect(res.status).toBe(201)
    const arg = mockPrisma.tenant.create.mock.calls[0][0] as { data: { users: { create: Record<string, string> } } }
    expect(arg.data.users.create).toMatchObject({ email: 'boss@new-corp.fr', role: 'ADMIN', firstName: 'Léa', lastName: '' })
    expect(arg.data.users.create.passwordHash).not.toContain('motdepasse-solide')
  })

  it('refuses an administrator email already used by another account (409), creating nothing', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u-existing' } as never)
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', {
      name: 'New Corp', slug: 'new-corp', admin: { email: 'taken@example.com', password: 'motdepasse-solide' },
    }))
    expect(res.status).toBe(409)
    expect(mockPrisma.tenant.create).not.toHaveBeenCalled()
  })

  it('refuses an administrator password under 8 characters (422)', async () => {
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', {
      name: 'New Corp', slug: 'new-corp', admin: { email: 'boss@example.com', password: 'court' },
    }))
    expect(res.status).toBe(422)
    expect(mockPrisma.tenant.create).not.toHaveBeenCalled()
  })

  it('returns 409 for duplicate slug', async () => {
    mockPrisma.tenant.create.mockRejectedValue(new Error('Unique constraint failed'))
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', { name: 'Dup', slug: 'existing-slug' }))
    expect(res.status).toBe(409)
  })

  it('returns 422 for slug with uppercase letters', async () => {
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', { name: 'Test', slug: 'Invalid-Slug' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for slug too short (< 2 chars)', async () => {
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', { name: 'Test', slug: 'x' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid plan value', async () => {
    const res = await tenantsPost(makePost('http://localhost/api/superadmin/tenants', { name: 'Test', slug: 'test', plan: 'INVALID' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/superadmin/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await tenantsPost(req)
    expect(res.status).toBe(400)
  })
})

// ── GET /api/superadmin/tenants/[id] ──────────────────────────────────────────

describe('GET /api/superadmin/tenants/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns tenant detail (200)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...mockTenant,
      users: [{ id: 'u-1', email: 'admin@acme.com', role: 'admin', firstName: 'Alice', lastName: 'A', createdAt: new Date() }],
      settings: null,
      _count: { drivers: 5, missions: 100, vehicles: 3, plans: 10, exutoires: 2, clients: 20, sites: 15, auditLogs: 300 },
    })
    mockPrisma.mission.count.mockResolvedValue(10)
    mockPrisma.plan.count.mockResolvedValue(5)
    mockPrisma.auditLog.findMany.mockResolvedValue([])

    // This route has 3 prisma calls in Promise.all - all need to be mocked
    mockPrisma.mission.count
      .mockResolvedValueOnce(10)  // recentMissions
    mockPrisma.plan.count
      .mockResolvedValueOnce(5)   // recentPlans
    mockPrisma.auditLog.findMany
      .mockResolvedValueOnce([])  // recentAudit... actually count
    mockPrisma.auditLog.count.mockResolvedValue(300)

    const res  = await tenantGet(makeGet('http://localhost/api/superadmin/tenants/t-1'), makeParams('t-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.slug).toBe('acme')
  })

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const res = await tenantGet(makeGet('http://localhost/api/superadmin/tenants/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const res = await tenantGet(makeGet('http://localhost/api/superadmin/tenants/t-1'), makeParams('t-1'))
    expect(res.status).toBe(500)
  })
})

// ── PUT /api/superadmin/tenants/[id] ──────────────────────────────────────────

describe('PUT /api/superadmin/tenants/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates tenant (200)', async () => {
    mockPrisma.tenant.update.mockResolvedValue({ ...mockTenant, name: 'Updated Corp' })
    const res  = await tenantPut(makePut('http://localhost/api/superadmin/tenants/t-1', { name: 'Updated Corp' }), makeParams('t-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.name).toBe('Updated Corp')
  })

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.update.mockRejectedValue(new Error('Record to update not found'))
    const res = await tenantPut(makePut('http://localhost/api/superadmin/tenants/missing', { name: 'X' }), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid plan', async () => {
    const res = await tenantPut(makePut('http://localhost/api/superadmin/tenants/t-1', { plan: 'INVALID' }), makeParams('t-1'))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/superadmin/tenants/t-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await tenantPut(req, makeParams('t-1'))
    expect(res.status).toBe(400)
  })
})

// ── DELETE /api/superadmin/tenants/[id] ───────────────────────────────────────

describe('DELETE /api/superadmin/tenants/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // Deleting cascades to every row of the organisation: the slug must be repeated.
  it.each(['', '?confirm=true', '?confirm=other-slug'])('refuses (400) without the matching slug: "%s"', async query => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, _count: { users: 0, drivers: 0, missions: 0 } })
    const res = await tenantDel(makeDelete(`http://localhost/api/superadmin/tenants/t-1${query}`), makeParams('t-1'))
    expect(res.status).toBe(400)
    expect(mockPrisma.tenant.delete).not.toHaveBeenCalled()
  })

  it('never deletes the platform organisation (409), even confirmed', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, slug: 'admin-corp', _count: { users: 1, drivers: 0, missions: 0 } })
    const res = await tenantDel(makeDelete('http://localhost/api/superadmin/tenants/t-1?confirm=admin-corp'), makeParams('t-1'))
    expect(res.status).toBe(409)
    expect(mockPrisma.tenant.delete).not.toHaveBeenCalled()
  })

  it('deletes tenant and returns ok (200)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, _count: { users: 0, drivers: 0, missions: 0 } })
    mockPrisma.tenant.delete.mockResolvedValue({ id: 't-1' })
    const res  = await tenantDel(makeDelete('http://localhost/api/superadmin/tenants/t-1?confirm=acme'), makeParams('t-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('still deletes tenant that has active resources (with warning logged)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, _count: { users: 2, drivers: 5, missions: 100 } })
    mockPrisma.tenant.delete.mockResolvedValue({ id: 't-1' })
    const res = await tenantDel(makeDelete('http://localhost/api/superadmin/tenants/t-1?confirm=acme'), makeParams('t-1'))
    expect(res.status).toBe(200)
  })

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const res = await tenantDel(makeDelete('http://localhost/api/superadmin/tenants/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const res = await tenantDel(makeDelete('http://localhost/api/superadmin/tenants/t-1?confirm=acme'), makeParams('t-1'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/superadmin/tenants/[id]/suspend ─────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/suspend', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('suspends active tenant (200)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, suspendedAt: null })
    mockPrisma.tenant.update.mockResolvedValue({ ...mockTenant, suspendedAt: new Date() })
    const res  = await suspendPost(makePost('http://localhost/api/superadmin/tenants/t-1/suspend', {}), makeParams('t-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.suspendedAt).toBeDefined()
  })

  it('returns 409 when tenant already suspended', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, suspendedAt: new Date() })
    const res = await suspendPost(makePost('http://localhost/api/superadmin/tenants/t-1/suspend', {}), makeParams('t-1'))
    expect(res.status).toBe(409)
  })

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const res = await suspendPost(makePost('http://localhost/api/superadmin/tenants/missing/suspend', {}), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const res = await suspendPost(makePost('http://localhost/api/superadmin/tenants/t-1/suspend', {}), makeParams('t-1'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/superadmin/tenants/[id]/activate ────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/activate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('activates suspended tenant (200)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, suspendedAt: new Date('2026-05-01') })
    mockPrisma.tenant.update.mockResolvedValue({ ...mockTenant, suspendedAt: null })
    const res  = await activatePost(makePost('http://localhost/api/superadmin/tenants/t-1/activate', {}), makeParams('t-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 409 when tenant already active', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, suspendedAt: null })
    const res = await activatePost(makePost('http://localhost/api/superadmin/tenants/t-1/activate', {}), makeParams('t-1'))
    expect(res.status).toBe(409)
  })

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const res = await activatePost(makePost('http://localhost/api/superadmin/tenants/missing/activate', {}), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const res = await activatePost(makePost('http://localhost/api/superadmin/tenants/t-1/activate', {}), makeParams('t-1'))
    expect(res.status).toBe(500)
  })
})

// ── GET /api/superadmin/stats ─────────────────────────────────────────────────

describe('GET /api/superadmin/stats', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns global stats for superadmin (200)', async () => {
    mockPrisma.tenant.count.mockResolvedValue(10)
    mockPrisma.user.count.mockResolvedValue(50)
    mockPrisma.driver.count.mockResolvedValue(100)
    mockPrisma.mission.count.mockResolvedValue(5000)
    mockPrisma.vehicle.count.mockResolvedValue(200)
    mockPrisma.plan.count.mockResolvedValue(1000)
    mockPrisma.tenant.groupBy.mockResolvedValue([])
    mockPrisma.mission.groupBy.mockResolvedValue([])
    mockPrisma.plan.groupBy.mockResolvedValue([])
    mockPrisma.tenant.findMany.mockResolvedValue([])
    mockPrisma.exutoire.count.mockResolvedValue(30)
    mockPrisma.client.count.mockResolvedValue(200)
    mockPrisma.site.count.mockResolvedValue(150)
    mockPrisma.auditLog.findMany.mockResolvedValue([])

    const res  = await statsGet(makeGet('http://localhost/api/superadmin/stats'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.global.totalTenants).toBe(10)
    expect(json.global.totalMissions).toBe(5000)
    expect(Array.isArray(json.dailyActivity)).toBe(true)
    expect(json.dailyActivity.length).toBe(14)
  })

  it('returns 403 for admin role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null })
    const res = await statsGet(makeGet('http://localhost/api/superadmin/stats'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'system', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null })
    mockPrisma.tenant.count.mockRejectedValue(new Error('DB fail'))
    const res = await statsGet(makeGet('http://localhost/api/superadmin/stats'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/superadmin/impersonate ─────────────────────────────────────────

describe('POST /api/superadmin/impersonate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates impersonation session and sets cookie (200)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't-1', name: 'Acme Corp', slug: 'acme', trade: null })
    mockPrisma.auditLog.create.mockResolvedValue({})
    const res  = await impersonatePost(makePost('http://localhost/api/superadmin/impersonate', { tenantId: 't-1' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.redirectTo).toBe('/admin')
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toContain('session=')
  })

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const res = await impersonatePost(makePost('http://localhost/api/superadmin/impersonate', { tenantId: 'missing' }))
    expect(res.status).toBe(404)
  })

  it('returns 422 when tenantId missing', async () => {
    const res = await impersonatePost(makePost('http://localhost/api/superadmin/impersonate', {}))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/superadmin/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await impersonatePost(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const res = await impersonatePost(makePost('http://localhost/api/superadmin/impersonate', { tenantId: 't-1' }))
    expect(res.status).toBe(500)
  })
})
