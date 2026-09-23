import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => mockLog,
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
}))

const mockCalcTour         = vi.hoisted(() => vi.fn())
const mockGeneratePdfViaWorker = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-tour')))
vi.mock('@/lib/algorithm', () => ({ calcTour: mockCalcTour }))
vi.mock('@/lib/queue/pdfQueue', () => ({ generatePdfViaWorker: mockGeneratePdfViaWorker }))

const mockDriverFindFirst = vi.hoisted(() => vi.fn())
const mockPlanFindFirst   = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    driver: { findFirst: mockDriverFindFirst },
    plan:   { findFirst: mockPlanFindFirst   },
  }),
}))

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/tours/pdf')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

const DB_DRIVER = {
  id: 'd1', firstName: 'Jean', lastName: 'Dupont',
  sector: 'Nord', depotName: 'Dépôt 1',
  depotLat: 48.85, depotLng: 2.35,
  vehicleCapacity: 1, maxBinSizeM3: null,
  notes: null, startingExutoireId: null,
  weeklyHoursMax: 48, archived: false,
}
const DB_PLAN = {
  missions:  [{ id: 'm1', sequenceOrder: 1, address: '1 Rue Test' }],
  startTime: '08:00',
  speedKmh:  50,
}
const TOUR_RESULT = { steps: [], totalRoadDistKm: 25, totalDurationMin: 90 }

// ─── Mock mode (USE_MOCK_DATA default ON) ─────────────────────────────────────

describe('GET /api/tours/pdf — mock mode', () => {
  it('returns 503 in mock mode (even with valid params)', async () => {
    const { GET } = await import('@/app/api/tours/pdf/route')
    const res = await GET(makeReq({ driverId: 'd1', date: '2026-06-15' }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/mock/i)
  })
})

// ─── Real mode (USE_MOCK_DATA=false) ─────────────────────────────────────────

describe('GET /api/tours/pdf — real mode', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    vi.mock('@/lib/data/context', () => ({
      getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
    }))
    vi.mock('@/lib/logger', () => ({
      createLogger: () => mockLog,
    }))
    vi.mock('@/lib/algorithm', () => ({ calcTour: mockCalcTour }))
    vi.mock('@/lib/queue/pdfQueue', () => ({ generatePdfViaWorker: mockGeneratePdfViaWorker }))
    vi.mock('@/lib/tenantDb', () => ({
      getTenantDb: () => ({
        driver: { findFirst: mockDriverFindFirst },
        plan:   { findFirst: mockPlanFindFirst   },
      }),
    }))
    const mod = await import('@/app/api/tours/pdf/route')
    GET = mod.GET
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeAll(() => { vi.clearAllMocks() })

  it('returns 400 when driverId missing', async () => {
    const res = await GET(makeReq({ date: '2026-06-15' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when date missing', async () => {
    const res = await GET(makeReq({ driverId: 'd1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when date has invalid format', async () => {
    const res = await GET(makeReq({ driverId: 'd1', date: '15/06/2026' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/YYYY-MM-DD/i)
  })

  it('returns 404 when driver not found', async () => {
    vi.clearAllMocks()
    mockDriverFindFirst.mockResolvedValueOnce(null)
    mockPlanFindFirst.mockResolvedValueOnce(null)
    const res = await GET(makeReq({ driverId: 'ghost', date: '2026-06-15' }))
    expect(res.status).toBe(404)
  })

  it('returns PDF with correct headers when driver + plan found', async () => {
    vi.clearAllMocks()
    mockDriverFindFirst.mockResolvedValueOnce(DB_DRIVER)
    mockPlanFindFirst.mockResolvedValueOnce(DB_PLAN)
    mockCalcTour.mockReturnValueOnce(TOUR_RESULT)

    const res = await GET(makeReq({ driverId: 'd1', date: '2026-06-15' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('jean_dupont_2026-06-15.pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns PDF when plan is null (empty missions fallback)', async () => {
    vi.clearAllMocks()
    mockDriverFindFirst.mockResolvedValueOnce(DB_DRIVER)
    mockPlanFindFirst.mockResolvedValueOnce(null)
    mockCalcTour.mockReturnValueOnce({ steps: [], totalRoadDistKm: 0, totalDurationMin: 0 })

    const res = await GET(makeReq({ driverId: 'd1', date: '2026-06-15' }))
    expect(res.status).toBe(200)
  })

  it('calls calcTour with sorted missions and correct defaults', async () => {
    vi.clearAllMocks()
    const planWithTwoMissions = {
      missions:  [
        { id: 'm2', sequenceOrder: 2 },
        { id: 'm1', sequenceOrder: 1 },
      ],
      startTime: null,
      speedKmh:  null,
    }
    mockDriverFindFirst.mockResolvedValueOnce(DB_DRIVER)
    mockPlanFindFirst.mockResolvedValueOnce(planWithTwoMissions)
    mockCalcTour.mockReturnValueOnce(TOUR_RESULT)

    await GET(makeReq({ driverId: 'd1', date: '2026-06-15' }))

    expect(mockCalcTour).toHaveBeenCalledOnce()
    const [missions, , , startTime, speedKmh] = mockCalcTour.mock.calls[0]
    // should be sorted by sequenceOrder
    expect(missions[0].id).toBe('m1')
    expect(missions[1].id).toBe('m2')
    // defaults when null
    expect(startTime).toBe('07:00')
    expect(speedKmh).toBe(50)
  })

  it('returns 500 on DB error', async () => {
    vi.clearAllMocks()
    mockDriverFindFirst.mockRejectedValueOnce(new Error('DB timeout'))
    mockPlanFindFirst.mockRejectedValueOnce(new Error('DB timeout'))
    const res = await GET(makeReq({ driverId: 'd1', date: '2026-06-15' }))
    expect(res.status).toBe(500)
  })

  // Regression: found via manual QA — /api/tours/pdf 500'd on every single driver in
  // production (real root cause: dual React module instance between webpack-bundled route
  // handler and @react-pdf/renderer — see docs/deploiement.md §4). Fixed by moving rendering
  // into a dedicated worker process (src/workers/pdfWorker.ts) that Next's bundler never
  // touches — see generatePdfViaWorker in src/lib/queue/pdfQueue.ts. This test now covers the
  // route's other failure mode: the worker itself unreachable or timing out, which must 503
  // with a clear message rather than 500 with a swallowed error (the original bug here was a
  // bare catch block leaving zero trace in app.log).
  it('returns 503 and logs when the PDF worker is unreachable or times out', async () => {
    vi.clearAllMocks()
    mockDriverFindFirst.mockResolvedValueOnce(DB_DRIVER)
    mockPlanFindFirst.mockResolvedValueOnce(DB_PLAN)
    mockCalcTour.mockReturnValueOnce(TOUR_RESULT)
    mockGeneratePdfViaWorker.mockRejectedValueOnce(new Error('Job timed out'))

    const res = await GET(makeReq({ driverId: 'd1', date: '2026-06-15' }))

    expect(res.status).toBe(503)
    expect(mockLog.error).toHaveBeenCalled()
    const [, meta] = mockLog.error.mock.calls[0]
    expect(meta.err).toContain('Job timed out')
  })
})
