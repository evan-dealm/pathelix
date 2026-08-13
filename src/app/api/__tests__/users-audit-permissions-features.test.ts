import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
  },
  userPermission: {
    findMany:   vi.fn(),
    deleteMany: vi.fn(),
    create:     vi.fn(),
  },
  auditLog: {
    findMany:   vi.fn(),
    count:      vi.fn(),
    deleteMany: vi.fn(),
  },
  apiKey: {
    findMany: vi.fn(),
    create:   vi.fn(),
  },
  tenantSettings: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
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

vi.mock('@/lib/permissions', () => ({
  ALL_PERMISSIONS:        ['read:missions', 'write:missions', 'read:drivers'],
  DEFAULT_PERMISSIONS:    { admin: ['read:missions', 'write:missions'], dispatcher: ['read:missions'] },
  invalidatePermCache:    vi.fn(),
  hasPermission:          vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlags:      vi.fn().mockResolvedValue({ advancedOptimization: true, exportPDF: false }),
  invalidateFlagsCache: vi.fn(),
}))

vi.mock('@/lib/demandPrediction', () => ({
  predictDemand: vi.fn().mockResolvedValue([
    { date: '2026-05-01', exutoireId: 'e-1', probability: 0.82 },
  ]),
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('$hashed$') },
}))

vi.mock('@/lib/audit', () => ({ auditAsync: vi.fn() }))
vi.mock('@/lib/superadminAudit', () => ({ logSuperadminAction: vi.fn() }))

import { GET as userGET, PUT as userPUT, DELETE as userDELETE } from '@/app/api/users/[id]/route'
import { GET as auditGET, DELETE as auditDELETE } from '@/app/api/audit/route'
import { GET as permsGET, PUT as permsPUT }        from '@/app/api/permissions/route'
import { GET as keysGET, POST as keysPOST }        from '@/app/api/api-keys/route'
import { GET as featGET, PUT as featPUT }           from '@/app/api/features/route'
import { GET as predictGET }                        from '@/app/api/predictions/route'
import { getRequestContext }                        from '@/lib/data/context'
import { auditAsync }                               from '@/lib/audit'
import { logSuperadminAction }                      from '@/lib/superadminAudit'

function makeGet(url: string): NextRequest { return new NextRequest(url) }

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makePut(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeBadJson(url: string, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: '{bad',
  })
}

function makeDeleteReq(url: string): NextRequest {
  return new NextRequest(url, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const sampleUser = {
  id: 'u-1', tenantId: 'tenant-test', email: 'jean@example.com', role: 'admin',
  firstName: 'Jean', lastName: 'Dupont', driverRef: null, createdAt: new Date(), updatedAt: new Date(),
}

describe('GET /api/users/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns user (200)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)

    const res  = await userGET(makeGet('http://localhost:3000/api/users/u-1'), makeParams('u-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.email).toBe('jean@example.com')
  })

  it('returns 404 when not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const res = await userGET(makeGet('http://localhost:3000/api/users/nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB fail'))

    const res = await userGET(makeGet('http://localhost:3000/api/users/u-1'), makeParams('u-1'))
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/users/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates user (200)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    mockPrisma.user.update.mockResolvedValue({ ...sampleUser, firstName: 'Pierre' })

    const res  = await userPUT(makePut('http://localhost:3000/api/users/u-1', { firstName: 'Pierre' }), makeParams('u-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.firstName).toBe('Pierre')
  })

  // Phase 0.1 (this session's follow-up mission): POST/PUT/DELETE /api/users never wrote to
  // AuditLog, before or after the A7/N22 privilege-escalation fix — a role change (or a user
  // creation) left no queryable trace of who did it. Fixed by wiring auditAsync() in, same
  // pattern as drivers/missions/vehicles.
  it('logs a role change to the audit trail with before/after values', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser) // role: 'admin'
    mockPrisma.user.update.mockResolvedValue({ ...sampleUser, role: 'DISPATCHER' })

    await userPUT(makePut('http://localhost:3000/api/users/u-1', { role: 'DISPATCHER' }), makeParams('u-1'))

    expect(auditAsync).toHaveBeenCalledWith(
      expect.anything(), 'user.update', 'User', 'u-1',
      expect.objectContaining({ roleBefore: 'admin', roleAfter: 'DISPATCHER' }),
    )
  })

  it('does not claim a role change when role is unchanged', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    mockPrisma.user.update.mockResolvedValue({ ...sampleUser, firstName: 'Pierre' })

    await userPUT(makePut('http://localhost:3000/api/users/u-1', { firstName: 'Pierre' }), makeParams('u-1'))

    const call = vi.mocked(auditAsync).mock.calls[0]
    expect(call[4]).not.toHaveProperty('roleBefore')
  })

  it('returns 403 for dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await userPUT(makePut('http://localhost:3000/api/users/u-1', { firstName: 'X' }), makeParams('u-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const res = await userPUT(makePut('http://localhost:3000/api/users/nope', { firstName: 'X' }), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await userPUT(makeBadJson('http://localhost:3000/api/users/u-1', 'PUT'), makeParams('u-1'))
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate email (P2002)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    const err = Object.assign(new Error('Unique'), { code: 'P2002' })
    mockPrisma.user.update.mockRejectedValue(err)

    const res = await userPUT(makePut('http://localhost:3000/api/users/u-1', { email: 'other@x.com' }), makeParams('u-1'))
    expect(res.status).toBe(409)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    mockPrisma.user.update.mockRejectedValue(new Error('DB fail'))

    const res = await userPUT(makePut('http://localhost:3000/api/users/u-1', { firstName: 'X' }), makeParams('u-1'))
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/users/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes user (200)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    mockPrisma.user.delete.mockResolvedValue(sampleUser)

    const res  = await userDELETE(makeDeleteReq('http://localhost:3000/api/users/u-1'), makeParams('u-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 403 for dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await userDELETE(makeDeleteReq('http://localhost:3000/api/users/u-1'), makeParams('u-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const res = await userDELETE(makeDeleteReq('http://localhost:3000/api/users/nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    mockPrisma.user.delete.mockRejectedValue(new Error('DB fail'))

    const res = await userDELETE(makeDeleteReq('http://localhost:3000/api/users/u-1'), makeParams('u-1'))
    expect(res.status).toBe(500)
  })

  it('logs the deletion to the audit trail', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(sampleUser)
    mockPrisma.user.delete.mockResolvedValue(sampleUser)

    await userDELETE(makeDeleteReq('http://localhost:3000/api/users/u-1'), makeParams('u-1'))

    expect(auditAsync).toHaveBeenCalledWith(
      expect.anything(), 'user.delete', 'User', 'u-1',
      expect.objectContaining({ email: sampleUser.email, role: sampleUser.role }),
    )
  })
})

describe('GET /api/audit', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated audit logs (200)', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      { id: 'al-1', action: 'driver.update', tenantId: 'tenant-test', createdAt: new Date() },
    ])
    mockPrisma.auditLog.count.mockResolvedValue(1)

    const res  = await auditGET(makeGet('http://localhost:3000/api/audit'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.pagination.total).toBe(1)
  })

  it('filters by entityType param', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([])
    mockPrisma.auditLog.count.mockResolvedValue(0)

    await auditGET(makeGet('http://localhost:3000/api/audit?entityType=Driver'))

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: 'Driver' }) })
    )
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await auditGET(makeGet('http://localhost:3000/api/audit'))
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/audit', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes logs in range for superadmin (200)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'sa', role: 'superadmin', requestId: 'r' } as never)
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 5 })

    const res  = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z&confirm=true'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.deleted).toBe(5)
  })

  it('[SEC-C2] returns 403 for admin (only superadmin can purge)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r' } as never)

    const res = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z&confirm=true'))
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z&confirm=true'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when before/after missing', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'sa', role: 'superadmin', requestId: 'r' } as never)
    const res = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?confirm=true'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when confirm not true', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'sa', role: 'superadmin', requestId: 'r' } as never)
    const res = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when date range exceeds 90 days', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'sa', role: 'superadmin', requestId: 'r' } as never)
    const res = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-06-01T00:00:00Z&confirm=true'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error (superadmin)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'sa', role: 'superadmin', requestId: 'r' } as never)
    mockPrisma.auditLog.deleteMany.mockRejectedValue(new Error('DB fail'))

    const res = await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z&confirm=true'))
    expect(res.status).toBe(500)
  })

  // Phase 0.1: a superadmin purging the audit trail (DELETE /api/audit) previously left no
  // trace of the purge itself anywhere durable — only an app-level log line. Now recorded via
  // the same logSuperadminAction() path used by other superadmin actions.
  it('records the purge itself via logSuperadminAction', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'sa', role: 'superadmin', requestId: 'r' } as never)
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 5 })

    await auditDELETE(makeDeleteReq('http://localhost:3000/api/audit?after=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z&confirm=true'))

    expect(logSuperadminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        superadminId: 'sa',
        targetTenantId: 'tenant-test',
        action: 'audit_log_purge',
        details: expect.objectContaining({ deletedCount: 5 }),
      }),
    )
  })
})

describe('GET /api/permissions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns all permissions when no userId param (200)', async () => {
    const res  = await permsGET(makeGet('http://localhost:3000/api/permissions'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.allPermissions).toBeDefined()
    expect(json.defaults).toBeDefined()
  })

  it('returns user-specific permissions (200)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-1', role: 'dispatcher' })
    mockPrisma.userPermission.findMany.mockResolvedValue([{ permission: 'read:missions' }])

    const res  = await permsGET(makeGet('http://localhost:3000/api/permissions?userId=u-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.userId).toBe('u-1')
    expect(json.permissions).toContain('read:missions')
    expect(json.isCustom).toBe(true)
  })

  it('returns role defaults when no custom perms', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-1', role: 'admin' })
    mockPrisma.userPermission.findMany.mockResolvedValue([])

    const res  = await permsGET(makeGet('http://localhost:3000/api/permissions?userId=u-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.isCustom).toBe(false)
  })

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const res = await permsGET(makeGet('http://localhost:3000/api/permissions?userId=nope'))
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/permissions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates permissions (200)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-2', role: 'dispatcher' })
    mockPrisma.userPermission.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.userPermission.create.mockResolvedValue({ permission: 'read:missions' })
    mockPrisma.$transaction.mockResolvedValue([])

    const res  = await permsPUT(makePut('http://localhost:3000/api/permissions', { userId: 'u-2', permissions: ['read:missions'] }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.userId).toBe('u-2')
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await permsPUT(makePut('http://localhost:3000/api/permissions', { userId: 'u-2', permissions: [] }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const res = await permsPUT(makePut('http://localhost:3000/api/permissions', { userId: 'nope', permissions: ['read:missions'] }))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await permsPUT(makeBadJson('http://localhost:3000/api/permissions', 'PUT'))
    expect(res.status).toBe(400)
  })

  it('logs the permission change to the audit trail', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-2', role: 'dispatcher' })
    mockPrisma.userPermission.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.userPermission.create.mockResolvedValue({ permission: 'read:missions' })
    mockPrisma.$transaction.mockResolvedValue([])

    await permsPUT(makePut('http://localhost:3000/api/permissions', { userId: 'u-2', permissions: ['read:missions'] }))

    expect(auditAsync).toHaveBeenCalledWith(
      expect.anything(), 'user.permissions_update', 'User', 'u-2',
      expect.objectContaining({ permissions: ['read:missions'] }),
    )
  })
})

describe('GET /api/api-keys', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns api keys (200)', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([
      { id: 'k-1', name: 'CI key', prefix: 'ef_live_abc', scopes: ['read'], lastUsedAt: null, expiresAt: null, createdAt: new Date() },
    ])

    const res  = await keysGET(makeGet('http://localhost:3000/api/api-keys'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
    expect(json[0].name).toBe('CI key')
  })

  it('returns 403 for dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await keysGET(makeGet('http://localhost:3000/api/api-keys'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/api-keys', () => {
  const validBody = { name: 'Test key', scopes: ['missions:read'] }

  beforeEach(() => { vi.clearAllMocks() })

  it('creates api key and returns token once (201)', async () => {
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'k-1', name: 'Test key', prefix: 'ef_live_test1234', scopes: ['missions:read'], expiresAt: null, createdAt: new Date(),
    })

    const res  = await keysPOST(makePost('http://localhost:3000/api/api-keys', validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.token).toMatch(/^ef_live_/)
    expect(json.message).toContain('Copiez')
  })

  it('returns 403 for dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await keysPOST(makePost('http://localhost:3000/api/api-keys', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 422 for missing scopes', async () => {
    const res = await keysPOST(makePost('http://localhost:3000/api/api-keys', { name: 'Test' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await keysPOST(makeBadJson('http://localhost:3000/api/api-keys'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/features', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns feature flags (200)', async () => {
    const res  = await featGET(makeGet('http://localhost:3000/api/features'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.flags).toBeDefined()
    expect(typeof json.flags.advancedOptimization).toBe('boolean')
  })
})

describe('PUT /api/features', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates features (200)', async () => {
    mockPrisma.tenantSettings.upsert.mockResolvedValue({ tenantId: 'tenant-test', features: { advancedOptimization: false } })

    const res  = await featPUT(makePut('http://localhost:3000/api/features', { advancedOptimization: false }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.flags).toBeDefined()
  })

  it('returns 403 for dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await featPUT(makePut('http://localhost:3000/api/features', { advancedOptimization: false }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for non-boolean values', async () => {
    const res = await featPUT(makePut('http://localhost:3000/api/features', { advancedOptimization: 'yes' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await featPUT(makeBadJson('http://localhost:3000/api/features', 'PUT'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/predictions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns predictions (200)', async () => {
    const res  = await predictGET(makeGet('http://localhost:3000/api/predictions'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.predictions).toBeDefined()
    expect(Array.isArray(json.predictions)).toBe(true)
  })

  it('returns 500 when predictDemand throws', async () => {
    const { predictDemand } = await import('@/lib/demandPrediction')
    vi.mocked(predictDemand).mockRejectedValueOnce(new Error('ML fail'))

    const res = await predictGET(makeGet('http://localhost:3000/api/predictions'))
    expect(res.status).toBe(500)
  })
})
