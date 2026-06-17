import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin', trade: null })),
  getTenantId: vi.fn(() => 't1'),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: { plan: { findMany: mockFindMany } },
}))

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/reports/co2')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

const PLAN_DIESEL = {
  driverId: 'd1',
  missions: [
    { isSynthetic: false, roadDistKm: 100 },
    { isSynthetic: false, roadDistKm: 50  },
    { isSynthetic: true,  roadDistKm: 10  },
  ],
  driver: { id: 'd1', firstName: 'Jean', lastName: 'Dupont', sector: 'Nord', vehicles: [{ fuelType: 'diesel', weightTon: 10 }] },
}

const PLAN_ELECTRIQUE = {
  driverId: 'd2',
  missions: [{ isSynthetic: false, roadDistKm: 200 }],
  driver: { id: 'd2', firstName: 'Marie', lastName: 'Curie', sector: 'Sud', vehicles: [{ fuelType: 'electrique', weightTon: 5 }] },
}

// ─── Mock mode (USE_MOCK_DATA default: ON) ────────────────────────────────────

describe('GET /api/reports/co2 — mock mode', () => {
  it('returns zeroed response in mock mode', async () => {
    const { GET } = await import('@/app/api/reports/co2/route')
    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.totalKm).toBe(0)
    expect(body.totalCO2Kg).toBe(0)
    expect(body.byDriver).toEqual([])
  })
})

// ─── Real mode (USE_MOCK_DATA=false) — fresh module per suite ────────────────

describe('GET /api/reports/co2 — real mode', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    // Re-mock dependencies so fresh module instance picks them up
    vi.mock('@/lib/data/context', () => ({
      getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin', trade: null })),
      getTenantId: vi.fn(() => 't1'),
    }))
    vi.mock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.mock('@/lib/db', () => ({
      default: { plan: { findMany: mockFindMany } },
    }))
    const mod = await import('@/app/api/reports/co2/route')
    GET = mod.GET
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('validates date format — rejects invalid from', async () => {
    vi.clearAllMocks()
    const res = await GET(makeReq({ from: 'not-a-date', to: '2026-06-15' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalides/i)
  })

  it('validates date format — rejects invalid to', async () => {
    vi.clearAllMocks()
    const res = await GET(makeReq({ from: '2026-01-01', to: '2026/06/15' }))
    expect(res.status).toBe(400)
  })

  it('returns correct CO2 for diesel vehicle (270 g/km)', async () => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValueOnce([PLAN_DIESEL])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalKm).toBe(150)
    expect(body.totalCO2Kg).toBe(40.5) // 150 × 270g/km = 40500g = 40.5kg
    expect(body.byDriver).toHaveLength(1)
    expect(body.byDriver[0].fuelType).toBe('diesel')
  })

  it('returns correct CO2 for electric vehicle (12 g/km)', async () => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValueOnce([PLAN_ELECTRIQUE])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body.totalKm).toBe(200)
    expect(body.totalCO2Kg).toBe(2.4) // 200 × 12g/km = 2400g = 2.4kg
    expect(body.byFuelType).toHaveProperty('electrique')
  })

  it('aggregates multiple plans for same driver', async () => {
    vi.clearAllMocks()
    const plan2 = { ...PLAN_DIESEL, missions: [{ isSynthetic: false, roadDistKm: 50 }] }
    mockFindMany.mockResolvedValueOnce([PLAN_DIESEL, plan2])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body.byDriver[0].totalKm).toBe(200) // 150 + 50
  })

  it('breaks down by fuel type', async () => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValueOnce([PLAN_DIESEL, PLAN_ELECTRIQUE])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body.byFuelType).toHaveProperty('diesel')
    expect(body.byFuelType).toHaveProperty('electrique')
    expect(body.byDriver).toHaveLength(2)
  })

  it('uses default fuel type (diesel) when vehicle has no fuelType', async () => {
    vi.clearAllMocks()
    const planNoFuel = { ...PLAN_DIESEL, driver: { ...PLAN_DIESEL.driver, vehicles: [] } }
    mockFindMany.mockResolvedValueOnce([planNoFuel])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body.byDriver[0].fuelType).toBe('diesel')
  })

  it('falls back to CO2_DEFAULT (270) for unknown fuel type', async () => {
    vi.clearAllMocks()
    const planUnknown = {
      ...PLAN_DIESEL,
      missions: [{ isSynthetic: false, roadDistKm: 100 }],
      driver: { ...PLAN_DIESEL.driver, vehicles: [{ fuelType: 'hydrogen', weightTon: 5 }] },
    }
    mockFindMany.mockResolvedValueOnce([planUnknown])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body.totalCO2Kg).toBe(27) // 100km × 270g/km = 27kg
  })

  it('skips synthetic missions in distance calculation', async () => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValueOnce([PLAN_DIESEL])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body.totalKm).toBe(150) // 100+50, not 160 (synthetic excluded)
  })

  it('handles DB error gracefully (500)', async () => {
    vi.clearAllMocks()
    mockFindMany.mockRejectedValueOnce(new Error('DB down'))

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/erreur serveur/i)
  })

  it('returns totalCO2T (tonnes) field', async () => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValueOnce([
      { ...PLAN_DIESEL, missions: [{ isSynthetic: false, roadDistKm: 10000 }] },
    ])

    const res = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()

    expect(body).toHaveProperty('totalCO2T')
    expect(typeof body.totalCO2T).toBe('number')
  })

  it('uses default date range when params omitted', async () => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValueOnce([])

    const res = await GET(makeReq()) // no from/to
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalKm).toBe(0)
    expect(Array.isArray(body.byDriver)).toBe(true)
  })

  it('skips plan when missions field is not an array', async () => {
    vi.clearAllMocks()
    const planBadMissions = { ...PLAN_DIESEL, missions: 'not-an-array' }
    mockFindMany.mockResolvedValueOnce([planBadMissions])

    const res  = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.totalKm).toBe(0)
  })

  it('handles mission without roadDistKm field (defaults to 0)', async () => {
    vi.clearAllMocks()
    const planNoKm = { ...PLAN_DIESEL, missions: [{ isSynthetic: false }] }
    mockFindMany.mockResolvedValueOnce([planNoKm])

    const res  = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()
    expect(body.totalKm).toBe(0)
    expect(body.totalCO2Kg).toBe(0)
  })

  it('handles électrique (accent) fuel type alias (12 g/km)', async () => {
    vi.clearAllMocks()
    const planAccent = {
      ...PLAN_DIESEL,
      missions: [{ isSynthetic: false, roadDistKm: 100 }],
      driver: { ...PLAN_DIESEL.driver, vehicles: [{ fuelType: 'électrique', weightTon: 5 }] },
    }
    mockFindMany.mockResolvedValueOnce([planAccent])

    const res  = await GET(makeReq({ from: '2026-06-01', to: '2026-06-15' }))
    const body = await res.json()
    expect(body.totalCO2Kg).toBe(1.2) // 100km × 12g/km = 1.2kg
    expect(body.byFuelType).toHaveProperty('électrique')
  })
})
