import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Role defaults from the real permission table (no custom per-user grants in these tests).
vi.mock('@/lib/permissions', async (orig) => {
  const real = await orig<typeof import('@/lib/permissions')>()
  return {
    ...real,
    hasPermission: vi.fn(async (_userId: string, role: string, perm: string) =>
      role === 'admin' || role === 'superadmin' || (real.DEFAULT_PERMISSIONS[role] ?? []).includes(perm as never)),
  }
})

const mockPrisma = vi.hoisted(() => ({
  fuelRecord: {
    findMany: vi.fn(),
    create:   vi.fn(),
  },
  maintenanceRecord: {
    findMany: vi.fn(),
    create:   vi.fn(),
  },
  vehicle: {
    findFirst: vi.fn(),
  },
  driver: {
    findFirst: vi.fn(),
  },
  holiday: {
    findMany: vi.fn(),
    count:    vi.fn(),
    create:   vi.fn(),
  },
}))

vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    invalidateAll: vi.fn(),
    getOrSet: vi.fn((_model: string, _tid: string, fn: () => Promise<unknown>) => fn()),
  },
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { histogram: vi.fn(), increment: vi.fn() },
  METRIC:  { API_LATENCY_MS: 'api.latency', API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))

import { GET as fuelGET,        POST as fuelPOST }        from '@/app/api/fuel-records/route'
import { GET as maintenanceGET, POST as maintenancePOST } from '@/app/api/maintenance/route'
import { GET as holidayGET,     POST as holidayPOST }     from '@/app/api/holidays/route'
import { getRequestContext } from '@/lib/data/context'
import { redisCache } from '@/lib/redisCache'

function makeGet(url: string): NextRequest {
  return new NextRequest(url)
}

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeBadJson(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  })
}

describe('GET /api/fuel-records', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns all records (200)', async () => {
    mockPrisma.fuelRecord.findMany.mockResolvedValue([{ id: 'f-1', vehicleId: 'v-1', liters: 50 }])

    const res  = await fuelGET(makeGet('http://localhost:3000/api/fuel-records'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
    expect(json[0].liters).toBe(50)
  })

  it('filters by vehicleId query param', async () => {
    mockPrisma.fuelRecord.findMany.mockResolvedValue([])

    await fuelGET(makeGet('http://localhost:3000/api/fuel-records?vehicleId=v-1'))

    expect(mockPrisma.fuelRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ vehicleId: 'v-1' }) })
    )
  })

  it('returns all records when no vehicleId param', async () => {
    mockPrisma.fuelRecord.findMany.mockResolvedValue([])

    await fuelGET(makeGet('http://localhost:3000/api/fuel-records'))

    const call = mockPrisma.fuelRecord.findMany.mock.calls[0][0]
    expect(call.where).not.toHaveProperty('vehicleId')
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.fuelRecord.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await fuelGET(makeGet('http://localhost:3000/api/fuel-records'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/fuel-records', () => {
  const validBody = { vehicleId: 'v-1', liters: 50, costEur: 80, filledAt: '2026-04-01' }

  beforeEach(() => { vi.clearAllMocks() })

  it('creates fuel record (201)', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.fuelRecord.create.mockResolvedValue({ id: 'f-1', ...validBody, tenantId: 'tenant-test' })

    const res  = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.liters).toBe(50)
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', validBody))
    expect(res.status).toBe(403)
  })

  it('dispatcher is allowed (not 403)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.fuelRecord.create.mockResolvedValue({ id: 'f-1', ...validBody })

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', validBody))
    expect(res.status).toBe(201)
  })

  it('returns 422 for invalid date format', async () => {
    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', { ...validBody, filledAt: '01/04/2026' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for negative liters', async () => {
    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', { ...validBody, liters: -1 }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await fuelPOST(makeBadJson('http://localhost:3000/api/fuel-records'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when vehicle not found', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue(null)

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', validBody))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.fuelRecord.create.mockRejectedValue(new Error('DB fail'))

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', validBody))
    expect(res.status).toBe(500)
  })

  // Regression N19 (A6): FuelRecord.driverId has no DB-level FK — must be checked against
  // tenantId, same as DeliveryProof, or a driverId from another tenant could be written.
  it('returns 404 when driverId does not belong to this tenant', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.driver.findFirst.mockResolvedValue(null)

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', { ...validBody, driverId: 'd-other-tenant' }))
    expect(res.status).toBe(404)
    expect(mockPrisma.fuelRecord.create).not.toHaveBeenCalled()
  })

  it('creates fuel record when driverId belongs to this tenant', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.driver.findFirst.mockResolvedValue({ id: 'd-1' })
    mockPrisma.fuelRecord.create.mockResolvedValue({ id: 'f-1', ...validBody, driverId: 'd-1' })

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', { ...validBody, driverId: 'd-1' }))
    expect(res.status).toBe(201)
    expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith({ where: { id: 'd-1' }, select: { id: true } })
  })

  it('skips driver check when driverId is not provided', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.fuelRecord.create.mockResolvedValue({ id: 'f-1', ...validBody })

    const res = await fuelPOST(makePost('http://localhost:3000/api/fuel-records', validBody))
    expect(res.status).toBe(201)
    expect(mockPrisma.driver.findFirst).not.toHaveBeenCalled()
  })
})

describe('GET /api/maintenance', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns all records (200)', async () => {
    mockPrisma.maintenanceRecord.findMany.mockResolvedValue([{ id: 'mr-1', vehicleId: 'v-1', type: 'oil_change' }])

    const res  = await maintenanceGET(makeGet('http://localhost:3000/api/maintenance'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
    expect(json[0].type).toBe('oil_change')
  })

  it('filters by vehicleId query param', async () => {
    mockPrisma.maintenanceRecord.findMany.mockResolvedValue([])

    await maintenanceGET(makeGet('http://localhost:3000/api/maintenance?vehicleId=v-1'))

    expect(mockPrisma.maintenanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ vehicleId: 'v-1' }) })
    )
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.maintenanceRecord.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await maintenanceGET(makeGet('http://localhost:3000/api/maintenance'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/maintenance', () => {
  const validBody = { vehicleId: 'v-1', type: 'oil_change', doneAt: '2026-04-01' }

  beforeEach(() => { vi.clearAllMocks() })

  it('creates maintenance record (201)', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.maintenanceRecord.create.mockResolvedValue({ id: 'mr-1', ...validBody, tenantId: 'tenant-test' })

    const res  = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.type).toBe('oil_change')
  })

  // Changed on purpose: maintenance/fuel follow manage_vehicles (a dispatcher default) like the
  // vehicle itself — dispatchers saw these actions and always got 403. A driver still never may.
  it('lets a dispatcher (manage_vehicles by default) record maintenance', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)

    const res = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', validBody))
    expect(res.status).not.toBe(403)
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid maintenance type', async () => {
    const res = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', { ...validBody, type: 'invalid_type' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid date format', async () => {
    const res = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', { ...validBody, doneAt: 'not-a-date' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await maintenancePOST(makeBadJson('http://localhost:3000/api/maintenance'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when vehicle not found', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue(null)

    const res = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', validBody))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' })
    mockPrisma.maintenanceRecord.create.mockRejectedValue(new Error('DB fail'))

    const res = await maintenancePOST(makePost('http://localhost:3000/api/maintenance', validBody))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/holidays', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated holidays (200)', async () => {
    mockPrisma.holiday.findMany.mockResolvedValue([{ id: 'h-1', date: '2026-05-01', label: 'Fête du travail' }])
    mockPrisma.holiday.count.mockResolvedValue(1)

    const res  = await holidayGET(makeGet('http://localhost:3000/api/holidays'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.pagination.total).toBe(1)
    expect(json.pagination.page).toBe(1)
  })

  it('respects page and limit query params', async () => {
    mockPrisma.holiday.findMany.mockResolvedValue([])
    mockPrisma.holiday.count.mockResolvedValue(0)

    const res  = await holidayGET(makeGet('http://localhost:3000/api/holidays?page=2&limit=10'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.pagination.page).toBe(2)
    expect(json.pagination.limit).toBe(10)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(redisCache.getOrSet).mockRejectedValue(new Error('DB fail'))

    const res = await holidayGET(makeGet('http://localhost:3000/api/holidays'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/holidays', () => {
  const validBody = { date: '2026-05-01', label: 'Fête du travail' }

  beforeEach(() => { vi.clearAllMocks() })

  it('creates holiday (201)', async () => {
    mockPrisma.holiday.create.mockResolvedValue({ id: 'h-1', tenantId: 'tenant-test', ...validBody })

    const res  = await holidayPOST(makePost('http://localhost:3000/api/holidays', validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.label).toBe('Fête du travail')
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await holidayPOST(makePost('http://localhost:3000/api/holidays', validBody))
    expect(res.status).toBe(403)
  })

  it('dispatcher is allowed (not 403)', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)
    mockPrisma.holiday.create.mockResolvedValue({ id: 'h-1', ...validBody })

    const res = await holidayPOST(makePost('http://localhost:3000/api/holidays', validBody))
    expect(res.status).toBe(201)
  })

  it('returns 422 for missing label', async () => {
    const res = await holidayPOST(makePost('http://localhost:3000/api/holidays', { date: '2026-05-01' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid date format', async () => {
    const res = await holidayPOST(makePost('http://localhost:3000/api/holidays', { date: 'not-a-date', label: 'Test' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await holidayPOST(makeBadJson('http://localhost:3000/api/holidays'))
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate date (P2002)', async () => {
    const err = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
    mockPrisma.holiday.create.mockRejectedValue(err)

    const res = await holidayPOST(makePost('http://localhost:3000/api/holidays', validBody))
    expect(res.status).toBe(409)
  })

  it('returns 500 on other DB error', async () => {
    mockPrisma.holiday.create.mockRejectedValue(new Error('DB fail'))

    const res = await holidayPOST(makePost('http://localhost:3000/api/holidays', validBody))
    expect(res.status).toBe(500)
  })
})
