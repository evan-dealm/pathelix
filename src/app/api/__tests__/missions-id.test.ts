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

import { GET, PUT, DELETE } from '@/app/api/missions/[id]/route'
import { getMission, updateMission, deleteMission } from '@/lib/data/missions'
import { getRequestContext } from '@/lib/data/context'

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

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await DELETE(makeDelete('m-1'), makeParams('m-1'))
    expect(res.status).toBe(403)
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
