import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {

  process.env.USE_MOCK_DATA = 'false'

  process.env.NESSY_WEBHOOK_SECRET = 'test-secret-health-ok'
  const mockPrisma = {
    $queryRaw: vi.fn(),
    // Default to "at least one tenant has a Nessy integration configured" so these unrelated
    // tests get a healthy baseline (matches the old env-var-based workaround this replaced).
    integration: { count: vi.fn(() => Promise.resolve(1)) },
    userPermission: { findMany: vi.fn(() => Promise.resolve([])) },
    vehicle: {
      findMany:   vi.fn(),
      findFirst:  vi.fn(),
      count:      vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(),
  getExutoire:    vi.fn(),
  createExutoire: vi.fn(),
  updateExutoire: vi.fn(),
  deleteExutoire: vi.fn(),
}))

vi.mock('@/lib/data/missions', () => ({
  getMission:    vi.fn(),
  updateMission: vi.fn(),
  deleteMission: vi.fn(),
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
    snapshot:  vi.fn(() => ({ counters: {}, histograms: {} })),
  },
  METRIC: {
    API_LATENCY_MS: 'api.latency_ms',
    API_REQUESTS:   'api.requests',
    API_ERRORS:     'api.errors',
  },
}))

vi.mock('@/lib/circuitBreaker', () => ({
  getAllCircuitStates: vi.fn(() => ({})),
}))

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession:  vi.fn(),
}))

import { GET as healthGet }                                   from '@/app/api/health/route'
import { GET as vehiclesGet, POST as vehiclesPost }           from '@/app/api/vehicles/route'
import { GET as vehicleGet, PUT as vehiclePut, DELETE as vehicleDelete } from '@/app/api/vehicles/[id]/route'
import { GET as exutoiresGet, POST as exutoiresPost }         from '@/app/api/exutoires/route'
import { GET as exutoireGet, PUT as exutoirePut, DELETE as exutoireDelete } from '@/app/api/exutoires/[id]/route'
import { GET as missionGet, PUT as missionPut, DELETE as missionDelete } from '@/app/api/missions/[id]/route'

import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getAllExutoires, getExutoire, createExutoire, updateExutoire, deleteExutoire } from '@/lib/data/exutoires'
import { getMission, updateMission, deleteMission } from '@/lib/data/missions'
import { verifySession } from '@/lib/session'
import { getAllCircuitStates } from '@/lib/circuitBreaker'

function makeRequest(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string> } = {},
): NextRequest {
  const init = {
    method:  opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body:    opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }
  const req = new NextRequest(url, init)

  if (opts.cookies) {
    for (const [k, v] of Object.entries(opts.cookies)) {
      req.cookies.set(k, v)
    }
  }
  return req
}

function makeIdParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/health', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns basic status for unauthenticated request (200)', async () => {
    vi.mocked(verifySession).mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/health')
    const res = await healthGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.status).toBe('ok')

    expect(json.checks).toBeUndefined()
  })

  it('returns detailed info for authenticated request (200)', async () => {
    vi.mocked(verifySession).mockResolvedValue({ tenantId: 'tenant-test', role: 'admin', email: 'a@b.c' } as never)

    const req = makeRequest('http://localhost:3000/api/health', {
      cookies: { session: 'valid-token' },
    })
    const res = await healthGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.status).toBe('ok')
    expect(json.checks).toBeDefined()
    expect(json.checks.db).toBeDefined()
  })

  it('returns 503 when circuit breaker is OPEN (authenticated)', async () => {
    vi.mocked(verifySession).mockResolvedValue({ tenantId: 'tenant-test', role: 'admin', email: 'a@b.c' } as never)
    vi.mocked(getAllCircuitStates).mockReturnValue({ geocoding: 'OPEN' })

    const req = makeRequest('http://localhost:3000/api/health', {
      cookies: { session: 'valid-token' },
    })
    const res = await healthGet(req)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.status).toBe('degraded')
  })

  it('returns 503 with basic status for unauthenticated when degraded', async () => {
    vi.mocked(verifySession).mockResolvedValue(null)
    vi.mocked(getAllCircuitStates).mockReturnValue({ geocoding: 'OPEN' })

    const req = makeRequest('http://localhost:3000/api/health')
    const res = await healthGet(req)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.status).toBe('degraded')
    expect(json.checks).toBeUndefined()
  })

  it('includes valhalla:unconfigured when VALHALLA_URL is not set', async () => {
    delete process.env.VALHALLA_URL
    vi.mocked(verifySession).mockResolvedValue({ tenantId: 'tenant-test', role: 'admin', email: 'a@b.c' } as never)
    vi.mocked(getAllCircuitStates).mockReturnValue({})

    const req = makeRequest('http://localhost:3000/api/health', { cookies: { session: 'valid-token' } })
    const res  = await healthGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.checks.valhalla).toBe('unconfigured')
  })

  it('returns 503 when VALHALLA_URL is set but unreachable (authenticated)', async () => {
    process.env.VALHALLA_URL = 'http://valhalla:8002'
    vi.mocked(verifySession).mockResolvedValue({ tenantId: 'tenant-test', role: 'admin', email: 'a@b.c' } as never)
    vi.mocked(getAllCircuitStates).mockReturnValue({})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused') }))

    const req = makeRequest('http://localhost:3000/api/health', { cookies: { session: 'valid-token' } })
    const res  = await healthGet(req)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.status).toBe('degraded')
    expect(json.checks.valhalla).toBe('degraded')

    delete process.env.VALHALLA_URL
    vi.unstubAllGlobals()
  })
})

describe('GET /api/vehicles', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns vehicles with pagination metadata', async () => {
    const vehicles = [
      { id: 'v-1', licensePlate: 'AA-111-BB', type: 'Ampliroll' },
      { id: 'v-2', licensePlate: 'CC-222-DD', type: 'Grue' },
    ]
    mockPrisma.vehicle.findMany.mockResolvedValue(vehicles)
    mockPrisma.vehicle.count.mockResolvedValue(2)

    const req = makeRequest('http://localhost:3000/api/vehicles')
    const res = await vehiclesGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(2)
    expect(json.pagination).toBeDefined()
    expect(json.pagination.total).toBe(2)
  })

  it('returns empty array when no vehicles exist', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValue([])
    mockPrisma.vehicle.count.mockResolvedValue(0)

    const req = makeRequest('http://localhost:3000/api/vehicles')
    const res = await vehiclesGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(0)
    expect(json.pagination.total).toBe(0)
  })

  // Regression: found via manual QA — the list select only covered the physical-gabarit
  // fields, so the Camions table's Type/Marque/Modele/Capacite/Kilometrage columns were
  // always blank and Statut always showed "Actif" regardless of the real value, for every
  // vehicle, always. Worse: the edit modal seeds its form straight from this same list row
  // (no separate per-vehicle fetch), so saving an edit would silently blank out or reset
  // those fields on the real record.
  it('requests every field the Camions table and edit form read', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValue([])
    mockPrisma.vehicle.count.mockResolvedValue(0)

    await vehiclesGet(makeRequest('http://localhost:3000/api/vehicles'))

    const select = mockPrisma.vehicle.findMany.mock.calls[0][0].select
    expect(select).toMatchObject({
      type: true, brand: true, model: true, capacityM3: true, maxBins: true,
      mileageKm: true, nextInspection: true, status: true, notes: true,
    })
  })

  it('supports pagination parameters', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValue([{ id: 'v-3' }])
    mockPrisma.vehicle.count.mockResolvedValue(10)

    const req = makeRequest('http://localhost:3000/api/vehicles?page=2&limit=3')
    const res = await vehiclesGet(req)
    const json = await res.json()

    expect(json.pagination.page).toBe(2)
    expect(json.pagination.limit).toBe(3)
    expect(json.pagination.total).toBe(10)
  })

  it('returns 500 when prisma throws', async () => {
    mockPrisma.vehicle.findMany.mockRejectedValue(new Error('DB down'))
    mockPrisma.vehicle.count.mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/vehicles')
    const res = await vehiclesGet(req)

    expect(res.status).toBe(500)
  })

  it('uses correct tenantId from context', async () => {
    vi.mocked(getTenantId).mockReturnValue('custom-tenant')
    mockPrisma.vehicle.findMany.mockResolvedValue([])
    mockPrisma.vehicle.count.mockResolvedValue(0)

    const req = makeRequest('http://localhost:3000/api/vehicles')
    await vehiclesGet(req)

    expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'custom-tenant' } }),
    )
  })
})

describe('POST /api/vehicles', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const validBody = {
    licensePlate: 'AB-123-CD',
    type:         'Ampliroll',
  }

  it('creates a vehicle with valid input (201)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    const created = { id: 'v-new', ...validBody, tenantId: 'tenant-test' }
    mockPrisma.vehicle.create.mockResolvedValue(created)

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: validBody })
    const res = await vehiclesPost(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.id).toBe('v-new')
  })

  it('returns 403 for non-admin/non-dispatcher', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: validBody })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(403)
  })

  it('validates input — rejects missing required fields (422)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: { type: 'Ampliroll' } })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = new NextRequest('http://localhost:3000/api/vehicles', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(400)
  })

  it('returns 409 for duplicate licensePlate (P2002)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    const err = new Error('Unique constraint') as Error & { code: string }
    err.code = 'P2002'
    mockPrisma.vehicle.create.mockRejectedValue(err)

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: validBody })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(409)
  })

  it('returns 500 when prisma throws unexpected error', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.vehicle.create.mockRejectedValue(new Error('Unknown'))

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: validBody })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(500)
  })

  // Regression A7: hasPermission('manage_vehicles') wired in on top of the existing role check.
  // Distinct userIds per test — hasPermission() caches its DB lookup per userId for 60s, so
  // reusing the same userId across tests in this file would silently serve a stale cached result.
  it('dispatcher with no custom UserPermission gets the role default (manage_vehicles included, 201)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'disp-default', role: 'dispatcher', requestId: 'r', trade: null })
    mockPrisma.userPermission.findMany.mockResolvedValueOnce([])
    mockPrisma.vehicle.create.mockResolvedValue({ id: 'v-new', ...validBody, tenantId: 'tenant-test' })

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: validBody })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(201)
  })

  it('dispatcher with manage_vehicles explicitly revoked gets 403', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'disp-revoked', role: 'dispatcher', requestId: 'r', trade: null })
    mockPrisma.userPermission.findMany.mockResolvedValueOnce([{ permission: 'manage_missions' }] as never)

    const req = makeRequest('http://localhost:3000/api/vehicles', { method: 'POST', body: validBody })
    const res = await vehiclesPost(req)

    expect(res.status).toBe(403)
    expect(mockPrisma.vehicle.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/vehicles/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns a vehicle by id', async () => {
    const vehicle = { id: 'v-1', licensePlate: 'AA-111-BB', type: 'Ampliroll', tenantId: 'tenant-test' }
    mockPrisma.vehicle.findFirst.mockResolvedValue(vehicle)

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1')
    const res = await vehicleGet(req, makeIdParams('v-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('v-1')
  })

  it('returns 404 for unknown vehicle', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/vehicles/unknown')
    const res = await vehicleGet(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 500 on data layer error', async () => {
    mockPrisma.vehicle.findFirst.mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1')
    const res = await vehicleGet(req, makeIdParams('v-1'))

    expect(res.status).toBe(500)
  })
})

describe('PUT /api/vehicles/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates a vehicle with valid partial input', async () => {
    const updated = { id: 'v-1', licensePlate: 'AA-111-BB', type: 'Grue', tenantId: 'tenant-test' }
    mockPrisma.vehicle.update.mockResolvedValue(updated)

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', {
      method: 'PUT',
      body:   { type: 'Grue' },
    })
    const res = await vehiclePut(req, makeIdParams('v-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.type).toBe('Grue')
  })

  it('returns 404 when vehicle not found (P2025)', async () => {
    const err = new Error('Record not found') as Error & { code: string }
    err.code = 'P2025'
    mockPrisma.vehicle.update.mockRejectedValue(err)

    const req = makeRequest('http://localhost:3000/api/vehicles/unknown', {
      method: 'PUT',
      body:   { type: 'Grue' },
    })
    const res = await vehiclePut(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 409 for duplicate licensePlate (P2002)', async () => {
    const err = new Error('Unique constraint') as Error & { code: string }
    err.code = 'P2002'
    mockPrisma.vehicle.update.mockRejectedValue(err)

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', {
      method: 'PUT',
      body:   { licensePlate: 'DUPE' },
    })
    const res = await vehiclePut(req, makeIdParams('v-1'))

    expect(res.status).toBe(409)
  })

  it('returns 422 for invalid data', async () => {
    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', {
      method: 'PUT',
      body:   { capacityM3: -5 },
    })
    const res = await vehiclePut(req, makeIdParams('v-1'))

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/vehicles/v-1', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await vehiclePut(req, makeIdParams('v-1'))

    expect(res.status).toBe(400)
  })

  it('returns 500 on unexpected error', async () => {
    mockPrisma.vehicle.update.mockRejectedValue(new Error('Unknown'))

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', {
      method: 'PUT',
      body:   { type: 'Grue' },
    })
    const res = await vehiclePut(req, makeIdParams('v-1'))

    expect(res.status).toBe(500)
  })

  // Found during the A7/N22 follow-up privilege-escalation review: PUT /api/vehicles/[id] had
  // NO role gate at all before this session's fix — any authenticated role, including driver,
  // could modify any vehicle on the tenant. Distinct userId to avoid hasPermission()'s 60s cache.
  it('driver role (no default permissions) gets 403, vehicle not updated', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'driver-veh-put', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', {
      method: 'PUT',
      body:   { type: 'Grue' },
    })
    const res = await vehiclePut(req, makeIdParams('v-1'))

    expect(res.status).toBe(403)
    expect(mockPrisma.vehicle.update).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/vehicles/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('soft-deletes a vehicle (archived=true)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    mockPrisma.vehicle.updateMany.mockResolvedValue({ count: 1 })

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', { method: 'DELETE' })
    const res = await vehicleDelete(req, makeIdParams('v-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockPrisma.vehicle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'v-1' }),
        data:  { archived: true },
      }),
    )
  })

  it('returns 404 when vehicle not found', async () => {
    mockPrisma.vehicle.updateMany.mockResolvedValue({ count: 0 })

    const req = makeRequest('http://localhost:3000/api/vehicles/unknown', { method: 'DELETE' })
    const res = await vehicleDelete(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 500 on data layer error', async () => {
    mockPrisma.vehicle.updateMany.mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', { method: 'DELETE' })
    const res = await vehicleDelete(req, makeIdParams('v-1'))

    expect(res.status).toBe(500)
  })

  // Found during the A7/N22 follow-up privilege-escalation review: DELETE /api/vehicles/[id]
  // had NO role gate at all before this session's fix — any authenticated role, including
  // driver, could delete (archive) any vehicle on the tenant. Distinct userId to avoid
  // hasPermission()'s 60s cache.
  it('driver role (no default permissions) gets 403, vehicle not deleted', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'driver-veh-del', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/vehicles/v-1', { method: 'DELETE' })
    const res = await vehicleDelete(req, makeIdParams('v-1'))

    expect(res.status).toBe(403)
    expect(mockPrisma.vehicle.updateMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/exutoires', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns exutoires array', async () => {
    const exutoires = [
      { id: 'e-1', name: 'Centre A', address: '1 rue X', lat: 45.76, lng: 4.83 },
      { id: 'e-2', name: 'Centre B', address: '2 rue Y', lat: 45.70, lng: 4.80 },
    ]
    vi.mocked(getAllExutoires).mockResolvedValue(exutoires as never)

    const req = makeRequest('http://localhost:3000/api/exutoires')
    const res = await exutoiresGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(2)
  })

  it('returns empty array when no exutoires exist', async () => {
    vi.mocked(getAllExutoires).mockResolvedValue([])

    const req = makeRequest('http://localhost:3000/api/exutoires')
    const res = await exutoiresGet(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(0)
  })

  it('returns 500 when data layer throws', async () => {
    vi.mocked(getAllExutoires).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/exutoires')
    const res = await exutoiresGet(req)

    expect(res.status).toBe(500)
  })

  it('uses correct tenantId from context', async () => {
    vi.mocked(getTenantId).mockReturnValue('custom-tenant')
    vi.mocked(getAllExutoires).mockResolvedValue([])

    const req = makeRequest('http://localhost:3000/api/exutoires')
    await exutoiresGet(req)

    expect(getAllExutoires).toHaveBeenCalledWith('custom-tenant')
  })
})

describe('POST /api/exutoires', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const validBody = {
    name:               'Centre de tri Nord',
    address:            '10 rue Lyon',
    lat:                45.764,
    lng:                4.836,
    openingHoursOpen:   480,
    openingHoursClose:  1080,
    closedDays:         [0, 6],
    acceptedWasteTypes: ['DIB', 'Bois'],
    serviceTimeMin:     15,
  }

  it('creates an exutoire with valid input (201)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    const created = { id: 'e-new', ...validBody }
    vi.mocked(createExutoire).mockResolvedValue(created)

    const req = makeRequest('http://localhost:3000/api/exutoires', { method: 'POST', body: validBody })
    const res = await exutoiresPost(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.id).toBe('e-new')
  })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/exutoires', { method: 'POST', body: validBody })
    const res = await exutoiresPost(req)

    expect(res.status).toBe(403)
  })

  it('validates input — rejects missing required fields (422)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/exutoires', { method: 'POST', body: { name: 'X' } })
    const res = await exutoiresPost(req)

    expect(res.status).toBe(422)
  })

  it('validates input — rejects invalid coordinates (422)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/exutoires', { method: 'POST', body: { ...validBody, lat: 95 } })
    const res = await exutoiresPost(req)

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = new NextRequest('http://localhost:3000/api/exutoires', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await exutoiresPost(req)

    expect(res.status).toBe(400)
  })

  it('returns 500 when data layer throws', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    vi.mocked(createExutoire).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/exutoires', { method: 'POST', body: validBody })
    const res = await exutoiresPost(req)

    expect(res.status).toBe(500)
  })
})

describe('GET /api/exutoires/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns an exutoire by id', async () => {
    const exutoire = { id: 'e-1', name: 'Centre A', address: '1 rue X', lat: 45.76, lng: 4.83 }
    vi.mocked(getExutoire).mockResolvedValue(exutoire as never)

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1')
    const res = await exutoireGet(req, makeIdParams('e-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('e-1')
  })

  it('returns 404 for unknown exutoire', async () => {
    vi.mocked(getExutoire).mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/exutoires/unknown')
    const res = await exutoireGet(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 500 on data layer error', async () => {
    vi.mocked(getExutoire).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1')
    const res = await exutoireGet(req, makeIdParams('e-1'))

    expect(res.status).toBe(500)
  })
})

describe('PUT /api/exutoires/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates an exutoire with valid partial input', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    const updated = { id: 'e-1', name: 'Updated', address: '1 rue X', lat: 45.76, lng: 4.83, openingHoursOpen: 420, openingHoursClose: 1080, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15 }
    vi.mocked(updateExutoire).mockResolvedValue(updated as never)

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', {
      method: 'PUT',
      body:   { name: 'Updated' },
    })
    const res = await exutoirePut(req, makeIdParams('e-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.name).toBe('Updated')
  })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', {
      method: 'PUT',
      body:   { name: 'X' },
    })
    const res = await exutoirePut(req, makeIdParams('e-1'))

    expect(res.status).toBe(403)
  })

  it('returns 404 when exutoire not found', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    vi.mocked(updateExutoire).mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/exutoires/unknown', {
      method: 'PUT',
      body:   { name: 'X' },
    })
    const res = await exutoirePut(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid data', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', {
      method: 'PUT',
      body:   { lat: 200 },
    })
    const res = await exutoirePut(req, makeIdParams('e-1'))

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })

    const req = new NextRequest('http://localhost:3000/api/exutoires/e-1', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await exutoirePut(req, makeIdParams('e-1'))

    expect(res.status).toBe(400)
  })

  it('returns 500 on data layer error', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    vi.mocked(updateExutoire).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', {
      method: 'PUT',
      body:   { name: 'X' },
    })
    const res = await exutoirePut(req, makeIdParams('e-1'))

    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/exutoires/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes an exutoire successfully', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    vi.mocked(deleteExutoire).mockResolvedValue(true)

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', { method: 'DELETE' })
    const res = await exutoireDelete(req, makeIdParams('e-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 403 for non-admin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r', trade: null })

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', { method: 'DELETE' })
    const res = await exutoireDelete(req, makeIdParams('e-1'))

    expect(res.status).toBe(403)
  })

  it('returns 404 when exutoire not found', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    vi.mocked(deleteExutoire).mockResolvedValue(false)

    const req = makeRequest('http://localhost:3000/api/exutoires/unknown', { method: 'DELETE' })
    const res = await exutoireDelete(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 500 on data layer error', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'admin', requestId: 'r', trade: null })
    vi.mocked(deleteExutoire).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/exutoires/e-1', { method: 'DELETE' })
    const res = await exutoireDelete(req, makeIdParams('e-1'))

    expect(res.status).toBe(500)
  })
})

describe('GET /api/missions/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns a mission by id', async () => {
    const mission = { id: 'm-1', type: 'POSER' as const, date: '2026-03-20', address: '1 rue X', latitude: 45.76, longitude: 4.83, estimatedDurationMin: 30, maneuverTimeMin: 15 }
    vi.mocked(getMission).mockResolvedValue(mission as never)

    const req = makeRequest('http://localhost:3000/api/missions/m-1')
    const res = await missionGet(req, makeIdParams('m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('m-1')
  })

  it('returns 404 for unknown mission', async () => {
    vi.mocked(getMission).mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/missions/unknown')
    const res = await missionGet(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 500 on data layer error', async () => {
    vi.mocked(getMission).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/missions/m-1')
    const res = await missionGet(req, makeIdParams('m-1'))

    expect(res.status).toBe(500)
  })
})

describe('PUT /api/missions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMission).mockResolvedValue(null)
  })

  it('updates a mission with valid partial input', async () => {
    const updated = { id: 'm-1', type: 'RETIRER' as const, date: '2026-03-20', address: '1 rue X', latitude: 45.76, longitude: 4.83, estimatedDurationMin: 30, maneuverTimeMin: 10 }
    vi.mocked(updateMission).mockResolvedValue(updated as never)

    const req = makeRequest('http://localhost:3000/api/missions/m-1', {
      method: 'PUT',
      body:   { type: 'RETIRER' },
    })
    const res = await missionPut(req, makeIdParams('m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.type).toBe('RETIRER')
  })

  it('returns 404 when mission not found', async () => {
    vi.mocked(updateMission).mockResolvedValue(null)

    const req = makeRequest('http://localhost:3000/api/missions/unknown', {
      method: 'PUT',
      body:   { type: 'RETIRER' },
    })
    const res = await missionPut(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid data', async () => {
    const req = makeRequest('http://localhost:3000/api/missions/m-1', {
      method: 'PUT',
      body:   { type: 'INVALID_TYPE' },
    })
    const res = await missionPut(req, makeIdParams('m-1'))

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/missions/m-1', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    'not valid json{{{',
    })
    const res = await missionPut(req, makeIdParams('m-1'))

    expect(res.status).toBe(400)
  })

  it('returns 500 on data layer error', async () => {
    vi.mocked(updateMission).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/missions/m-1', {
      method: 'PUT',
      body:   { address: 'New address' },
    })
    const res = await missionPut(req, makeIdParams('m-1'))

    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/missions/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes a mission successfully', async () => {
    const existing = { id: 'm-1', type: 'POSER' as const, date: '2026-03-20', address: '1 rue X', latitude: 45.76, longitude: 4.83, estimatedDurationMin: 30, maneuverTimeMin: 15 }
    vi.mocked(getMission).mockResolvedValue(existing as never)
    vi.mocked(deleteMission).mockResolvedValue(true)

    const req = makeRequest('http://localhost:3000/api/missions/m-1', { method: 'DELETE' })
    const res = await missionDelete(req, makeIdParams('m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 404 when mission not found', async () => {
    vi.mocked(getMission).mockResolvedValue(null)
    vi.mocked(deleteMission).mockResolvedValue(false)

    const req = makeRequest('http://localhost:3000/api/missions/unknown', { method: 'DELETE' })
    const res = await missionDelete(req, makeIdParams('unknown'))

    expect(res.status).toBe(404)
  })

  it('returns 500 on data layer error', async () => {
    vi.mocked(getMission).mockRejectedValue(new Error('DB down'))

    const req = makeRequest('http://localhost:3000/api/missions/m-1', { method: 'DELETE' })
    const res = await missionDelete(req, makeIdParams('m-1'))

    expect(res.status).toBe(500)
  })
})
