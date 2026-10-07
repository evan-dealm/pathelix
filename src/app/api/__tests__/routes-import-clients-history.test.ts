import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    mission: { createMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    driver: { createMany: vi.fn() },
    client: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    site: { createMany: vi.fn(), count: vi.fn() },
    exutoire: { createMany: vi.fn() },
    holiday: { findMany: vi.fn(), create: vi.fn() },
    plan: { findFirst: vi.fn() },
    driverStatus: { upsert: vi.fn() },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId: vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-test',
    userId: 'user-1',
    role: 'admin',
    requestId: 'r1',
  })),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet: vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    timer: vi.fn(() => vi.fn()),
  }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC: { API_LATENCY_MS: 'l', API_REQUESTS: 'r', API_ERRORS: 'e' },
}))

vi.mock('@/lib/driverStatusPubSub', () => ({
  publishDriverStatus: vi.fn(),
}))

vi.mock('@/lib/integrationEvents', () => ({
  emitIntegrationEvent: vi.fn(),
}))

vi.mock('@/lib/metricCollector', () => ({
  collectInterventionMetric: vi.fn(),
}))

import { POST as postImport } from '@/app/api/import/route'
import { GET as getClients, POST as postClient } from '@/app/api/clients/route'
import { getRequestContext } from '@/lib/data/context'

const resetCtx = () =>
  vi
    .mocked(getRequestContext)
    .mockReturnValue({
      tenantId: 'tenant-test',
      userId: 'user-1',
      role: 'admin',
      requestId: 'r1',
    } as never)

function makePost(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeGet(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe('POST /api/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCtx()
  })

  it('imports missions successfully', async () => {
    mockPrisma.mission.createMany.mockResolvedValue({ count: 2 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'missions',
        data: [
          {
            type: 'POSER',
            date: '2026-04-01',
            address: '1 rue test',
            latitude: 45.76,
            longitude: 4.83,
          },
          { type: 'RETIRER', date: '2026-04-01', address: '2 rue test' },
        ],
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.imported).toBe(2)
    expect(json.errors).toHaveLength(0)
  })

  // Regression M1: VIDER/PAUSE are synthetic, VRP-generated-only mission types — bulk import
  // must not let a user create real Mission rows of these types.
  it('rejects VIDER/PAUSE rows on mission import', async () => {
    // Distinct tenantId so this doesn't share the 10/hour rate-limit bucket with the other
    // admin-role tests in this describe block (already at the limit by design/count).
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-m1-vider-pause',
      userId: 'user-1',
      role: 'admin',
      requestId: 'r1',
    } as never)
    mockPrisma.mission.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'missions',
        data: [
          {
            type: 'POSER',
            date: '2026-04-01',
            address: '1 rue test',
            latitude: 45.76,
            longitude: 4.83,
          },
          { type: 'VIDER', date: '2026-04-01', address: '2 rue test' },
          { type: 'PAUSE', date: '2026-04-01', address: '3 rue test' },
        ],
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.imported).toBe(1)
    expect(json.errors).toEqual([
      expect.stringContaining('VIDER'),
      expect.stringContaining('PAUSE'),
    ])
  })

  it('imports drivers successfully', async () => {
    mockPrisma.driver.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'drivers',
        data: [{ firstName: 'Jean', lastName: 'Dupont', sector: 'Nord', depotName: 'D1' }],
      }),
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
  })

  it('imports clients successfully', async () => {
    mockPrisma.client.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'clients',
        data: [{ name: 'ACME Corp', contact: 'John', phone: '0601020304' }],
      }),
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
  })

  it('imports sites successfully', async () => {
    mockPrisma.site.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'sites',
        data: [{ name: 'Chantier A', address: '1 rue A', latitude: 45.5, longitude: 4.5 }],
      }),
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
  })

  it('imports exutoires successfully', async () => {
    mockPrisma.exutoire.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'exutoires',
        data: [{ name: 'Centre Tri', address: '5 rue X', lat: 45.7, lng: 4.8 }],
      }),
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
  })

  it('applies column mapping', async () => {
    mockPrisma.mission.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'missions',
        data: [{ typ: 'POSER', dt: '2026-04-01', addr: 'rue test' }],
        columnMapping: { typ: 'type', dt: 'date', addr: 'address' },
      }),
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
  })

  it('reports partial errors (some rows fail)', async () => {
    mockPrisma.mission.createMany.mockResolvedValue({ count: 1 })

    const res = await postImport(
      makePost('/api/import', {
        type: 'missions',
        data: [
          // The valid row carries an address: like POST /api/missions, the import refuses a
          // mission without one (it used to be stored and could never be routed).
          { type: 'POSER', date: '2026-04-01', address: '12 rue de la Paix, Paris' },
          { type: 'BAD', date: '2026-04-01' },
        ],
      }),
    )
    const json = await res.json()

    expect(json.imported).toBe(1)
    expect(json.totalErrors).toBe(1)
  })

  it('rejects invalid type (422)', async () => {
    const res = await postImport(
      makePost('/api/import', {
        type: 'unknown',
        data: [{ name: 'test' }],
      }),
    )
    expect(res.status).toBe(422)
  })

  it('rejects empty data array (422)', async () => {
    const res = await postImport(
      makePost('/api/import', {
        type: 'missions',
        data: [],
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 't',
      userId: 'u',
      role: 'driver',
      requestId: 'r',
    } as never)

    const res = await postImport(
      makePost('/api/import', {
        type: 'missions',
        data: [{ type: 'POSER', date: '2026-04-01' }],
      }),
    )
    expect(res.status).toBe(403)
  })

  it('rejects invalid JSON (400)', async () => {
    const req = new NextRequest('http://localhost:3000/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    })
    const res = await postImport(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCtx()
  })

  it('returns client list', async () => {
    const clients = [{ id: 'c1', name: 'ACME', tenantId: 'tenant-test' }]
    mockPrisma.client.findMany.mockResolvedValue(clients)
    mockPrisma.client.count.mockResolvedValue(1)

    const res = await getClients(makeGet('/api/clients'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(res.headers.get('Cache-Control')).toContain('max-age=30')
  })

  it('returns 500 on error', async () => {
    mockPrisma.client.findMany.mockRejectedValue(new Error('fail'))

    const res = await getClients(makeGet('/api/clients'))
    expect(res.status).toBe(500)
  })

  // Regression: found via manual QA — the list select omitted contact/phone/email, so the
  // Catalogue > Clients table always rendered those columns as "—" no matter what was saved,
  // and the table's own contact/phone/email search filter could never match anything either.
  it('requests contact, phone and email in the list select', async () => {
    mockPrisma.client.findMany.mockResolvedValue([])
    mockPrisma.client.count.mockResolvedValue(0)

    await getClients(makeGet('/api/clients'))

    const select = mockPrisma.client.findMany.mock.calls[0][0].select
    expect(select).toMatchObject({ contact: true, phone: true, email: true })
  })

  // Regression: found via manual QA — MissionForm's "2. Site" step reads
  // client.clientSites?.map(cs => cs.site), but the list select never included that relation
  // (only the POST response did). Every client's site picker showed "-- Choisir un site --"
  // with zero options, and the client search dropdown always displayed "0 sites", even for a
  // client with real linked sites — a mission could never be created against a specific site.
  it('requests clientSites (with site) in the list select — MissionForm site picker depends on it', async () => {
    mockPrisma.client.findMany.mockResolvedValue([])
    mockPrisma.client.count.mockResolvedValue(0)

    await getClients(makeGet('/api/clients'))

    const select = mockPrisma.client.findMany.mock.calls[0][0].select
    expect(select.clientSites).toEqual({ include: { site: true } })
  })
})

describe('POST /api/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCtx()
  })

  it('creates a client (201)', async () => {
    mockPrisma.client.create.mockResolvedValue({ id: 'c-new', name: 'New Corp' })

    const res = await postClient(makePost('/api/clients', { name: 'New Corp' }))
    expect(res.status).toBe(201)
  })

  it('validates cross-tenant site linking', async () => {
    mockPrisma.site.count.mockResolvedValue(0)

    const res = await postClient(makePost('/api/clients', { name: 'Corp', siteIds: ['bad-site'] }))
    expect(res.status).toBe(400)
  })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 't',
      userId: 'u',
      role: 'dispatcher',
      requestId: 'r',
    } as never)

    const res = await postClient(makePost('/api/clients', { name: 'Corp' }))
    expect(res.status).toBe(403)
  })

  it('rejects empty name (422)', async () => {
    const res = await postClient(makePost('/api/clients', { name: '' }))
    expect(res.status).toBe(422)
  })
})
