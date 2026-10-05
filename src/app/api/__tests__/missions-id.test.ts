import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/data/missions', () => ({
  getMission:    vi.fn(),
  updateMission: vi.fn(),
  deleteMission: vi.fn(),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/db', () => ({
  default: { userPermission: { findMany: vi.fn(() => Promise.resolve([])) } },
}))

import { GET, PUT, DELETE } from '@/app/api/missions/[id]/route'
import { getMission, updateMission, deleteMission } from '@/lib/data/missions'
import { getRequestContext } from '@/lib/data/context'
import db from '@/lib/db'

function makeGet(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/missions/${id}`)
}

function makePut(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/missions/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeDelete(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/missions/${id}`, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const sampleMission = {
  id: 'm-1', type: 'POSER', date: '2026-04-10',
  address: '10 rue de Lyon', latitude: 45.764, longitude: 4.836,
  estimatedDurationMin: 30, maneuverTimeMin: 10,
}

describe('GET /api/missions/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns mission when found (200)', async () => {
    vi.mocked(getMission).mockResolvedValue(sampleMission as never)

    const res  = await GET(makeGet('m-1'), makeParams('m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('m-1')
    expect(json.type).toBe('POSER')
  })

  it('returns 404 when not found', async () => {
    vi.mocked(getMission).mockResolvedValue(null)

    const res = await GET(makeGet('nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on error', async () => {
    vi.mocked(getMission).mockRejectedValue(new Error('DB fail'))

    const res = await GET(makeGet('m-1'), makeParams('m-1'))
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/missions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMission).mockResolvedValue(null)
  })

  it('updates mission with valid partial body (200)', async () => {
    const updated = { ...sampleMission, type: 'RETIRER' }
    vi.mocked(updateMission).mockResolvedValue(updated as never)

    const res  = await PUT(makePut('m-1', { type: 'RETIRER' }), makeParams('m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.type).toBe('RETIRER')
  })

  it('returns 404 when mission not found', async () => {
    vi.mocked(updateMission).mockResolvedValue(null)

    const res = await PUT(makePut('nope', { type: 'RETIRER' }), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid field value', async () => {
    const res = await PUT(makePut('m-1', { type: 'INVALID_TYPE' }), makeParams('m-1'))
    expect(res.status).toBe(422)
  })

  it('returns 422 for out-of-range latitude', async () => {
    const res = await PUT(makePut('m-1', { latitude: 999 }), makeParams('m-1'))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/missions/m-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    })
    const res = await PUT(req, makeParams('m-1'))
    expect(res.status).toBe(400)
  })

  it('invalidates cache on successful update', async () => {
    const { redisCache } = await import('@/lib/redisCache')
    vi.mocked(updateMission).mockResolvedValue(sampleMission as never)

    await PUT(makePut('m-1', { type: 'POSER' }), makeParams('m-1'))

    expect(redisCache.invalidate).toHaveBeenCalledTimes(2)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(updateMission).mockRejectedValue(new Error('DB fail'))

    const res = await PUT(makePut('m-1', { type: 'POSER' }), makeParams('m-1'))
    expect(res.status).toBe(500)
  })

  // Regression A7: hasPermission('manage_missions') — PUT /api/missions/[id] previously had NO
  // role gate at all. Distinct userIds per test to avoid hasPermission()'s 60s per-userId cache.
  it('dispatcher with no custom UserPermission gets the role default (manage_missions included, 200)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'disp-default', role: 'dispatcher', requestId: 'r1' } as never)
    vi.mocked(updateMission).mockResolvedValue(sampleMission as never)

    const res = await PUT(makePut('m-1', { type: 'POSER' }), makeParams('m-1'))
    expect(res.status).toBe(200)
  })

  it('dispatcher with manage_missions explicitly revoked gets 403', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'disp-revoked', role: 'dispatcher', requestId: 'r1' } as never)
    vi.mocked(db.userPermission.findMany).mockResolvedValueOnce([{ permission: 'manage_vehicles' }] as never)

    const res = await PUT(makePut('m-1', { type: 'POSER' }), makeParams('m-1'))
    expect(res.status).toBe(403)
    expect(updateMission).not.toHaveBeenCalled()
  })

  it('driver role (no default permissions) gets 403', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'driver-perm-1', role: 'driver', requestId: 'r1' } as never)

    const res = await PUT(makePut('m-1', { type: 'POSER' }), makeParams('m-1'))
    expect(res.status).toBe(403)
    expect(updateMission).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/missions/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes mission and returns ok (200)', async () => {
    vi.mocked(getMission).mockResolvedValue(sampleMission as never)
    vi.mocked(deleteMission).mockResolvedValue(true)

    const res  = await DELETE(makeDelete('m-1'), makeParams('m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  // Changed on purpose: DELETE used to hard-block the dispatcher role on top of the permission
  // check, although dispatchers hold manage_*s by default and the UI offered (and optimistically
  // applied) the delete — the item silently came back on reload. The permission alone decides now.
  it('lets a dispatcher holding manage_missions (role default) delete', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u-disp-del', role: 'dispatcher', requestId: 'r' } as never)

    const res = await DELETE(makeDelete('m-1'), makeParams('m-1'))
    expect(res.status).not.toBe(403)
  })

  // Phase 0.2 (mutation-testing pass): the dispatcher test above is caught by the earlier
  // `role === 'dispatcher'` check and never actually reaches hasPermission() — disabling
  // hasPermission() entirely left every test in this describe block green. driver isn't
  // caught by that earlier check, so this is the only test that actually exercises the
  // hasPermission('manage_missions') branch.
  it('returns 403 for driver role (only test that reaches hasPermission)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'driver-del', role: 'driver', requestId: 'r' } as never)

    const res = await DELETE(makeDelete('m-1'), makeParams('m-1'))
    expect(res.status).toBe(403)
    expect(deleteMission).not.toHaveBeenCalled()
  })

  it('returns 404 when mission not found', async () => {
    vi.mocked(getMission).mockResolvedValue(null)
    vi.mocked(deleteMission).mockResolvedValue(false)

    const res = await DELETE(makeDelete('nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(getMission).mockResolvedValue(sampleMission as never)
    vi.mocked(deleteMission).mockRejectedValue(new Error('DB fail'))

    const res = await DELETE(makeDelete('m-1'), makeParams('m-1'))
    expect(res.status).toBe(500)
  })
})
