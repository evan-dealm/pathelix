import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetRequestContext = vi.fn()
const mockFindMany = vi.fn()

vi.mock('@/lib/data/context', () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}))
vi.mock('@/lib/db', () => ({
  default: { interventionMetric: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/superadmin/ml-accuracy')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

const TENANT = 'tenant-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRequestContext.mockReturnValue({ tenantId: 'sa-tenant', role: 'superadmin' })
  mockFindMany.mockResolvedValue([])
})

describe('GET /api/superadmin/ml-accuracy — RBAC', () => {
  it('returns 403 for admin role', async () => {
    mockGetRequestContext.mockReturnValue({ tenantId: TENANT, role: 'admin' })
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher role', async () => {
    mockGetRequestContext.mockReturnValue({ tenantId: TENANT, role: 'dispatcher' })
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns 200 for superadmin', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
  })
})

describe('GET /api/superadmin/ml-accuracy — empty state', () => {
  it('returns zero stats when no metrics', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { global: { sampleCount: number; mape: number } }
    expect(body.global.sampleCount).toBe(0)
    expect(body.global.mape).toBe(0)
  })
})

describe('GET /api/superadmin/ml-accuracy — MAPE calculation', () => {
  it('computes correct MAPE for known values', async () => {
    // estimated=30, actual=36 → APE = 20%
    // estimated=20, actual=24 → APE = 20%
    // global MAPE = 20%
    mockFindMany.mockResolvedValue([
      { tenantId: TENANT, missionType: 'POSER', driverId: 'd1', siteId: 's1', estimatedDurationMin: 30, actualDurationMin: 36 },
      { tenantId: TENANT, missionType: 'POSER', driverId: 'd1', siteId: 's1', estimatedDurationMin: 20, actualDurationMin: 24 },
    ])
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { global: { mape: number; sampleCount: number } }
    expect(body.global.sampleCount).toBe(2)
    expect(body.global.mape).toBeCloseTo(20, 0)
  })

  it('computes negative medianError when estimates exceed actuals (over-estimation)', async () => {
    // estimated=60, actual=30 → error = -30 (over-estimated)
    mockFindMany.mockResolvedValue([
      { tenantId: TENANT, missionType: 'POSER', driverId: 'd1', siteId: null, estimatedDurationMin: 60, actualDurationMin: 30 },
      { tenantId: TENANT, missionType: 'POSER', driverId: 'd2', siteId: null, estimatedDurationMin: 60, actualDurationMin: 30 },
    ])
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { global: { medianErrorMin: number } }
    expect(body.global.medianErrorMin).toBe(-30)
  })

  it('computes positive medianError when actuals exceed estimates (under-estimation)', async () => {
    // estimated=30, actual=50 → error = +20
    mockFindMany.mockResolvedValue([
      { tenantId: TENANT, missionType: 'POSER', driverId: 'd1', siteId: null, estimatedDurationMin: 30, actualDurationMin: 50 },
    ])
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { global: { medianErrorMin: number } }
    expect(body.global.medianErrorMin).toBe(20)
  })
})

describe('GET /api/superadmin/ml-accuracy — grouping', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      { tenantId: TENANT, missionType: 'POSER',   driverId: 'd1', siteId: 's1', estimatedDurationMin: 30, actualDurationMin: 33 },
      { tenantId: TENANT, missionType: 'RETIRER',  driverId: 'd2', siteId: 's2', estimatedDurationMin: 30, actualDurationMin: 45 },
      { tenantId: TENANT, missionType: 'POSER',   driverId: 'd1', siteId: 's1', estimatedDurationMin: 30, actualDurationMin: 27 },
    ])
  })

  it('groups by missionType', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { byMissionType: Record<string, { sampleCount: number }> }
    expect(body.byMissionType['POSER'].sampleCount).toBe(2)
    expect(body.byMissionType['RETIRER'].sampleCount).toBe(1)
  })

  it('returns topDriversByError list', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { topDriversByError: Array<{ driverId: string }> }
    const driverIds = body.topDriversByError.map(d => d.driverId)
    expect(driverIds).toContain('d1')
  })

  it('returns topSitesByError list (skips null siteId)', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { topSitesByError: Array<{ siteId: string }> }
    expect(body.topSitesByError.length).toBeGreaterThan(0)
    expect(body.topSitesByError.some(s => s.siteId === null)).toBe(false)
  })
})

describe('GET /api/superadmin/ml-accuracy — tenantId filter', () => {
  it('passes tenantId to Prisma query', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    await GET(makeReq({ tenantId: TENANT }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
      }),
    )
  })

  it('uses no tenantId filter when param absent', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    await GET(makeReq())
    const callArg = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(callArg.where.tenantId).toBeUndefined()
  })

  it('exposes tenantFilter in response', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq({ tenantId: TENANT }))
    const body = await res.json() as { tenantFilter: string }
    expect(body.tenantFilter).toBe(TENANT)
  })
})

describe('GET /api/superadmin/ml-accuracy — interpretation guide', () => {
  it('includes interpretation field in response', async () => {
    const { GET } = await import('@/app/api/superadmin/ml-accuracy/route')
    const res = await GET(makeReq())
    const body = await res.json() as { interpretation: { mape: string } }
    expect(typeof body.interpretation.mape).toBe('string')
    expect(body.interpretation.mape).toContain('MAPE')
  })
})
