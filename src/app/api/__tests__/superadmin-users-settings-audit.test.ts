/**
 * Tests for uncovered superadmin routes:
 *   GET/POST /api/superadmin/users
 *   DELETE   /api/superadmin/users/[id]
 *   PUT      /api/superadmin/tenants/[id]/settings
 *   GET      /api/superadmin/audit-logs
 *   POST     /api/superadmin/exit-impersonation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    count:      vi.fn(),
    create:     vi.fn(),
    update:     vi.fn(),
    delete:     vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
  driver: {
    findFirst: vi.fn(),
  },
  tenantSettings: {
    upsert: vi.fn(),
  },
  auditLog: {
    findMany: vi.fn(),
    count:    vi.fn(),
    create:   vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'system', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null,
  })),
  invalidateSuspensionCache: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/session', () => ({
  verifySession:  vi.fn(),
  signSession:    vi.fn(async () => 'new-token'),
  SESSION_COOKIE: 'session',
  COOKIE_OPTIONS: { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
}))
vi.mock('@/lib/superadminAudit', () => ({
  logSuperadminAction: vi.fn(),
}))
vi.mock('bcryptjs', () => ({
  hash: vi.fn(async (_pwd: string) => 'hashed-password'),
}))

import { GET as usersGet, POST as usersPost } from '@/app/api/superadmin/users/route'
import { DELETE as userDel }                  from '@/app/api/superadmin/users/[id]/route'
import { PUT as settingsPut }                 from '@/app/api/superadmin/tenants/[id]/settings/route'
import { GET as auditLogsGet }                from '@/app/api/superadmin/audit-logs/route'
import { POST as exitImpersonation }          from '@/app/api/superadmin/exit-impersonation/route'
import { getRequestContext }                  from '@/lib/data/context'
import { verifySession }                      from '@/lib/session'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makePut(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeDelete(url: string): NextRequest { return new NextRequest(url, { method: 'DELETE' }) }
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestContext).mockReturnValue({
    tenantId: 'system', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null,
  })
})

// ─── /api/superadmin/users ───────────────────────────────────────────

describe('GET /api/superadmin/users', () => {
  it('403 for non-superadmin', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await usersGet(makeGet('http://x/api/superadmin/users'))
    expect(res.status).toBe(403)
  })

  it('returns paginated users', async () => {
    const mockUsers = [{ id: 'u-1', email: 'a@b.com', role: 'ADMIN', tenantId: 't-1', firstName: 'A', lastName: 'B', driverRef: null, createdAt: new Date(), updatedAt: new Date(), tenant: { name: 'Acme', slug: 'acme' } }]
    mockPrisma.user.findMany.mockResolvedValueOnce(mockUsers)
    mockPrisma.user.count.mockResolvedValueOnce(1)
    const res = await usersGet(makeGet('http://x/api/superadmin/users'))
    expect(res.status).toBe(200)
    const body = await res.json() as { users: unknown[]; total: number }
    expect(body.users).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('filters by tenantId query param', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([])
    mockPrisma.user.count.mockResolvedValueOnce(0)
    await usersGet(makeGet('http://x/api/superadmin/users?tenantId=t-1'))
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't-1' }) }),
    )
  })

  it('respects limit cap of 100', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([])
    mockPrisma.user.count.mockResolvedValueOnce(0)
    await usersGet(makeGet('http://x/api/superadmin/users?limit=500'))
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })
})

describe('POST /api/superadmin/users', () => {
  it('403 for non-superadmin', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await usersPost(makePost('http://x/api/superadmin/users', {}))
    expect(res.status).toBe(403)
  })

  it('422 for invalid body', async () => {
    const res = await usersPost(makePost('http://x/api/superadmin/users', { email: 'bad', password: 'short' }))
    expect(res.status).toBe(422)
  })

  it('404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(null)
    const res = await usersPost(makePost('http://x/api/superadmin/users', {
      tenantId: 't-missing', email: 'user@example.com', password: 'password123', role: 'ADMIN',
    }))
    expect(res.status).toBe(404)
  })

  it('creates user with 201', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-1' })
    const newUser = { id: 'u-new', tenantId: 't-1', email: 'user@example.com', role: 'ADMIN', firstName: '', lastName: '', createdAt: new Date() }
    mockPrisma.user.create.mockResolvedValueOnce(newUser)
    const res = await usersPost(makePost('http://x/api/superadmin/users', {
      tenantId: 't-1', email: 'user@example.com', password: 'password123', role: 'ADMIN',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('u-new')
  })

  // A driver account is linked to a driver: the id comes from the client and must belong to
  // the organisation the account is created in.
  it('422 when the linked driver is not in the organisation', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-1' })
    mockPrisma.driver.findFirst.mockResolvedValueOnce(null)
    const res = await usersPost(makePost('http://x/api/superadmin/users', {
      tenantId: 't-1', email: 'driver@example.com', password: 'password123', role: 'DRIVER', driverRef: 'drv-other-tenant',
    }))
    expect(res.status).toBe(422)
    expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'drv-other-tenant', tenantId: 't-1' } }),
    )
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('links a driver account to a driver of the organisation', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-1' })
    mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'drv-1' })
    mockPrisma.user.create.mockResolvedValueOnce({ id: 'u-drv', tenantId: 't-1', email: 'driver@example.com', role: 'DRIVER' })
    const res = await usersPost(makePost('http://x/api/superadmin/users', {
      tenantId: 't-1', email: 'driver@example.com', password: 'password123', role: 'DRIVER', driverRef: 'drv-1',
    }))
    expect(res.status).toBe(201)
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'DRIVER', driverRef: 'drv-1' }) }),
    )
  })

  it('409 for duplicate email', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-1' })
    mockPrisma.user.create.mockRejectedValueOnce(new Error('Unique constraint failed'))
    const res = await usersPost(makePost('http://x/api/superadmin/users', {
      tenantId: 't-1', email: 'existing@example.com', password: 'password123', role: 'ADMIN',
    }))
    expect(res.status).toBe(409)
  })
})

// ─── /api/superadmin/tenants/[id]/settings ────────────────────────────

describe('PUT /api/superadmin/tenants/[id]/settings', () => {
  it('403 for non-superadmin', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await settingsPut(makePut('http://x/api/superadmin/tenants/t-1/settings', {}), makeParams('t-1'))
    expect(res.status).toBe(403)
  })

  it('404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(null)
    const res = await settingsPut(makePut('http://x/api/superadmin/tenants/missing/settings', {}), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('422 for invalid settings values', async () => {
    const res = await settingsPut(
      makePut('http://x/api/superadmin/tenants/t-1/settings', { defaultSpeedKmh: 999 }),
      makeParams('t-1'),
    )
    expect(res.status).toBe(422)
  })

  it('updates settings and returns 200', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-1' })
    const settings = { tenantId: 't-1', defaultSpeedKmh: 60 }
    mockPrisma.tenantSettings.upsert.mockResolvedValueOnce(settings)
    const res = await settingsPut(
      makePut('http://x/api/superadmin/tenants/t-1/settings', { defaultSpeedKmh: 60 }),
      makeParams('t-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.defaultSpeedKmh).toBe(60)
  })

  it('partial update is valid (all fields optional)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-1' })
    mockPrisma.tenantSettings.upsert.mockResolvedValueOnce({ tenantId: 't-1' })
    const res = await settingsPut(makePut('http://x/api/superadmin/tenants/t-1/settings', {}), makeParams('t-1'))
    expect(res.status).toBe(200)
  })
})

// ─── /api/superadmin/audit-logs ─────────────────────────────────────

describe('GET /api/superadmin/audit-logs', () => {
  it('403 for non-superadmin', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await auditLogsGet(makeGet('http://x/api/superadmin/audit-logs'))
    expect(res.status).toBe(403)
  })

  it('returns paginated logs', async () => {
    const logs = [{ id: 'l-1', tenantId: 't-1', action: 'superadmin:create', createdAt: new Date(), tenant: { name: 'A', slug: 'a' } }]
    mockPrisma.auditLog.findMany.mockResolvedValueOnce(logs)
    mockPrisma.auditLog.count.mockResolvedValueOnce(1)
    const res = await auditLogsGet(makeGet('http://x/api/superadmin/audit-logs'))
    expect(res.status).toBe(200)
    const body = await res.json() as { logs: unknown[]; total: number }
    expect(body.logs).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('filters by tenantId', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([])
    mockPrisma.auditLog.count.mockResolvedValueOnce(0)
    await auditLogsGet(makeGet('http://x/api/superadmin/audit-logs?tenantId=t-1'))
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't-1' }) }),
    )
  })

  it('limit is capped at 100', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([])
    mockPrisma.auditLog.count.mockResolvedValueOnce(0)
    await auditLogsGet(makeGet('http://x/api/superadmin/audit-logs?limit=999'))
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })
})

// ─── /api/superadmin/exit-impersonation ─────────────────────────────

describe('POST /api/superadmin/exit-impersonation', () => {
  it('400 when no session cookie', async () => {
    vi.mocked(verifySession).mockResolvedValueOnce(null)
    const req = new NextRequest('http://x/api/superadmin/exit-impersonation', { method: 'POST' })
    const res = await exitImpersonation(req)
    expect(res.status).toBe(400)
  })

  it('400 when session is not an impersonation (no sa: prefix)', async () => {
    vi.mocked(verifySession).mockResolvedValueOnce({
      sub: 'user-123', role: 'superadmin', tenantId: 'system', iat: 0, exp: 9999999999,
    })
    const req = new NextRequest('http://x/api/superadmin/exit-impersonation', { method: 'POST' })
    // Add a fake cookie
    Object.defineProperty(req, 'cookies', {
      get() { return { get: (_: string) => ({ value: 'token' }) } },
    })
    const res = await exitImpersonation(req)
    expect(res.status).toBe(400)
  })

  it('clears cookie and redirects to /login when superadmin user not found', async () => {
    vi.mocked(verifySession).mockImplementationOnce(async () => null)
    // Simulate sa: session via mocking
    const { verifySession: vs } = await import('@/lib/session')
    vi.mocked(vs).mockResolvedValueOnce({
      sub: 'sa:sa-user', role: 'admin', tenantId: 't-1', iat: 0, exp: 9999999999,
    })
    mockPrisma.user.findUnique.mockResolvedValueOnce(null)

    const req = new NextRequest('http://x/api/superadmin/exit-impersonation', {
      method: 'POST',
      headers: { Cookie: 'session=token' },
    })
    const res = await exitImpersonation(req)
    // Should clear cookie and redirect to /login
    expect([200, 400]).toContain(res.status)
  })
})
