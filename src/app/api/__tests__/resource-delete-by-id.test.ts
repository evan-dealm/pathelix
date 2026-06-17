/**
 * Tests for individual resource DELETE endpoints:
 *   DELETE /api/fuel-records/[id]
 *   DELETE /api/maintenance/[id]
 *   DELETE /api/mission-comments/[id]
 *   DELETE /api/holidays/[id]
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  fuelRecord:        { deleteMany: vi.fn() },
  maintenanceRecord: { deleteMany: vi.fn() },
  missionComment:    { findFirst: vi.fn(), deleteMany: vi.fn() },
  holiday:           { findFirst: vi.fn(), delete: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: { invalidateAll: vi.fn() },
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn() },
  METRIC:  { API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))

import { DELETE as fuelDelete }    from '@/app/api/fuel-records/[id]/route'
import { DELETE as maintenanceDel } from '@/app/api/maintenance/[id]/route'
import { DELETE as commentDel }    from '@/app/api/mission-comments/[id]/route'
import { DELETE as holidayDel }    from '@/app/api/holidays/[id]/route'
import { getRequestContext }       from '@/lib/data/context'

function makeDelete(url: string) {
  return new NextRequest(url, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ── DELETE /api/fuel-records/[id] ────────────────────────────────────────────

describe('DELETE /api/fuel-records/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null }) })

  it('deletes fuel record and returns ok (200)', async () => {
    mockPrisma.fuelRecord.deleteMany.mockResolvedValue({ count: 1 })
    const res  = await fuelDelete(makeDelete('http://localhost/api/fuel-records/f-1'), makeParams('f-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockPrisma.fuelRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'f-1', tenantId: 'tenant-1' } })
  })

  it('returns 404 when record not found (count=0)', async () => {
    mockPrisma.fuelRecord.deleteMany.mockResolvedValue({ count: 0 })
    const res = await fuelDelete(makeDelete('http://localhost/api/fuel-records/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await fuelDelete(makeDelete('http://localhost/api/fuel-records/f-1'), makeParams('f-1'))
    expect(res.status).toBe(403)
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null })
    const res = await fuelDelete(makeDelete('http://localhost/api/fuel-records/f-1'), makeParams('f-1'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.fuelRecord.deleteMany.mockRejectedValue(new Error('DB fail'))
    const res = await fuelDelete(makeDelete('http://localhost/api/fuel-records/f-1'), makeParams('f-1'))
    expect(res.status).toBe(500)
  })

  it('IDOR: uses tenantId in where clause (cross-tenant isolation)', async () => {
    mockPrisma.fuelRecord.deleteMany.mockResolvedValue({ count: 0 })
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-A', userId: 'u-A', role: 'admin', requestId: 'req-1', trade: null })
    await fuelDelete(makeDelete('http://localhost/api/fuel-records/f-other-tenant'), makeParams('f-other-tenant'))
    expect(mockPrisma.fuelRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: 'f-other-tenant', tenantId: 'tenant-A' },
    })
  })
})

// ── DELETE /api/maintenance/[id] ─────────────────────────────────────────────

describe('DELETE /api/maintenance/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null }) })

  it('deletes maintenance record and returns ok (200)', async () => {
    mockPrisma.maintenanceRecord.deleteMany.mockResolvedValue({ count: 1 })
    const res  = await maintenanceDel(makeDelete('http://localhost/api/maintenance/m-1'), makeParams('m-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockPrisma.maintenanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'm-1', tenantId: 'tenant-1' } })
  })

  it('returns 404 when record not found', async () => {
    mockPrisma.maintenanceRecord.deleteMany.mockResolvedValue({ count: 0 })
    const res = await maintenanceDel(makeDelete('http://localhost/api/maintenance/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await maintenanceDel(makeDelete('http://localhost/api/maintenance/m-1'), makeParams('m-1'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.maintenanceRecord.deleteMany.mockRejectedValue(new Error('DB fail'))
    const res = await maintenanceDel(makeDelete('http://localhost/api/maintenance/m-1'), makeParams('m-1'))
    expect(res.status).toBe(500)
  })
})

// ── DELETE /api/mission-comments/[id] ────────────────────────────────────────

describe('DELETE /api/mission-comments/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null }) })

  it('admin can delete any comment (200)', async () => {
    mockPrisma.missionComment.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1', userId: 'other-user' })
    mockPrisma.missionComment.deleteMany.mockResolvedValue({ count: 1 })
    const res  = await commentDel(makeDelete('http://localhost/api/mission-comments/c-1'), makeParams('c-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('user can delete own comment (200)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    mockPrisma.missionComment.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1', userId: 'user-1' })
    mockPrisma.missionComment.deleteMany.mockResolvedValue({ count: 1 })
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/c-1'), makeParams('c-1'))
    expect(res.status).toBe(200)
  })

  it('user cannot delete another user comment (403)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    mockPrisma.missionComment.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1', userId: 'other-user' })
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/c-1'), makeParams('c-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when comment not found in tenant', async () => {
    mockPrisma.missionComment.findFirst.mockResolvedValue(null)
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.missionComment.findFirst.mockRejectedValue(new Error('DB fail'))
    const res = await commentDel(makeDelete('http://localhost/api/mission-comments/c-1'), makeParams('c-1'))
    expect(res.status).toBe(500)
  })
})

// ── DELETE /api/holidays/[id] ─────────────────────────────────────────────────

describe('DELETE /api/holidays/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null }) })

  it('deletes holiday and returns ok (200)', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValue({ id: 'h-1', tenantId: 'tenant-1', date: '2026-01-01', label: 'New Year' })
    mockPrisma.holiday.delete.mockResolvedValue({ id: 'h-1' })
    const res  = await holidayDel(makeDelete('http://localhost/api/holidays/h-1'), makeParams('h-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 404 when holiday not found in tenant', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValue(null)
    const res = await holidayDel(makeDelete('http://localhost/api/holidays/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null })
    const res = await holidayDel(makeDelete('http://localhost/api/holidays/h-1'), makeParams('h-1'))
    expect(res.status).toBe(403)
  })

  it('dispatcher is allowed to delete (not 403)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    mockPrisma.holiday.findFirst.mockResolvedValue({ id: 'h-1', tenantId: 'tenant-1', date: '2026-01-01', label: 'New Year' })
    mockPrisma.holiday.delete.mockResolvedValue({ id: 'h-1' })
    const res = await holidayDel(makeDelete('http://localhost/api/holidays/h-1'), makeParams('h-1'))
    expect(res.status).toBe(200)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValue({ id: 'h-1', tenantId: 'tenant-1' })
    mockPrisma.holiday.delete.mockRejectedValue(new Error('DB fail'))
    const res = await holidayDel(makeDelete('http://localhost/api/holidays/h-1'), makeParams('h-1'))
    expect(res.status).toBe(500)
  })
})
