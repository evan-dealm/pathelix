import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(),
  createDriver: vi.fn(),
}))

vi.mock('@/lib/data/context', () => ({
  getTenantId: vi.fn(() => 'tenant-test'),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({
  default: {
    tenant: { findUnique: vi.fn(() => Promise.resolve(null)) },
    driver: { count: vi.fn(() => Promise.resolve(0)) },
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: {
    increment: vi.fn(),
    histogram: vi.fn(),
  },
  METRIC: {
    API_LATENCY_MS: 'api.latency_ms',
    API_REQUESTS:   'api.requests',
    API_ERRORS:     'api.errors',
  },
}))

import { GET, POST } from '@/app/api/drivers/route'
import { getAllDrivers, createDriver } from '@/lib/data/drivers'
import { getTenantId } from '@/lib/data/context'

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/drivers')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/drivers', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

describe('GET /api/drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns drivers with pagination metadata', async () => {
    const drivers = [
      { id: 'd-1', firstName: 'Jean',  lastName: 'Dupont', sector: 'Nord', depotName: 'D1', depotLat: 45.76, depotLng: 4.83 },
      { id: 'd-2', firstName: 'Marie', lastName: 'Curie',  sector: 'Sud',  depotName: 'D2', depotLat: 45.70, depotLng: 4.80 },
    ]
    vi.mocked(getAllDrivers).mockResolvedValue(drivers)

    const res = await GET(makeGetRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(2)
    expect(json.pagination).toBeDefined()
    expect(json.pagination.total).toBe(2)
  })

  it('returns empty array when no drivers exist', async () => {
    vi.mocked(getAllDrivers).mockResolvedValue([])

    const res  = await GET(makeGetRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(0)
    expect(json.pagination.total).toBe(0)
  })

  it('supports pagination parameters', async () => {
    const drivers = Array.from({ length: 10 }, (_, i) => ({
      id: `d-${i}`, firstName: `F${i}`, lastName: `L${i}`,
      sector: 'A', depotName: 'D', depotLat: 45.0, depotLng: 4.0,
    }))
    vi.mocked(getAllDrivers).mockResolvedValue(drivers)

    const res  = await GET(makeGetRequest({ page: '2', limit: '3' }))
    const json = await res.json()

    expect(json.data).toHaveLength(3)
    expect(json.pagination.page).toBe(2)
    expect(json.pagination.limit).toBe(3)
  })

  it('returns 500 when data layer throws', async () => {
    vi.mocked(getAllDrivers).mockRejectedValue(new Error('DB down'))

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(500)
  })

  it('uses correct tenantId from context', async () => {
    vi.mocked(getTenantId).mockReturnValue('custom-tenant')
    vi.mocked(getAllDrivers).mockResolvedValue([])

    await GET(makeGetRequest())

    expect(getAllDrivers).toHaveBeenCalledWith('custom-tenant')
  })
})

describe('POST /api/drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validBody = {
    firstName: 'Jean',
    lastName:  'Dupont',
    sector:    'Nord',
    depotName: 'Dépôt Nord',
    depotLat:  45.764,
    depotLng:  4.836,
  }

  it('creates a driver with valid input (201)', async () => {
    const created = { id: 'new-1', ...validBody }
    vi.mocked(createDriver).mockResolvedValue(created)

    const res  = await POST(makePostRequest(validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.id).toBe('new-1')
  })

  it('validates input with Zod — rejects missing required fields (422)', async () => {
    const res = await POST(makePostRequest({ firstName: 'Jean' }))
    expect(res.status).toBe(422)
  })

  it('validates input with Zod — rejects invalid coordinates (422)', async () => {
    const res = await POST(makePostRequest({ ...validBody, depotLat: 95 }))
    expect(res.status).toBe(422)
  })

  it('calls createDriver with correct tenantId', async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-xyz')
    vi.mocked(createDriver).mockResolvedValue({ id: 'new', ...validBody })

    await POST(makePostRequest(validBody))

    expect(createDriver).toHaveBeenCalledWith('tenant-xyz', expect.objectContaining(validBody))
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/drivers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
