import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Role defaults from the real permission table (no custom per-user grants in these tests).
vi.mock('@/lib/permissions', async (orig) => {
  const real = await orig<typeof import('@/lib/permissions')>()
  return {
    ...real,
    hasPermission: vi.fn(async (_userId: string, role: string, perm: string) =>
      role === 'admin' || role === 'superadmin' || (real.DEFAULT_PERMISSIONS[role] ?? []).includes(perm as never)),
  }
})

vi.mock('@/lib/sessionRevocation', () => ({
  revokeUserSessions:   vi.fn(async () => undefined),
  forgetSessionVersion: vi.fn(),
  isSessionCurrent:     vi.fn(async () => true),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin' })),
}))
vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn() },
  METRIC:  { API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'new-hash') } }))

const rlAllowed = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => rlAllowed.value) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

const mockUserFindFirst  = vi.hoisted(() => vi.fn())
const mockUserUpdate     = vi.hoisted(() => vi.fn())
const mockFuelDeleteMany = vi.hoisted(() => vi.fn())
const mockMaintDeleteMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    user:              { findFirst: mockUserFindFirst, update: mockUserUpdate },
    fuelRecord:        { deleteMany: mockFuelDeleteMany   },
    maintenanceRecord: { deleteMany: mockMaintDeleteMany  },
  }),
}))

const mockInvalidateAll = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisCache', () => ({
  redisCache: { invalidateAll: mockInvalidateAll },
}))

import { POST as resetPwd }        from '@/app/api/users/[id]/reset-password/route'
import { DELETE as deleteFuel }    from '@/app/api/fuel-records/[id]/route'
import { DELETE as deleteMaint }   from '@/app/api/maintenance/[id]/route'
import { getRequestContext }       from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
function makeReset(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/users/${id}/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function makeDelete(url: string, id: string) {
  return new NextRequest(`http://localhost${url}/${id}`, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  rlAllowed.value = true
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
  mockUserFindFirst.mockResolvedValue({ id: 'user-1', tenantId: 't1' })
  mockUserUpdate.mockResolvedValue({})
  mockFuelDeleteMany.mockResolvedValue({ count: 1 })
  mockMaintDeleteMany.mockResolvedValue({ count: 1 })
  mockInvalidateAll.mockResolvedValue(undefined)
})

// ─── POST /api/users/[id]/reset-password ─────────────────────────────────────

describe('POST /api/users/[id]/reset-password', () => {
  it('returns 403 for non-admin', async () => {
    mockGetCtx.mockReturnValueOnce({ tenantId: 't1', userId: 'u1', role: 'dispatcher', requestId: 'req-123', trade: null })
    const res = await resetPwd(makeReset('user-1', { newPassword: 'newpassword12' }), makeParams('user-1'))
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate limit exceeded — regression: reset-password must be rate limited', async () => {
    rlAllowed.value = false
    const res = await resetPwd(makeReset('user-1', { newPassword: 'mynewpassword12' }), makeParams('user-1'))
    expect(res.status).toBe(429)
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/users/u1/reset-password', {
      method: 'POST',
      body: '{bad',
    })
    const res = await resetPwd(req, makeParams('u1'))
    expect(res.status).toBe(400)
  })

  it('returns 422 when password too short', async () => {
    const res = await resetPwd(makeReset('user-1', { newPassword: 'short' }), makeParams('user-1'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when user not found', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null)
    const res = await resetPwd(makeReset('ghost', { newPassword: 'mynewpassword12' }), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 200 and updates password hash', async () => {
    const res = await resetPwd(makeReset('user-1', { newPassword: 'mynewpassword12' }), makeParams('user-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockUserUpdate.mock.calls[0][0].data.passwordHash).toBe('new-hash')
  })

  it('returns 500 on DB error', async () => {
    mockUserFindFirst.mockRejectedValueOnce(new Error('DB crash'))
    const res = await resetPwd(makeReset('user-1', { newPassword: 'mynewpassword12' }), makeParams('user-1'))
    expect(res.status).toBe(500)
  })
})

// ─── DELETE /api/fuel-records/[id] ───────────────────────────────────────────

describe('DELETE /api/fuel-records/[id]', () => {
  // Changed on purpose: maintenance/fuel follow manage_vehicles (a dispatcher default) like the
  // vehicle itself — dispatchers saw these actions and always got 403. A driver still never may.
  it('returns 403 for a role without manage_vehicles (driver)', async () => {
    mockGetCtx.mockReturnValueOnce({ tenantId: 't1', userId: 'u1', role: 'driver', requestId: 'req-123', trade: null })
    const res = await deleteFuel(makeDelete('/api/fuel-records', 'rec-1'), makeParams('rec-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when record not found (count=0)', async () => {
    mockFuelDeleteMany.mockResolvedValueOnce({ count: 0 })
    const res = await deleteFuel(makeDelete('/api/fuel-records', 'ghost'), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 200 when deleted', async () => {
    const res = await deleteFuel(makeDelete('/api/fuel-records', 'rec-1'), makeParams('rec-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockInvalidateAll).toHaveBeenCalledWith('fuel-records', 't1')
  })

  it('returns 500 on DB error', async () => {
    mockFuelDeleteMany.mockRejectedValueOnce(new Error('DB crash'))
    const res = await deleteFuel(makeDelete('/api/fuel-records', 'rec-1'), makeParams('rec-1'))
    expect(res.status).toBe(500)
  })
})

// ─── DELETE /api/maintenance/[id] ────────────────────────────────────────────

describe('DELETE /api/maintenance/[id]', () => {
  // Changed on purpose: maintenance/fuel follow manage_vehicles (a dispatcher default) like the
  // vehicle itself — dispatchers saw these actions and always got 403. A driver still never may.
  it('returns 403 for a role without manage_vehicles (driver)', async () => {
    mockGetCtx.mockReturnValueOnce({ tenantId: 't1', userId: 'u1', role: 'driver', requestId: 'req-123', trade: null })
    const res = await deleteMaint(makeDelete('/api/maintenance', 'maint-1'), makeParams('maint-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when record not found', async () => {
    mockMaintDeleteMany.mockResolvedValueOnce({ count: 0 })
    const res = await deleteMaint(makeDelete('/api/maintenance', 'ghost'), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 200 when deleted', async () => {
    const res = await deleteMaint(makeDelete('/api/maintenance', 'maint-1'), makeParams('maint-1'))
    expect(res.status).toBe(200)
    expect(mockInvalidateAll).toHaveBeenCalledWith('maintenance', 't1')
  })

  it('returns 500 on DB error', async () => {
    mockMaintDeleteMany.mockRejectedValueOnce(new Error('DB crash'))
    const res = await deleteMaint(makeDelete('/api/maintenance', 'maint-1'), makeParams('maint-1'))
    expect(res.status).toBe(500)
  })
})
