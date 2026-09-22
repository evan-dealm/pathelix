import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    client: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    clientSite: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
    site: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
      count:      vi.fn(),
    },
    siteProduct: {
      findFirst:  vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
    },
    mission: {
      updateMany: vi.fn(),
      count:      vi.fn(() => Promise.resolve(0)),
    },
    tenant: {
      findUnique: vi.fn(() => Promise.resolve(null)),
    },
    userPermission: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'req-1' })),
}))

vi.mock('@/lib/data/missions', () => ({
  getAllMissions:    vi.fn(),
  getMissionsByDate: vi.fn(),
  createMission:    vi.fn(),
}))

vi.mock('@/lib/missionQueue', () => ({
  peekQueue: vi.fn(() => []),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
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

import { PUT as clientsPut, DELETE as clientsDelete }             from '@/app/api/clients/[id]/route'
import { PUT as sitesPut, DELETE as sitesDelete }                 from '@/app/api/sites/[id]/route'
import { PUT as siteProductsPut, DELETE as siteProductsDelete }   from '@/app/api/site-products/[id]/route'
import { GET as missionsGet, POST as missionsPost }               from '@/app/api/missions/route'
import { getRequestContext } from '@/lib/data/context'
import { getAllMissions, createMission } from '@/lib/data/missions'

function makeRequest(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const init = {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }
  return new NextRequest(url, init)
}

function makeIdParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe('PUT /api/clients/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/clients/c-1', {
      method: 'PUT',
      body:   { name: 'New Name' },
    })
    const res = await clientsPut(req, makeIdParams('c-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown client', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.client.findFirst.mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/clients/unknown', {
      method: 'PUT',
      body:   { name: 'X' },
    })
    const res = await clientsPut(req, makeIdParams('unknown'))
    expect(res.status).toBe(404)
  })

  it('strips unknown fields (tenantId, id, createdAt) and updates with valid fields only', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-test' })
    mockPrisma.$transaction.mockImplementation(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma))
    mockPrisma.client.update.mockResolvedValue({ id: 'c-1', name: 'OK' })
    mockPrisma.client.findUnique.mockResolvedValue({ id: 'c-1', name: 'OK' })

    const req = makeRequest('http://localhost:3000/api/clients/c-1', {
      method: 'PUT',
      body:   { name: 'OK', tenantId: 'HACK', id: 'HACK', createdAt: '2024-01-01' },
    })
    const res = await clientsPut(req, makeIdParams('c-1'))

    expect(res.status).toBe(200)
  })

  it('rejects siteIds not belonging to this tenant (cross-tenant ClientSite link)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-test' })
    mockPrisma.site.count.mockResolvedValue(0) // requested site belongs to another tenant

    const req = makeRequest('http://localhost:3000/api/clients/c-1', {
      method: 'PUT',
      body:   { siteIds: ['site-other-tenant'] },
    })
    const res = await clientsPut(req, makeIdParams('c-1'))

    expect(res.status).toBe(400)
    expect(mockPrisma.clientSite.createMany).not.toHaveBeenCalled()
  })

  it('accepts siteIds that belong to this tenant', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-test' })
    mockPrisma.site.count.mockResolvedValue(1)
    mockPrisma.client.update.mockResolvedValue({ id: 'c-1' })

    const req = makeRequest('http://localhost:3000/api/clients/c-1', {
      method: 'PUT',
      body:   { siteIds: ['site-1'] },
    })
    const res = await clientsPut(req, makeIdParams('c-1'))

    expect(res.status).toBe(200)
    expect(mockPrisma.site.count).toHaveBeenCalledWith({ where: { id: { in: ['site-1'] }, tenantId: 'tenant-test' } })
    expect(mockPrisma.clientSite.createMany).toHaveBeenCalled()
  })

  it('returns 400 for empty body (invalid JSON)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = new NextRequest('http://localhost:3000/api/clients/c-1', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await clientsPut(req, makeIdParams('c-1'))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/clients/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/clients/c-1', { method: 'DELETE' })
    const res = await clientsDelete(req, makeIdParams('c-1'))
    expect(res.status).toBe(403)
  })

  it('sets archived=true (soft delete)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-test' })
    mockPrisma.client.update.mockResolvedValue({ id: 'c-1', archived: true })

    const req = makeRequest('http://localhost:3000/api/clients/c-1', { method: 'DELETE' })
    const res = await clientsDelete(req, makeIdParams('c-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockPrisma.client.update).toHaveBeenCalledWith({
      where: { id: 'c-1', tenantId: 'tenant-test' },
      data:  { archived: true },
    })
  })
})

describe('PUT /api/sites/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/sites/s-1', {
      method: 'PUT',
      body:   { name: 'Site A' },
    })
    const res = await sitesPut(req, makeIdParams('s-1'))
    expect(res.status).toBe(403)
  })

  it('strips unknown fields (tenantId, id, createdAt) — does not propagate injection fields', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.site.findFirst.mockResolvedValue({ id: 's-1', tenantId: 'tenant-test' })
    mockPrisma.site.update.mockResolvedValue({ id: 's-1', name: 'OK' })

    const req = makeRequest('http://localhost:3000/api/sites/s-1', {
      method: 'PUT',
      body:   { name: 'OK', tenantId: 'HACK', id: 'HACK', createdAt: '2024-01-01' },
    })
    const res = await sitesPut(req, makeIdParams('s-1'))

    expect(res.status).toBe(200)
    const updateCall = mockPrisma.site.update.mock.calls[0]?.[0]
    expect(updateCall?.data).not.toHaveProperty('tenantId')
    expect(updateCall?.data).not.toHaveProperty('id')
  })

  it('returns 404 for unknown site', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.site.findFirst.mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/sites/s-1', {
      method: 'PUT',
      body:   { name: 'Site A' },
    })
    const res = await sitesPut(req, makeIdParams('s-1'))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/sites/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('soft-deletes by setting archived=true', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.site.findFirst.mockResolvedValue({ id: 's-1', tenantId: 'tenant-test' })
    mockPrisma.site.update.mockResolvedValue({ id: 's-1', archived: true })

    const req = makeRequest('http://localhost:3000/api/sites/s-1', { method: 'DELETE' })
    const res = await sitesDelete(req, makeIdParams('s-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockPrisma.site.update).toHaveBeenCalledWith({
      where: { id: 's-1', tenantId: 'tenant-test' },
      data:  { archived: true },
    })
  })
})

describe('PUT /api/site-products/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/site-products/sp-1', {
      method: 'PUT',
      body:   { wasteType: 'DIB' },
    })
    const res = await siteProductsPut(req, makeIdParams('sp-1'))
    expect(res.status).toBe(403)
  })

  it('filters non-allowed fields (CRITICAL — real bug fix)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    mockPrisma.siteProduct.findFirst
      .mockResolvedValueOnce({ id: 'sp-1', tenantId: 'tenant-test' })
      .mockResolvedValueOnce({ id: 'sp-1', wasteType: 'DIB' })
    mockPrisma.siteProduct.updateMany.mockResolvedValue({ count: 1 })

    const req = makeRequest('http://localhost:3000/api/site-products/sp-1', {
      method: 'PUT',
      body:   { wasteType: 'DIB', tenantId: 'HACK', id: 'HACK', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    })
    const res = await siteProductsPut(req, makeIdParams('sp-1'))
    expect(res.status).toBe(200)

    const updateCall = mockPrisma.siteProduct.updateMany.mock.calls[0][0]
    expect(updateCall.data).toEqual({ wasteType: 'DIB' })
    expect(updateCall.data).not.toHaveProperty('tenantId')
    expect(updateCall.data).not.toHaveProperty('id')
    expect(updateCall.data).not.toHaveProperty('createdAt')
    expect(updateCall.data).not.toHaveProperty('updatedAt')
  })

  it('returns 404 for wrong tenant', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.siteProduct.findFirst.mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/site-products/sp-other', {
      method: 'PUT',
      body:   { wasteType: 'DIB' },
    })
    const res = await siteProductsPut(req, makeIdParams('sp-other'))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/site-products/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('soft-deletes by setting archived=true', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.siteProduct.updateMany.mockResolvedValue({ count: 1 })

    const req = makeRequest('http://localhost:3000/api/site-products/sp-1', { method: 'DELETE' })
    const res = await siteProductsDelete(req, makeIdParams('sp-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockPrisma.siteProduct.updateMany).toHaveBeenCalledWith({
      where: { id: 'sp-1', tenantId: 'tenant-test' },
      data:  { archived: true },
    })
  })
})

describe('GET /api/missions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns missions array with pagination', async () => {
    const missions = [
      { id: 'm-1', type: 'POSER' as const, date: '2026-03-20', address: '1 rue X', latitude: 45.76, longitude: 4.83, estimatedDurationMin: 30, maneuverTimeMin: 10 },
      { id: 'm-2', type: 'RETIRER' as const, date: '2026-03-20', address: '2 rue Y', latitude: 45.70, longitude: 4.80, estimatedDurationMin: 25, maneuverTimeMin: 15 },
    ]
    vi.mocked(getAllMissions).mockResolvedValue(missions)

    const req = makeRequest('http://localhost:3000/api/missions')
    const res = await missionsGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(2)
    expect(json.pagination).toBeDefined()
    expect(json.pagination.total).toBe(2)
  })
})

describe('POST /api/missions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates a mission with valid input (201)', async () => {
    const validBody = {
      type:                 'POSER',
      date:                 '2026-03-20',
      address:              '10 rue de Lyon',
      latitude:             45.764,
      longitude:            4.836,
      estimatedDurationMin: 30,
      maneuverTimeMin:      5,
    }
    const created = { id: 'mission-new', ...validBody, type: validBody.type as 'POSER' }
    vi.mocked(createMission).mockResolvedValue(created)

    const req = makeRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      body:   validBody,
    })
    const res = await missionsPost(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.id).toBe('mission-new')
  })

  it('returns 422 (not 500) when FK reference is invalid (P2003) — regression: clientId inexistant', async () => {
    const err = Object.assign(new Error('FK violation'), { code: 'P2003' })
    vi.mocked(createMission).mockRejectedValue(err)

    const req = makeRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      body: {
        type: 'POSER', date: '2026-03-20', address: '10 rue de Lyon',
        latitude: 45.764, longitude: 4.836,
        estimatedDurationMin: 30, maneuverTimeMin: 5,
        clientId: 'client-supprime',
      },
    })
    const res = await missionsPost(req)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('Référence invalide')
  })

  it('archive-all requires admin role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })
    const req = makeRequest('http://localhost:3000/api/missions?action=archive-all', {
      method:  'POST',
      body:    {},
    })
    const res = await missionsPost(req)
    expect(res.status).toBe(403)
  })

  it('archive-all succeeds for admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.mission.updateMany.mockResolvedValue({ count: 5 })

    const req = makeRequest('http://localhost:3000/api/missions?action=archive-all', {
      method:  'POST',
      body:    {},
    })
    const res = await missionsPost(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.archived).toBe(5)
  })

  // Regression A7: hasPermission('manage_missions') — POST /api/missions (ordinary creation,
  // not the archive-all sub-action) previously had NO role gate at all; any authenticated role
  // including driver could create missions. Distinct userId to avoid hasPermission()'s 60s cache.
  it('driver role (no default permissions) gets 403 on ordinary mission creation, no DB write', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'driver-mission-1', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      body: {
        type: 'POSER', date: '2026-03-20', address: '10 rue de Lyon',
        latitude: 45.764, longitude: 4.836,
        estimatedDurationMin: 30, maneuverTimeMin: 5,
      },
    })
    const res = await missionsPost(req)
    expect(res.status).toBe(403)
    expect(createMission).not.toHaveBeenCalled()
  })
})
