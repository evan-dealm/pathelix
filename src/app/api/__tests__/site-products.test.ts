import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin' })),
  getTenantId: vi.fn(() => 't1'),
}))

const mockSiteProductFindMany = vi.hoisted(() => vi.fn())
const mockClientFindFirst     = vi.hoisted(() => vi.fn())
const mockSiteFindFirst       = vi.hoisted(() => vi.fn())
const mockClientSiteUpsert    = vi.hoisted(() => vi.fn())
const mockSiteProductCreate   = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    siteProduct: { findMany: mockSiteProductFindMany, create: mockSiteProductCreate },
    client:      { findFirst: mockClientFindFirst    },
    site:        { findFirst: mockSiteFindFirst      },
    clientSite:  { upsert:    mockClientSiteUpsert   },
  },
}))

const mockGetOrSet      = vi.hoisted(() => vi.fn())
const mockInvalidateAll = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisCache', () => ({
  redisCache: { getOrSet: mockGetOrSet, invalidateAll: mockInvalidateAll },
}))

import { GET, POST } from '@/app/api/site-products/route'
import { getRequestContext } from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeGET(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/site-products')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function makePOST(body: unknown) {
  return new NextRequest('http://localhost/api/site-products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  siteId:   'site-1',
  clientId: 'client-1',
  wasteType: 'Ordures ménagères',
  defaultDurationMin: 30,
}

const PRODUCT = { id: 'prod-1', wasteType: 'Ordures ménagères', site: { id: 'site-1', name: 'Site A' }, client: { id: 'client-1', name: 'ACME' }, defaultExutoire: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
  // By default, redisCache.getOrSet calls the factory
  mockGetOrSet.mockImplementation((_ns: unknown, _tid: unknown, factory: () => unknown) => factory())
  mockSiteProductFindMany.mockResolvedValue([])
  mockInvalidateAll.mockResolvedValue(undefined)
})

// ─── GET /api/site-products ───────────────────────────────────────────────────

describe('GET /api/site-products', () => {
  it('returns products from DB via redisCache', async () => {
    mockSiteProductFindMany.mockResolvedValueOnce([PRODUCT])
    const res = await GET(makeGET())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].wasteType).toBe('Ordures ménagères')
  })

  it('filters by siteId when provided', async () => {
    mockSiteProductFindMany.mockResolvedValueOnce([PRODUCT])
    await GET(makeGET({ siteId: 'site-1' }))
    const whereArg = mockSiteProductFindMany.mock.calls[0][0].where
    expect(whereArg.siteId).toBe('site-1')
  })

  it('filters by clientId when provided', async () => {
    mockSiteProductFindMany.mockResolvedValueOnce([])
    await GET(makeGET({ clientId: 'client-1' }))
    const whereArg = mockSiteProductFindMany.mock.calls[0][0].where
    expect(whereArg.clientId).toBe('client-1')
  })

  it('returns 500 on DB error', async () => {
    mockGetOrSet.mockRejectedValueOnce(new Error('DB crash'))
    const res = await GET(makeGET())
    expect(res.status).toBe(500)
  })

  it('cache-control header is set', async () => {
    const res = await GET(makeGET())
    expect(res.headers.get('cache-control')).toContain('max-age=30')
  })
})

// ─── POST /api/site-products ──────────────────────────────────────────────────

describe('POST /api/site-products', () => {
  it('returns 403 for non-admin role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'dispatcher', requestId: 'req-123', trade: null })
    const res = await POST(makePOST(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/site-products', {
      method: 'POST',
      body: '{invalid',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when siteId missing', async () => {
    const res = await POST(makePOST({ clientId: 'c1', wasteType: 'OM' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when client not found', async () => {
    mockClientFindFirst.mockResolvedValueOnce(null)
    mockSiteFindFirst.mockResolvedValueOnce({ id: 'site-1' })
    const res = await POST(makePOST(VALID_BODY))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/client/i)
  })

  it('returns 404 when site not found', async () => {
    mockClientFindFirst.mockResolvedValueOnce({ id: 'client-1' })
    mockSiteFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makePOST(VALID_BODY))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/site/i)
  })

  it('creates product and returns 201', async () => {
    mockClientFindFirst.mockResolvedValueOnce({ id: 'client-1' })
    mockSiteFindFirst.mockResolvedValueOnce({ id: 'site-1' })
    mockClientSiteUpsert.mockResolvedValueOnce({})
    mockSiteProductCreate.mockResolvedValueOnce(PRODUCT)

    const res = await POST(makePOST(VALID_BODY))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.wasteType).toBe('Ordures ménagères')
    expect(mockInvalidateAll).toHaveBeenCalled()
  })

  it('returns 500 on DB create error', async () => {
    mockClientFindFirst.mockResolvedValueOnce({ id: 'client-1' })
    mockSiteFindFirst.mockResolvedValueOnce({ id: 'site-1' })
    mockClientSiteUpsert.mockResolvedValueOnce({})
    mockSiteProductCreate.mockRejectedValueOnce(new Error('DB full'))

    const res = await POST(makePOST(VALID_BODY))
    expect(res.status).toBe(500)
  })
})
