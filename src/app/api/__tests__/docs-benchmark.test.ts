import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
}))

const mockTenantFindMany  = vi.hoisted(() => vi.fn())
const mockMetricFindMany  = vi.hoisted(() => vi.fn())
const mockMissionFindMany = vi.hoisted(() => vi.fn())
const mockMissionCount    = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    tenant:              { findMany: mockTenantFindMany  },
    interventionMetric:  { findMany: mockMetricFindMany  },
    mission:             { findMany: mockMissionFindMany, count: mockMissionCount },
  },
}))

import { GET as docsGET }      from '@/app/api/docs/route'
import { GET as benchmarkGET } from '@/app/api/benchmark/route'
import { getRequestContext }   from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeReq(url = 'http://localhost/api/benchmark') {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
})

// ─── GET /api/docs ────────────────────────────────────────────────────────────

describe('GET /api/docs', () => {
  it('returns OpenAPI spec as JSON with CORS header', async () => {
    const res = await docsGET()
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await res.json()
    expect(body.openapi).toBe('3.1.0')
    expect(body.info.title).toBe('Pathélix API')
    expect(body.paths).toBeDefined()
  })
})

// ─── GET /api/benchmark ───────────────────────────────────────────────────────

describe('GET /api/benchmark', () => {
  it('returns 403 for driver role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'driver', requestId: 'req-123', trade: null })
    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher role', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'dispatcher', requestId: 'req-123', trade: null })
    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns empty benchmarks when no tenants have trade', async () => {
    mockTenantFindMany.mockResolvedValueOnce([])
    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.benchmarks).toEqual([])
    expect(body.currentTrade).toBeNull()
  })

  it('skips trade groups with fewer than 10 metrics', async () => {
    mockTenantFindMany.mockResolvedValueOnce([{ id: 't1', trade: 'BTP' }])
    mockMetricFindMany
      .mockResolvedValueOnce([  // group metrics — only 5, skipped
        { tenantId: 't1', estimatedDurationMin: 30, actualDurationMin: 35, distanceKm: 10 },
        { tenantId: 't1', estimatedDurationMin: 30, actualDurationMin: 35, distanceKm: 10 },
        { tenantId: 't1', estimatedDurationMin: 30, actualDurationMin: 35, distanceKm: 10 },
        { tenantId: 't1', estimatedDurationMin: 30, actualDurationMin: 35, distanceKm: 10 },
        { tenantId: 't1', estimatedDurationMin: 30, actualDurationMin: 35, distanceKm: 10 },
      ])
      .mockResolvedValueOnce([]) // currentStats — fewer than 5
    mockMissionCount.mockResolvedValue(0)

    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.benchmarks).toHaveLength(0) // skipped because < 10 metrics
    expect(body.currentTrade).toBe('BTP')
  })

  it('returns benchmark data when ≥10 metrics for a trade', async () => {
    const metrics12 = Array.from({ length: 12 }, (_, i) => ({
      tenantId: 't2',
      estimatedDurationMin: 30,
      actualDurationMin:    33,
      distanceKm:           15,
    }))
    mockTenantFindMany.mockResolvedValueOnce([
      { id: 't1', trade: 'TRANSPORT' },
      { id: 't2', trade: 'TRANSPORT' },
    ])
    mockMetricFindMany
      .mockResolvedValueOnce(metrics12)   // group metrics (12 → passes)
      .mockResolvedValueOnce([])           // currentStats (my tenant 't1', no metrics)
    mockMissionCount
      .mockResolvedValueOnce(2)           // group: total
      .mockResolvedValueOnce(1)           // group: done

    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.benchmarks).toHaveLength(1)
    expect(body.benchmarks[0].trade).toBe('TRANSPORT')
    expect(body.benchmarks[0].tenantCount).toBeGreaterThanOrEqual(1)
    expect(body.benchmarks[0].avgDurationRatio).toBeCloseTo(33 / 30, 1)
    expect(body.currentTrade).toBe('TRANSPORT')
  })

  it('includes currentStats when current tenant has ≥5 metrics', async () => {
    const metrics12 = Array.from({ length: 12 }, () => ({
      tenantId: 't1',
      estimatedDurationMin: 40,
      actualDurationMin:    44,
      distanceKm:           20,
    }))
    const myMetrics5 = Array.from({ length: 6 }, () => ({
      estimatedDurationMin: 40,
      actualDurationMin:    44,
      distanceKm:           20,
    }))

    mockTenantFindMany.mockResolvedValueOnce([{ id: 't1', trade: 'LOGISTIQUE' }])
    mockMetricFindMany
      .mockResolvedValueOnce(metrics12)  // group metrics
      .mockResolvedValueOnce(myMetrics5) // currentStats
    mockMissionCount
      .mockResolvedValueOnce(2)  // group: total
      .mockResolvedValueOnce(1)  // group: done
      .mockResolvedValueOnce(1)  // currentStats: total
      .mockResolvedValueOnce(1)  // currentStats: done

    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.currentStats).not.toBeNull()
    expect(body.currentStats.avgDurationRatio).toBeCloseTo(44 / 40, 1)
  })

  it('returns 500 on DB error', async () => {
    mockTenantFindMany.mockRejectedValueOnce(new Error('DB timeout'))
    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/erreur serveur/i)
  })

  it('cache-control header is set on success response', async () => {
    // Use a real tenant to reach the main response path (not the early-exit)
    mockTenantFindMany.mockResolvedValueOnce([{ id: 't1', trade: 'BTP' }])
    mockMetricFindMany.mockResolvedValue([]) // < 10 → skipped, but still reaches final return
    mockMissionCount.mockResolvedValue(0)
    const res = await benchmarkGET(makeReq())
    expect(res.status).toBe(200)
    const cc = res.headers.get('cache-control')
    expect(cc).not.toBeNull()
    expect(cc).toContain('max-age=300')
  })
})
