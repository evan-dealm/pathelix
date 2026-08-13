import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/data/drivers', () => ({
  getDriver:    vi.fn(),
  updateDriver: vi.fn(),
  deleteDriver: vi.fn(),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: { invalidateAll: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/audit', () => ({ auditAsync: vi.fn() }))

vi.mock('@/lib/db', () => ({
  default: {
    userPermission: { findMany: vi.fn(() => Promise.resolve([])) },
  },
}))

import { GET, PUT, DELETE } from '@/app/api/drivers/[id]/route'
import { getDriver, updateDriver, deleteDriver } from '@/lib/data/drivers'
import { getRequestContext } from '@/lib/data/context'
import { redisCache } from '@/lib/redisCache'

function makeGet(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/drivers/${id}`)
}

function makePut(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/drivers/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeDelete(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/drivers/${id}`, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const sampleDriver = {
  id: 'd-1', firstName: 'Jean', lastName: 'Dupont',
  sector: 'Nord', depotName: 'Dépôt Lyon', depotLat: 45.764, depotLng: 4.836,
}

describe('GET /api/drivers/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns driver when found (200)', async () => {
    vi.mocked(getDriver).mockResolvedValue(sampleDriver as never)

    const res  = await GET(makeGet('d-1'), makeParams('d-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('d-1')
    expect(json.firstName).toBe('Jean')
  })

  it('returns 404 when not found', async () => {
    vi.mocked(getDriver).mockResolvedValue(null)

    const res = await GET(makeGet('nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on error', async () => {
    vi.mocked(getDriver).mockRejectedValue(new Error('DB fail'))

    const res = await GET(makeGet('d-1'), makeParams('d-1'))
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/drivers/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates driver with valid partial body (200)', async () => {
    const updated = { ...sampleDriver, firstName: 'Pierre' }
    vi.mocked(updateDriver).mockResolvedValue(updated as never)

    const res  = await PUT(makePut('d-1', { firstName: 'Pierre' }), makeParams('d-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.firstName).toBe('Pierre')
  })

  it('returns 404 when driver not found', async () => {
    vi.mocked(updateDriver).mockResolvedValue(null)

    const res = await PUT(makePut('nope', { firstName: 'X' }), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid latitude', async () => {
    const res = await PUT(makePut('d-1', { depotLat: 999 }), makeParams('d-1'))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/drivers/d-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    })
    const res = await PUT(req, makeParams('d-1'))
    expect(res.status).toBe(400)
  })

  it('invalidates cache on successful update', async () => {
    vi.mocked(updateDriver).mockResolvedValue(sampleDriver as never)

    await PUT(makePut('d-1', { firstName: 'Jean' }), makeParams('d-1'))

    expect(redisCache.invalidateAll).toHaveBeenCalledTimes(2)
    const caches = vi.mocked(redisCache.invalidateAll).mock.calls.map(c => c[0])
    expect(caches).toContain('drivers')
    expect(caches).toContain('driver-list')
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(updateDriver).mockRejectedValue(new Error('DB fail'))

    const res = await PUT(makePut('d-1', { firstName: 'Jean' }), makeParams('d-1'))
    expect(res.status).toBe(500)
  })

  // Found during the A7/N22 follow-up privilege-escalation review: PUT /api/drivers/[id] had
  // NO role gate at all before this session's fix — any authenticated role, including driver,
  // could modify any driver on the tenant.
  it('driver role (no default permissions) gets 403, driver not updated', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'driver-attacker', role: 'driver', requestId: 'r1' } as never)

    const res = await PUT(makePut('d-1', { firstName: 'Pierre' }), makeParams('d-1'))
    expect(res.status).toBe(403)
    expect(updateDriver).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/drivers/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes driver and returns ok (200)', async () => {
    vi.mocked(deleteDriver).mockResolvedValue(true)

    const res  = await DELETE(makeDelete('d-1'), makeParams('d-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await DELETE(makeDelete('d-1'), makeParams('d-1'))
    expect(res.status).toBe(403)
  })

  // Phase 0.2 (mutation-testing pass): the dispatcher test above is caught by the earlier
  // `role === 'dispatcher'` check and never actually reaches hasPermission() — disabling
  // hasPermission() entirely left every test in this describe block green. driver isn't
  // caught by that earlier check, so this is the only test that actually exercises the
  // hasPermission('manage_drivers') branch.
  it('returns 403 for driver role (only test that reaches hasPermission)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'driver-del', role: 'driver', requestId: 'r' } as never)

    const res = await DELETE(makeDelete('d-1'), makeParams('d-1'))
    expect(res.status).toBe(403)
    expect(deleteDriver).not.toHaveBeenCalled()
  })

  it('returns 404 when driver not found', async () => {
    vi.mocked(deleteDriver).mockResolvedValue(false)

    const res = await DELETE(makeDelete('nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(deleteDriver).mockRejectedValue(new Error('DB fail'))

    const res = await DELETE(makeDelete('d-1'), makeParams('d-1'))
    expect(res.status).toBe(500)
  })
})
