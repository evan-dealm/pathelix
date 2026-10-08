import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/superadminAudit', () => ({ logSuperadminAction: vi.fn() }))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'sa1', role: 'superadmin' })),
}))
vi.mock('bcryptjs', () => ({ hash: vi.fn(async () => 'hashed-pw') }))

const mockUserFindUnique = vi.hoisted(() => vi.fn())
const mockUserUpdate     = vi.hoisted(() => vi.fn())
const mockUserDelete     = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    user: {
      findUnique: mockUserFindUnique,
      update:     mockUserUpdate,
      delete:     mockUserDelete,
    },
  },
}))

import { GET, PUT, DELETE } from '@/app/api/superadmin/users/[id]/route'
import { getRequestContext } from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
function makeGET(id: string) {
  return new NextRequest(`http://localhost/api/superadmin/users/${id}`)
}
function makePUT(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/superadmin/users/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function makeDELETE(id: string) {
  return new NextRequest(`http://localhost/api/superadmin/users/${id}`, { method: 'DELETE' })
}

const USER = { id: 'user-1', email: 'a@b.com', role: 'ADMIN', tenantId: 't2', firstName: 'Alice', lastName: 'X', driverRef: null, createdAt: new Date(), updatedAt: new Date(), tenant: { id: 't2', name: 'ACME', slug: 'acme', plan: 'PRO' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'sa1', role: 'superadmin', requestId: 'req-123', trade: null })
  // PUT reads the target first (role and organisation) to apply the superadmin guards.
  mockUserFindUnique.mockReset()
  mockUserFindUnique.mockResolvedValue({ id: 'user-1', role: 'ADMIN', tenant: { slug: 'acme' } })
})

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/superadmin/users/[id]', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await GET(makeGET('user-1'), makeParams('user-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null)
    const res = await GET(makeGET('ghost'), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 200 with user data', async () => {
    mockUserFindUnique.mockResolvedValueOnce(USER)
    const res = await GET(makeGET('user-1'), makeParams('user-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('a@b.com')
    expect(body.tenant.slug).toBe('acme')
  })

  it('returns 500 on DB error', async () => {
    mockUserFindUnique.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeGET('user-1'), makeParams('user-1'))
    expect(res.status).toBe(500)
  })
})

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/superadmin/users/[id]', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await PUT(makePUT('user-1', { role: 'ADMIN' }), makeParams('user-1'))
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/superadmin/users/user-1', {
      method: 'PUT',
      body: '{bad',
    })
    const res = await PUT(req, makeParams('user-1'))
    expect(res.status).toBe(400)
  })

  it('returns 422 for invalid email', async () => {
    const res = await PUT(makePUT('user-1', { email: 'not-an-email' }), makeParams('user-1'))
    expect(res.status).toBe(422)
  })

  it('returns 200 updating role and name', async () => {
    mockUserUpdate.mockResolvedValueOnce({ id: 'user-1', tenantId: 't2', role: 'DISPATCHER', email: 'a@b.com' })
    const res = await PUT(makePUT('user-1', { role: 'DISPATCHER', firstName: 'Bob' }), makeParams('user-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.role).toBe('DISPATCHER')
  })

  it('hashes password when provided', async () => {
    mockUserUpdate.mockResolvedValueOnce({ id: 'user-1', tenantId: 't2', role: 'ADMIN', email: 'a@b.com' })
    const res = await PUT(makePUT('user-1', { password: 'newpassword123' }), makeParams('user-1'))
    expect(res.status).toBe(200)
    const callData = mockUserUpdate.mock.calls[0][0].data
    expect(callData.passwordHash).toBe('hashed-pw')
    expect(callData.password).toBeUndefined()
  })

  it('returns 404 when user not found', async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error('Record to update not found'))
    const res = await PUT(makePUT('user-1', { firstName: 'X' }), makeParams('user-1'))
    expect(res.status).toBe(404)
  })

  it('returns 404 without writing when the target does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null)
    const res = await PUT(makePUT('ghost', { firstName: 'X' }), makeParams('ghost'))
    expect(res.status).toBe(404)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  // ── superadmin guards ──

  it('refuses a superadmin changing their own role (the last one can never disappear)', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'sa1', role: 'SUPERADMIN', tenant: { slug: 'admin-corp' } })
    const res = await PUT(makePUT('sa1', { role: 'ADMIN' }), makeParams('sa1'))
    expect(res.status).toBe(400)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('lets a superadmin edit their own name without touching the role', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'sa1', role: 'SUPERADMIN', tenant: { slug: 'admin-corp' } })
    mockUserUpdate.mockResolvedValueOnce({ id: 'sa1', tenantId: 't1', role: 'SUPERADMIN', email: 'sa@x.fr' })
    const res = await PUT(makePUT('sa1', { role: 'SUPERADMIN', firstName: 'Zoé' }), makeParams('sa1'))
    expect(res.status).toBe(200)
  })

  it('refuses promoting an account of a client organisation to superadmin', async () => {
    const res = await PUT(makePUT('user-1', { role: 'SUPERADMIN' }), makeParams('user-1'))
    expect(res.status).toBe(422)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('promotes an account of the platform organisation and revokes its sessions', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'user-1', role: 'ADMIN', tenant: { slug: 'admin-corp' } })
    mockUserUpdate.mockResolvedValueOnce({ id: 'user-1', tenantId: 't1', role: 'SUPERADMIN', email: 'a@b.com' })
    const res = await PUT(makePUT('user-1', { role: 'SUPERADMIN' }), makeParams('user-1'))
    expect(res.status).toBe(200)
    expect(mockUserUpdate.mock.calls[0][0].data.sessionVersion).toEqual({ increment: 1 })
  })

  it('refuses a weak password for a superadmin account', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'sa2', role: 'SUPERADMIN', tenant: { slug: 'admin-corp' } })
    for (const password of ['shortA1x', 'longbutlowercase1', 'NoDigitsInThisOne']) {
      const res = await PUT(makePUT('sa2', { password }), makeParams('sa2'))
      expect(res.status, password).toBe(422)
    }
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('accepts a strong password for a superadmin account', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'sa2', role: 'SUPERADMIN', tenant: { slug: 'admin-corp' } })
    mockUserUpdate.mockResolvedValueOnce({ id: 'sa2', tenantId: 't1', role: 'SUPERADMIN', email: 'sa2@x.fr' })
    const res = await PUT(makePUT('sa2', { password: 'Correct7Horse' }), makeParams('sa2'))
    expect(res.status).toBe(200)
  })

  it('returns 500 on other DB error', async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error('Disk full'))
    const res = await PUT(makePUT('user-1', { firstName: 'X' }), makeParams('user-1'))
    expect(res.status).toBe(500)
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/superadmin/users/[id]', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await DELETE(makeDELETE('user-1'), makeParams('user-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null)
    const res = await DELETE(makeDELETE('ghost'), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when deleting own account', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'sa1', email: 'sa@x.com', tenantId: 't1', role: 'SUPERADMIN' })
    const res = await DELETE(makeDELETE('sa1'), makeParams('sa1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/propre compte/)
  })

  it('returns 200 when user deleted', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'user-1', email: 'a@b.com', tenantId: 't2', role: 'ADMIN' })
    mockUserDelete.mockResolvedValueOnce({})
    const res = await DELETE(makeDELETE('user-1'), makeParams('user-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 500 on DB error', async () => {
    mockUserFindUnique.mockRejectedValueOnce(new Error('DB timeout'))
    const res = await DELETE(makeDELETE('user-1'), makeParams('user-1'))
    expect(res.status).toBe(500)
  })
})
