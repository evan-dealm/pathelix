import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  process.env.USE_MOCK_DATA = 'false'
  process.env.VALHALLA_URL  = 'http://valhalla:8002'
  const mockPrisma = {
    vehicle: {
      findFirst: vi.fn(),
    },
    interventionMetric: {
      groupBy: vi.fn(),
    },
    tenantMLProfile: {
      groupBy: vi.fn(),
    },
    tenant: {
      findMany: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: vi.fn(),
}))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'superadmin', requestId: 'req-1', trade: null })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}))

import { POST as navigationPost }  from '@/app/api/navigation/route'
import { GET  as mlStatusGet }      from '@/app/api/superadmin/ml-status/route'
import { verifySession }            from '@/lib/session'
import { getRequestContext }        from '@/lib/data/context'

function makeReq(
  url: string,
  opts: {
    method?: string
    body?: unknown
    cookie?: string
  } = {},
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.cookie) headers['cookie'] = `session=${opts.cookie}`

  const req = new NextRequest(url, {
    method: opts.method ?? 'POST',
    headers,
    body:   opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (opts.cookie) {
    req.cookies.set('session', opts.cookie)
  }
  return req
}

const validRouteBody = {
  origin:      { lat: 48.85, lng: 2.35 },
  destination: { lat: 48.90, lng: 2.40 },
}

const mockValhallaRoute = {
  trip: {
    legs: [{
      shape: '',
      summary: { length: 5.2, time: 480 },
      maneuvers: [{
        type: 1,
        instruction: 'Tourner à droite',
        length: 0.5,
        time: 30,
        begin_shape_index: 0,
        end_shape_index: 3,
        street_names: ['Rue de la Paix'],
      }],
    }],
    summary: { length: 5.2, time: 480 },
  },
}

// ─── POST /api/navigation ────────────────────────────────────────────────────

describe('POST /api/navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.VALHALLA_URL = 'http://valhalla:8002'
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1',
      role: 'driver',
      tenantId: 'tenant-test',
    } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.VALHALLA_URL = 'http://valhalla:8002'
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(verifySession).mockResolvedValue(null)
    const req = makeReq('http://localhost/api/navigation', { body: validRouteBody })
    const res = await navigationPost(req)
    expect(res.status).toBe(401)
  })

  it('returns 503 when VALHALLA_URL is not configured', async () => {
    delete process.env.VALHALLA_URL
    const req = makeReq('http://localhost/api/navigation', {
      body: validRouteBody,
      cookie: 'session-token',
    })
    const res = await navigationPost(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toMatch(/VALHALLA_URL/i)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/navigation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'session=tok' },
      body: 'not-json',
    })
    req.cookies.set('session', 'tok')
    const res = await navigationPost(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 for invalid schema (missing origin)', async () => {
    const req = makeReq('http://localhost/api/navigation', {
      body: { destination: { lat: 48.9, lng: 2.4 } },
      cookie: 'tok',
    })
    const res = await navigationPost(req)
    expect(res.status).toBe(422)
  })

  it('returns 502 when Valhalla responds with error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      text: async () => 'No route found',
    }))
    const req = makeReq('http://localhost/api/navigation', {
      body: validRouteBody, cookie: 'tok',
    })
    const res = await navigationPost(req)
    expect(res.status).toBe(502)
  })

  it('returns 500 when Valhalla fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))
    const req = makeReq('http://localhost/api/navigation', {
      body: validRouteBody, cookie: 'tok',
    })
    const res = await navigationPost(req)
    expect(res.status).toBe(500)
  })

  it('returns 200 with legs data on successful route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockValhallaRoute,
    }))
    const req = makeReq('http://localhost/api/navigation', {
      body: validRouteBody, cookie: 'tok',
    })
    const res = await navigationPost(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.totalDistanceKm).toBe(5.2)
    expect(json.totalDurationMin).toBe(8)
    expect(json.legs).toHaveLength(1)
    expect(json.legs[0].maneuvers).toHaveLength(1)
    expect(json.legs[0].maneuvers[0].instruction).toBe('Tourner à droite')
  })

  it('uses vehicle dimensions from DB when vehicleId is provided', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      weightTon: 12, heightM: 3.5, widthM: 2.4, lengthM: 8, axleCount: 2, hazmat: false,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => mockValhallaRoute,
    }))
    const req = makeReq('http://localhost/api/navigation', {
      body: { ...validRouteBody, vehicleId: 'vehicle-1' },
      cookie: 'tok',
    })
    await navigationPost(req)
    expect(mockPrisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: 'vehicle-1' },
      select: expect.objectContaining({ weightTon: true }),
    })
  })

  it('handles match action with valid positions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matched_points: [{ lat: 48.85, lon: 2.35, edge_index: 0 }],
        shape: '',
      }),
    }))
    const req = makeReq('http://localhost/api/navigation?action=match', {
      body: { positions: [{ lat: 48.85, lng: 2.35 }, { lat: 48.86, lng: 2.36 }] },
      cookie: 'tok',
    })
    const res = await navigationPost(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json.matchedPoints)).toBe(true)
  })

  it('returns 422 for match action with fewer than 2 positions', async () => {
    const req = makeReq('http://localhost/api/navigation?action=match', {
      body: { positions: [{ lat: 48.85, lng: 2.35 }] },
      cookie: 'tok',
    })
    const res = await navigationPost(req)
    expect(res.status).toBe(422)
  })
})

// ─── GET /api/superadmin/ml-status ───────────────────────────────────────────

describe('GET /api/superadmin/ml-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test',
      userId: 'sa-1',
      role: 'superadmin',
      requestId: 'req-1',
      trade: null,
    })
    mockPrisma.interventionMetric.groupBy.mockResolvedValue([])
    mockPrisma.tenantMLProfile.groupBy.mockResolvedValue([])
    mockPrisma.tenant.findMany.mockResolvedValue([])
  })

  it('returns 403 for non-superadmin role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test',
      userId: 'user-1',
      role: 'admin',
      requestId: 'req-1',
      trade: null,
    })
    const req = makeReq('http://localhost/api/superadmin/ml-status', { method: 'GET' })
    const res = await mlStatusGet(req)
    expect(res.status).toBe(403)
  })

  it('returns 200 with empty array when no tenants', async () => {
    const req = makeReq('http://localhost/api/superadmin/ml-status', { method: 'GET' })
    const res = await mlStatusGet(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(0)
  })

  it('returns ML status per tenant with maturity labels', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'Tenant 1', slug: 't1', plan: 'pro' },
      { id: 't2', name: 'Tenant 2', slug: 't2', plan: 'enterprise' },
    ])
    mockPrisma.interventionMetric.groupBy.mockResolvedValue([
      { tenantId: 't1', isReliable: true,  _count: 600 },
      { tenantId: 't1', isReliable: false, _count: 50  },
      { tenantId: 't2', isReliable: true,  _count: 10  },
    ])
    mockPrisma.tenantMLProfile.groupBy.mockResolvedValue([
      { tenantId: 't1', _count: 15, _max: { lastComputedAt: new Date('2026-05-01') } },
    ])

    const req = makeReq('http://localhost/api/superadmin/ml-status', { method: 'GET' })
    const res = await mlStatusGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(2)

    const t1 = json.find((t: { tenantId: string }) => t.tenantId === 't1')
    expect(t1.metrics.total).toBe(650)
    expect(t1.metrics.reliable).toBe(600)
    expect(t1.metrics.rejected).toBe(50)
    expect(t1.maturity.pct).toBe(100)
    expect(t1.maturity.label).toBe('Calibration complète')
    expect(t1.profile.coefficientCount).toBe(15)

    const t2 = json.find((t: { tenantId: string }) => t.tenantId === 't2')
    expect(t2.maturity.pct).toBe(2)
    expect(t2.maturity.label).toBe('Apprentissage')
    expect(t2.profile.coefficientCount).toBe(0)
    expect(t2.profile.lastComputedAt).toBeNull()
  })

  it('computes rejectionRate correctly', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'T1', slug: 't1', plan: 'pro' }])
    mockPrisma.interventionMetric.groupBy.mockResolvedValue([
      { tenantId: 't1', isReliable: true,  _count: 75 },
      { tenantId: 't1', isReliable: false, _count: 25 },
    ])
    mockPrisma.tenantMLProfile.groupBy.mockResolvedValue([])

    const req = makeReq('http://localhost/api/superadmin/ml-status', { method: 'GET' })
    const res = await mlStatusGet(req)
    const json = await res.json()

    expect(json[0].metrics.rejectionRate).toBe(25)
  })

  it('labels tenant with zero metrics as Aucune donnée', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'T1', slug: 't1', plan: 'free' }])
    mockPrisma.interventionMetric.groupBy.mockResolvedValue([])
    mockPrisma.tenantMLProfile.groupBy.mockResolvedValue([])

    const req = makeReq('http://localhost/api/superadmin/ml-status', { method: 'GET' })
    const res = await mlStatusGet(req)
    const json = await res.json()
    expect(json[0].maturity.label).toBe('Aucune donnée')
    expect(json[0].metrics.total).toBe(0)
    expect(json[0].metrics.rejectionRate).toBe(0)
  })
})
