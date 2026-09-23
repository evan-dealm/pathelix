import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PdfJobData } from '@/lib/queue/pdfQueue'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
}))

const mockGeneratePdf = vi.hoisted(() => vi.fn(async (_job: PdfJobData) => Buffer.from('%PDF-1.4 fake-pdf-content')))
vi.mock('@/lib/queue/pdfQueue', () => ({
  generatePdfViaWorker: mockGeneratePdf,
}))

const mockTenantFindUnique    = vi.hoisted(() => vi.fn())
const mockMissionFindMany     = vi.hoisted(() => vi.fn())
const mockMetricFindMany      = vi.hoisted(() => vi.fn())
const mockDriverFindMany      = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { tenant: { findUnique: mockTenantFindUnique } },
  getTenantDb: () => ({
    mission:             { findMany:    mockMissionFindMany  },
    interventionMetric:  { findMany:    mockMetricFindMany   },
    driver:              { findMany:    mockDriverFindMany   },
  }),
}))

import { GET } from '@/app/api/reports/pdf/route'
import { getRequestContext } from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/reports/pdf')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

const EMPTY_MISSIONS = [] as const
const EMPTY_METRICS  = [] as const
const EMPTY_DRIVERS  = [] as const

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
  mockTenantFindUnique.mockResolvedValue({ name: 'Tenant ACME' })
  mockMissionFindMany.mockResolvedValue(EMPTY_MISSIONS)
  mockMetricFindMany.mockResolvedValue(EMPTY_METRICS)
  mockDriverFindMany.mockResolvedValue(EMPTY_DRIVERS)
})

describe('GET /api/reports/pdf', () => {
  it('returns 403 for driver role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'driver', requestId: 'req-123', trade: null })
    const res = await GET(makeReq({ month: '2026-06' }))
    expect(res.status).toBe(403)
  })

  it('allows dispatcher role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'dispatcher', requestId: 'req-123', trade: null })
    const res = await GET(makeReq({ month: '2026-06' }))
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid month format (no dash)', async () => {
    const res = await GET(makeReq({ month: '202606' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/month/i)
  })

  it('returns 400 for month=13', async () => {
    const res = await GET(makeReq({ month: '2026-13' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for month=0', async () => {
    const res = await GET(makeReq({ month: '2026-00' }))
    expect(res.status).toBe(400)
  })

  it('returns PDF buffer with correct headers for valid month', async () => {
    const res = await GET(makeReq({ month: '2026-06' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('rapport-2026-06.pdf')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('works without month param (defaults to current month)', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
  })

  it('allows admin role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await GET(makeReq({ month: '2026-06' }))
    expect(res.status).toBe(200)
  })

  it('allows superadmin role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'superadmin', requestId: 'req-123', trade: null })
    const res = await GET(makeReq({ month: '2026-06' }))
    expect(res.status).toBe(200)
  })

  it('calls generateMonthlyReportPdf with aggregated data', async () => {
    mockMissionFindMany.mockResolvedValueOnce([
      { id: 'm1', completedAt: new Date(), cancelledAt: null, type: 'POSER' },
      { id: 'm2', completedAt: null, cancelledAt: new Date(), type: 'RETIRER' },
      { id: 'm3', completedAt: null, cancelledAt: null, type: 'POSER' },
    ])
    mockMetricFindMany.mockResolvedValueOnce([
      { driverId: 'd1', actualDurationMin: 30, actualTravelMin: 20, distanceKm: 15, missionType: 'POSER' },
    ])
    mockDriverFindMany.mockResolvedValueOnce([
      { id: 'd1', firstName: 'Jean', lastName: 'Dupont' },
    ])

    await GET(makeReq({ month: '2026-06' }))

    expect(mockGeneratePdf).toHaveBeenCalledOnce()
    const data = (mockGeneratePdf.mock.calls[0][0] as { data: import('@/lib/pdfReport').MonthlyReportData }).data
    expect(data.tenantName).toBe('Tenant ACME')
    expect(data.totalMissions).toBe(3)
    expect(data.completedMissions).toBe(1)
    expect(data.cancelledMissions).toBe(1)
    expect(data.totalDistanceKm).toBe(15)
    expect(data.topDrivers).toHaveLength(1)
    expect(data.topDrivers[0].name).toBe('Jean Dupont')
    expect(data.missionsByType).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'POSER' })])
    )
  })

  it('uses tenantId as fallback when tenant not found', async () => {
    mockTenantFindUnique.mockResolvedValueOnce(null)
    await GET(makeReq({ month: '2026-06' }))
    const data = (mockGeneratePdf.mock.calls[0][0] as { data: import('@/lib/pdfReport').MonthlyReportData }).data
    expect(data.tenantName).toBe('t1')
  })

  it('returns 500 on DB error', async () => {
    mockMissionFindMany.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeReq({ month: '2026-06' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/génération PDF/i)
  })

  it('computes correct fuel estimate (distKm × 0.35 × 1.80)', async () => {
    mockMetricFindMany.mockResolvedValueOnce([
      { driverId: 'd1', actualDurationMin: 0, actualTravelMin: 0, distanceKm: 100, missionType: 'POSER' },
    ])
    await GET(makeReq({ month: '2026-06' }))
    const data = (mockGeneratePdf.mock.calls[0][0] as { data: import('@/lib/pdfReport').MonthlyReportData }).data
    expect(data.totalFuelEur).toBeCloseTo(100 * 0.35 * 1.80)
  })

  it('missionsByType pct sums to 100 for single type', async () => {
    mockMissionFindMany.mockResolvedValueOnce([
      { id: 'm1', completedAt: null, cancelledAt: null, type: 'POSER' },
      { id: 'm2', completedAt: null, cancelledAt: null, type: 'POSER' },
    ])
    await GET(makeReq({ month: '2026-06' }))
    const data = (mockGeneratePdf.mock.calls[0][0] as { data: import('@/lib/pdfReport').MonthlyReportData }).data
    expect(data.missionsByType[0].pct).toBe(100)
  })
})
