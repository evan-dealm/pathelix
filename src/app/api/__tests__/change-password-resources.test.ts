import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/sessionRevocation', () => ({
  revokeUserSessions:   vi.fn(async () => undefined),
  forgetSessionVersion: vi.fn(),
  isSessionCurrent:     vi.fn(async () => true),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// bcryptjs dynamic import
const mockCompare = vi.hoisted(() => vi.fn(async () => true))
const mockHash    = vi.hoisted(() => vi.fn(async () => 'new-hash'))
vi.mock('bcryptjs', () => ({ compare: mockCompare, hash: mockHash }))

// change-password deps
const mockVerifySession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session', () => ({
  verifySession: mockVerifySession,
  signSession:   vi.fn(async () => 'fresh-token'),
  SESSION_COOKIE: 'session',
  COOKIE_OPTIONS: { httpOnly: true, sameSite: 'strict' as const },
}))

const mockRlCheck = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: vi.fn(() => ({ check: mockRlCheck })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

const mockUserFindFirst = vi.hoisted(() => vi.fn())
const mockUserUpdate    = vi.hoisted(() => vi.fn())

// resources deps
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'sa1', role: 'superadmin' })),
}))

const mockTenantFindUnique  = vi.hoisted(() => vi.fn())
const mockDriverCreate      = vi.hoisted(() => vi.fn())
const mockDriverFindUnique  = vi.hoisted(() => vi.fn())
const mockDriverUpdate      = vi.hoisted(() => vi.fn())
const mockDriverDelete      = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    user:    { findFirst: mockUserFindFirst, update: mockUserUpdate },
    tenant:  { findUnique: mockTenantFindUnique },
    driver:  { create: mockDriverCreate, findUnique: mockDriverFindUnique, update: mockDriverUpdate, delete: mockDriverDelete },
    client:  { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    vehicle: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    exutoire:        { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    site:            { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    mission:         { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    missionTemplate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}))
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    user: { findFirst: mockUserFindFirst, update: mockUserUpdate },
  }),
}))

vi.mock('@/lib/superadminAudit', () => ({
  logSuperadminAction: vi.fn(),
}))

import { POST as changePwd }  from '@/app/api/auth/change-password/route'
import { POST as resources }  from '@/app/api/superadmin/tenants/[id]/resources/route'
import { getRequestContext }  from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makePwd(body: unknown, withCookie = true) {
  const req = new NextRequest('http://localhost/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (withCookie) req.cookies.set('session', 'tok')
  return req
}

function makeRes(tenantId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/superadmin/tenants/${tenantId}/resources`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const VALID_USER = { id: 'u1', tenantId: 't1', passwordHash: '$2b$12$abc' }

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifySession.mockReset()
  mockRlCheck.mockReset()
  mockVerifySession.mockResolvedValue({ sub: 'u1', tenantId: 't1', role: 'admin', iat: 0, exp: 9999 })
  mockRlCheck.mockResolvedValue(true)
  mockUserFindFirst.mockResolvedValue(VALID_USER)
  mockUserUpdate.mockResolvedValue({})
  mockCompare.mockResolvedValue(true)
  mockHash.mockResolvedValue('new-hash')
  mockTenantFindUnique.mockResolvedValue({ id: 'tenant-1' })
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'sa1', role: 'superadmin', requestId: 'req-123', trade: null })
})

// ─── POST /api/auth/change-password ──────────────────────────────────────────

describe('POST /api/auth/change-password', () => {
  it('returns 401 when no session cookie', async () => {
    mockVerifySession.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'a', newPassword: 'b'.repeat(12) }),
    })
    const res = await changePwd(req)
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate limited', async () => {
    mockRlCheck.mockResolvedValueOnce(false)
    const res = await changePwd(makePwd({ currentPassword: 'old', newPassword: 'newpassword123' }))
    expect(res.status).toBe(429)
  })

  it('returns 422 when newPassword too short', async () => {
    const res = await changePwd(makePwd({ currentPassword: 'old', newPassword: 'short' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when user not found', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null)
    const res = await changePwd(makePwd({ currentPassword: 'old', newPassword: 'newpassword123' }))
    expect(res.status).toBe(404)
  })

  it('returns 401 when current password is wrong', async () => {
    mockCompare.mockResolvedValueOnce(false)
    const res = await changePwd(makePwd({ currentPassword: 'wrong', newPassword: 'newpassword123' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/actuel/)
  })

  it('returns 200 when password changed successfully', async () => {
    const res = await changePwd(makePwd({ currentPassword: 'correct', newPassword: 'mynewpassword12' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockHash).toHaveBeenCalledWith('mynewpassword12', 12)
    // sessionVersion bump = every other session of this user is revoked; this device gets a
    // freshly signed cookie instead.
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where:  { id: 'u1' },
      data:   { passwordHash: 'new-hash', sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    })
    expect(res.headers.get('set-cookie')).toContain('session=fresh-token')
  })

  it('returns 500 on DB error', async () => {
    mockUserFindFirst.mockRejectedValueOnce(new Error('DB down'))
    const res = await changePwd(makePwd({ currentPassword: 'old', newPassword: 'newpassword123' }))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/superadmin/tenants/[id]/resources ─────────────────────────────

// A create now names the required columns it is missing (422) instead of reaching the database:
// the tests that exercise the write send a complete driver.
const FULL_DRIVER = { firstName: 'Test', lastName: 'Driver', sector: 'Annecy', depotName: 'Dépôt', depotLat: 45.9, depotLng: 6.12 }

describe('POST /api/superadmin/tenants/[id]/resources', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValueOnce({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'create', data: { firstName: 'X' } }), makeParams('t1'))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid entity', async () => {
    const res = await resources(makeRes('t1', { entity: 'unknown', action: 'create' }), makeParams('t1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when tenant not found', async () => {
    mockTenantFindUnique.mockResolvedValueOnce(null)
    const res = await resources(makeRes('ghost', { entity: 'driver', action: 'create', data: {} }), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 422 when create without data', async () => {
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'create' }), makeParams('t1'))
    expect(res.status).toBe(422)
  })

  it('returns 200 on create driver', async () => {
    mockDriverCreate.mockResolvedValueOnce({ id: 'drv-1', name: 'Test Driver' })
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'create', data: FULL_DRIVER }), makeParams('t1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockDriverCreate).toHaveBeenCalledOnce()
    const createData = mockDriverCreate.mock.calls[0][0].data
    expect(createData.tenantId).toBe('t1')
  })

  it('returns 422 when update without id', async () => {
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'update', data: { firstName: 'X' } }), makeParams('t1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when update resource not in tenant', async () => {
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 'other-tenant' })
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'update', id: 'drv-1', data: { firstName: 'X' } }), makeParams('t1'))
    expect(res.status).toBe(404)
  })

  it('returns 200 on update driver', async () => {
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1' })
    mockDriverUpdate.mockResolvedValueOnce({ id: 'drv-1', name: 'Updated' })
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'update', id: 'drv-1', data: { firstName: 'Updated' } }), makeParams('t1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 422 when delete without id', async () => {
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'delete' }), makeParams('t1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when delete resource not found', async () => {
    mockDriverFindUnique.mockResolvedValueOnce(null)
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'delete', id: 'ghost' }), makeParams('t1'))
    expect(res.status).toBe(404)
  })

  it('returns 200 on delete driver', async () => {
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1' })
    mockDriverDelete.mockResolvedValueOnce({})
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'delete', id: 'drv-1' }), makeParams('t1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 500 on DB error', async () => {
    mockDriverCreate.mockRejectedValueOnce(new Error('DB crash'))
    const res = await resources(makeRes('t1', { entity: 'driver', action: 'create', data: FULL_DRIVER }), makeParams('t1'))
    expect(res.status).toBe(500)
  })
})
