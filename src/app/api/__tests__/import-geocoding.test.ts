import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

const mockCreateMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/rateLimit', () => ({
  createTenantRateLimiter: () => ({
    check: vi.fn(() => Promise.resolve(true)),
    headers: vi.fn(() => ({})),
  }),
  createRateLimiter: () => ({
    check: vi.fn(() => true),
    headers: vi.fn(() => ({})),
  }),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: { invalidateAll: vi.fn(() => Promise.resolve()) },
}))

vi.mock('@/lib/db', () => ({
  default: {
    mission: { createMany: mockCreateMany },
  },
}))

import { POST } from '@/app/api/import/route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BASE_MISSION = {
  type: 'POSER',
  date: '2026-01-06',
  address: '12 rue de la Paix, Paris',
  estimatedDurationMin: 30,
  maneuverTimeMin: 15,
}

beforeEach(() => {
  mockCreateMany.mockReset()
  mockCreateMany.mockResolvedValue({ count: 0 })
})

describe('POST /api/import — geocoding flag', () => {
  it('valid coords → needsGeocode=false, withCoords incremented', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [{ ...BASE_MISSION, latitude: 48.866, longitude: 2.333 }],
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.withCoords).toBe(1)
    expect(body.needsGeocode).toBe(0)
    const row = mockCreateMany.mock.calls[0][0].data[0]
    expect(row.needsGeocode).toBe(false)
    expect(row.latitude).toBe(48.866)
  })

  it('lat=0 lng=0 → needsGeocode=true (ocean coordinates)', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [{ ...BASE_MISSION, latitude: 0, longitude: 0 }],
    }))
    const body = await res.json()
    expect(body.needsGeocode).toBe(1)
    expect(body.withCoords).toBe(0)
    const row = mockCreateMany.mock.calls[0][0].data[0]
    expect(row.needsGeocode).toBe(true)
    expect(row.latitude).toBe(0)
    expect(row.longitude).toBe(0)
  })

  it('missing coords → needsGeocode=true', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [{ ...BASE_MISSION, latitude: null, longitude: null }],
    }))
    const body = await res.json()
    expect(body.needsGeocode).toBe(1)
    const row = mockCreateMany.mock.calls[0][0].data[0]
    expect(row.needsGeocode).toBe(true)
  })

  it('French decimal comma → parsed correctly, needsGeocode=false', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [{ ...BASE_MISSION, latitude: '48,866', longitude: '2,333' }],
    }))
    const body = await res.json()
    expect(body.withCoords).toBe(1)
    expect(body.needsGeocode).toBe(0)
    const row = mockCreateMany.mock.calls[0][0].data[0]
    expect(row.latitude).toBeCloseTo(48.866)
    expect(row.needsGeocode).toBe(false)
  })

  it('out-of-bounds coords → needsGeocode=true', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [{ ...BASE_MISSION, latitude: 200, longitude: 500 }],
    }))
    const body = await res.json()
    expect(body.needsGeocode).toBe(1)
    const row = mockCreateMany.mock.calls[0][0].data[0]
    expect(row.needsGeocode).toBe(true)
  })

  it('mixed batch: 2 valid + 1 invalid → correct counters', async () => {
    mockCreateMany.mockResolvedValue({ count: 3 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [
        { ...BASE_MISSION, latitude: 48.866, longitude: 2.333 },
        { ...BASE_MISSION, latitude: 45.748, longitude: 4.847 },
        { ...BASE_MISSION, latitude: 0, longitude: 0 },
      ],
    }))
    const body = await res.json()
    expect(body.withCoords).toBe(2)
    expect(body.needsGeocode).toBe(1)
  })

  it('response shape includes imported, withCoords, needsGeocode, errors, totalErrors', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 })
    const res = await POST(makeRequest({
      type: 'missions',
      data: [{ ...BASE_MISSION, latitude: 48.866, longitude: 2.333 }],
    }))
    const body = await res.json()
    expect(body).toHaveProperty('imported')
    expect(body).toHaveProperty('withCoords')
    expect(body).toHaveProperty('needsGeocode')
    expect(body).toHaveProperty('errors')
    expect(body).toHaveProperty('totalErrors')
  })
})
