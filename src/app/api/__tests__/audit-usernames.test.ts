import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockFindMany     = vi.hoisted(() => vi.fn())
const mockCount        = vi.hoisted(() => vi.fn())
const mockUserFindMany = vi.hoisted(() => vi.fn())
const mockAuditDb = vi.hoisted(() => ({
  auditLog: { findMany: mockFindMany, count: mockCount },
  user:     { findMany: mockUserFindMany },
}))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: mockAuditDb,
  getTenantDb:    () => mockAuditDb,
}))
vi.mock('@/lib/superadminAudit', () => ({ logSuperadminAction: vi.fn() }))

import { GET } from '@/app/api/audit/route'

function makeReq(params: string = '', role: string = 'admin'): NextRequest {
  return new NextRequest(`http://localhost/api/audit${params}`, {
    headers: { 'x-tenant-id': 'tenant-abc123', 'x-user-id': 'admin-1', 'x-user-role': role },
  })
}

const LOG_NORMAL = {
  id: 'log-1', tenantId: 'tenant-abc123', userId: 'user-1',
  action: 'driver.update', entityType: 'Driver', entityId: 'd1',
  changes: { firstName: 'Jean' }, createdAt: new Date('2026-08-16T10:00:00Z'),
}
const LOG_IMPERSONATED = {
  id: 'log-2', tenantId: 'tenant-abc123', userId: 'sa:user-2',
  action: 'user.update', entityType: 'User', entityId: 'u1',
  changes: {}, createdAt: new Date('2026-08-16T11:00:00Z'),
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/audit — userName resolution', () => {
  // Regression: found via manual QA — the Audit tab's "Utilisateur" column was blank on
  // every single row for every tenant, because AuditLog only ever stores userId, and this
  // route returned raw log rows with no join to resolve a display name at all.
  it('attaches a resolved userName built from firstName + lastName', async () => {
    mockFindMany.mockResolvedValueOnce([LOG_NORMAL])
    mockCount.mockResolvedValueOnce(1)
    mockUserFindMany.mockResolvedValueOnce([
      { id: 'user-1', firstName: 'Marie', lastName: 'Curie', email: 'marie@test.fr' },
    ])

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.data[0].userName).toBe('Marie Curie')
    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-1'] } },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
  })

  it('strips the sa: superadmin-impersonation prefix before looking the user up', async () => {
    mockFindMany.mockResolvedValueOnce([LOG_IMPERSONATED])
    mockCount.mockResolvedValueOnce(1)
    mockUserFindMany.mockResolvedValueOnce([
      { id: 'user-2', firstName: 'Paul', lastName: 'Durand', email: 'paul@test.fr' },
    ])

    const res = await GET(makeReq())
    const body = await res.json()

    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-2'] } },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    expect(body.data[0].userName).toBe('Paul Durand')
  })

  it('falls back to email when both names are empty', async () => {
    mockFindMany.mockResolvedValueOnce([LOG_NORMAL])
    mockCount.mockResolvedValueOnce(1)
    mockUserFindMany.mockResolvedValueOnce([
      { id: 'user-1', firstName: '', lastName: '', email: 'marie@test.fr' },
    ])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data[0].userName).toBe('marie@test.fr')
  })

  it('falls back to the raw userId when the user no longer exists', async () => {
    mockFindMany.mockResolvedValueOnce([LOG_NORMAL])
    mockCount.mockResolvedValueOnce(1)
    mockUserFindMany.mockResolvedValueOnce([])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.data[0].userName).toBe('user-1')
  })

  it('does not crash on a log entry with no userId', async () => {
    mockFindMany.mockResolvedValueOnce([{ ...LOG_NORMAL, userId: null }])
    mockCount.mockResolvedValueOnce(1)
    mockUserFindMany.mockResolvedValueOnce([])

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data[0].userName).toBe('—')
  })

  it('does not query the User table when there are no log entries', async () => {
    mockFindMany.mockResolvedValueOnce([])
    mockCount.mockResolvedValueOnce(0)

    const res = await GET(makeReq())
    await res.json()
    expect(mockUserFindMany).not.toHaveBeenCalled()
  })

  it('deduplicates repeated userIds into a single lookup query', async () => {
    mockFindMany.mockResolvedValueOnce([LOG_NORMAL, { ...LOG_NORMAL, id: 'log-3' }])
    mockCount.mockResolvedValueOnce(2)
    mockUserFindMany.mockResolvedValueOnce([
      { id: 'user-1', firstName: 'Marie', lastName: 'Curie', email: 'marie@test.fr' },
    ])

    await GET(makeReq())
    expect(mockUserFindMany).toHaveBeenCalledTimes(1)
    expect(mockUserFindMany.mock.calls[0][0].where.id.in).toEqual(['user-1'])
  })

  // Regression: pagination.total, not a nonexistent top-level `total`, is where the real
  // count lives — the Audit tab read `d.total` (always undefined) and silently fell back to
  // the current page's length, so it always displayed e.g. "25/25" no matter how many
  // entries actually existed, with no way to reach anything past page 1.
  it('reports the true total via pagination, not just the current page length', async () => {
    mockFindMany.mockResolvedValueOnce([LOG_NORMAL])
    mockCount.mockResolvedValueOnce(491)
    mockUserFindMany.mockResolvedValueOnce([
      { id: 'user-1', firstName: 'Marie', lastName: 'Curie', email: 'marie@test.fr' },
    ])

    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.pagination.total).toBe(491)
  })
})

// The Audit tab is hidden from dispatchers, but the API answered them: any dispatcher could read
// who did what across the organisation by calling it directly.
describe('GET /api/audit — administrators only', () => {
  it('refuses a dispatcher and a driver without reading anything', async () => {
    mockFindMany.mockClear()
    expect((await GET(makeReq('', 'dispatcher'))).status).toBe(403)
    expect((await GET(makeReq('', 'driver'))).status).toBe(403)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('answers an admin and an impersonating superadmin', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)
    mockUserFindMany.mockResolvedValue([])
    expect((await GET(makeReq('', 'admin'))).status).toBe(200)
    expect((await GET(makeReq('', 'superadmin'))).status).toBe(200)
  })
})
