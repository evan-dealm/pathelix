import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'sa1', role: 'superadmin' })),
}))

const mockTenantCount      = vi.hoisted(() => vi.fn())
const mockTenantGroupBy    = vi.hoisted(() => vi.fn())
const mockTenantFindMany   = vi.hoisted(() => vi.fn())
const mockUserCount        = vi.hoisted(() => vi.fn())
const mockDriverCount      = vi.hoisted(() => vi.fn())
const mockVehicleCount     = vi.hoisted(() => vi.fn())
const mockMissionCount     = vi.hoisted(() => vi.fn())
const mockMissionGroupBy   = vi.hoisted(() => vi.fn())
const mockPlanCount        = vi.hoisted(() => vi.fn())
const mockPlanGroupBy      = vi.hoisted(() => vi.fn())
const mockExutoireCount    = vi.hoisted(() => vi.fn())
const mockClientCount      = vi.hoisted(() => vi.fn())
const mockSiteCount        = vi.hoisted(() => vi.fn())
const mockAuditFindMany    = vi.hoisted(() => vi.fn())
const mockMetricGroupBy    = vi.hoisted(() => vi.fn())
const mockMLProfileGroupBy = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    tenant:              { count: mockTenantCount,   groupBy: mockTenantGroupBy,  findMany: mockTenantFindMany },
    user:                { count: mockUserCount   },
    driver:              { count: mockDriverCount  },
    vehicle:             { count: mockVehicleCount },
    mission:             { count: mockMissionCount,  groupBy: mockMissionGroupBy  },
    plan:                { count: mockPlanCount,     groupBy: mockPlanGroupBy     },
    exutoire:            { count: mockExutoireCount  },
    client:              { count: mockClientCount    },
    site:                { count: mockSiteCount      },
    auditLog:            { findMany: mockAuditFindMany },
    interventionMetric:  { groupBy: mockMetricGroupBy    },
    tenantMLProfile:     { groupBy: mockMLProfileGroupBy },
  },
}))

import { GET as statsGET }    from '@/app/api/superadmin/stats/route'
import { GET as mlStatusGET } from '@/app/api/superadmin/ml-status/route'
import { getRequestContext }  from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

const TENANT_ROW = { id: 't2', name: 'ACME', slug: 'acme', plan: 'PRO' }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'sa1', role: 'superadmin', requestId: 'req-123', trade: null })
  // stats defaults
  mockTenantCount.mockResolvedValue(5)          // called twice: totalTenants + suspendedTenants
  mockUserCount.mockResolvedValue(20)            // called twice: total + recent
  mockDriverCount.mockResolvedValue(10)
  mockVehicleCount.mockResolvedValue(8)
  mockMissionCount.mockResolvedValue(100)        // called twice: total + recent
  mockPlanCount.mockResolvedValue(15)            // called twice: total + recent
  mockTenantGroupBy.mockResolvedValue([{ plan: 'PRO', _count: 5 }])  // tenantsByPlan
  // mission.groupBy called twice: topTenants (uses tenantId) then dailyMissions (uses createdAt)
  mockMissionGroupBy
    .mockResolvedValueOnce([{ tenantId: 't2', _count: 30 }])
    .mockResolvedValueOnce([{ createdAt: new Date(), _count: 5 }])
  mockPlanGroupBy.mockResolvedValue([{ createdAt: new Date(), _count: 2 }])
  mockTenantFindMany.mockResolvedValue([TENANT_ROW])
  mockExutoireCount.mockResolvedValue(7)
  mockClientCount.mockResolvedValue(12)
  mockSiteCount.mockResolvedValue(3)
  mockAuditFindMany.mockResolvedValue([])
  // ml-status defaults
  mockMetricGroupBy.mockResolvedValue([])
  mockMLProfileGroupBy.mockResolvedValue([])
})

// ─── GET /api/superadmin/stats ────────────────────────────────────────────────

describe('GET /api/superadmin/stats', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValueOnce({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await statsGET(new NextRequest('http://localhost/api/superadmin/stats'))
    expect(res.status).toBe(403)
  })

  it('returns 200 with global stats structure', async () => {
    const res = await statsGET(new NextRequest('http://localhost/api/superadmin/stats'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.global.totalTenants).toBe(5)
    expect(body.global.totalUsers).toBe(20)
    expect(body.global.totalDrivers).toBe(10)
    expect(body.global.totalVehicles).toBe(8)
    expect(body).toHaveProperty('recent')
    expect(body).toHaveProperty('tenantsByPlan')
    expect(body).toHaveProperty('topTenants')
    expect(body).toHaveProperty('dailyActivity')
    expect(body.dailyActivity).toHaveLength(14)
    expect(body.suspendedTenants).toBe(5) // mocked third call to count()
    expect(body.totalExutoires).toBe(7)
    expect(body.totalClients).toBe(12)
    expect(body.totalSites).toBe(3)
  })

  it('returns 500 on DB error', async () => {
    mockTenantCount.mockRejectedValueOnce(new Error('DB crash'))
    const res = await statsGET(new NextRequest('http://localhost/api/superadmin/stats'))
    expect(res.status).toBe(500)
  })
})

// ─── GET /api/superadmin/ml-status ───────────────────────────────────────────

describe('GET /api/superadmin/ml-status', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValueOnce({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await mlStatusGET(new NextRequest('http://localhost/api/superadmin/ml-status'))
    expect(res.status).toBe(403)
  })

  it('returns 200 with empty list when no tenants', async () => {
    mockTenantFindMany.mockResolvedValueOnce([])
    const res = await mlStatusGET(new NextRequest('http://localhost/api/superadmin/ml-status'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('returns 200 with maturity labels', async () => {
    mockTenantFindMany.mockResolvedValueOnce([TENANT_ROW])
    mockMetricGroupBy.mockResolvedValueOnce([
      { tenantId: 't2', isReliable: true,  _count: 400 },
      { tenantId: 't2', isReliable: false, _count: 50  },
    ])
    mockMLProfileGroupBy.mockResolvedValueOnce([
      { tenantId: 't2', _count: 5, _max: { lastComputedAt: new Date('2026-06-01') } },
    ])
    const res = await mlStatusGET(new NextRequest('http://localhost/api/superadmin/ml-status'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    const entry = body[0]
    expect(entry.tenantId).toBe('t2')
    expect(entry.metrics.reliable).toBe(400)
    expect(entry.metrics.rejected).toBe(50)
    expect(entry.metrics.rejectionRate).toBe(11) // 50/450*100
    expect(entry.maturity.pct).toBe(80)          // 400/500*100
    expect(entry.maturity.label).toBe('Calibration avancée')
    expect(entry.profile.coefficientCount).toBe(5)
  })

  it('assigns correct maturity labels at boundaries', async () => {
    mockTenantFindMany.mockResolvedValueOnce([
      { id: 'a', name: 'A', slug: 'a', plan: 'FREE' },
      { id: 'b', name: 'B', slug: 'b', plan: 'FREE' },
      { id: 'c', name: 'C', slug: 'c', plan: 'FREE' },
      { id: 'd', name: 'D', slug: 'd', plan: 'FREE' },
    ])
    mockMetricGroupBy.mockResolvedValueOnce([
      { tenantId: 'b', isReliable: true, _count: 100 },  // 20% → Apprentissage
      { tenantId: 'c', isReliable: true, _count: 300 },  // 60% → Coefficients partiels
      { tenantId: 'd', isReliable: true, _count: 600 },  // 100% → Calibration complète
    ])
    mockMLProfileGroupBy.mockResolvedValueOnce([])
    const res = await mlStatusGET(new NextRequest('http://localhost/api/superadmin/ml-status'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.find((e: { tenantId: string }) => e.tenantId === 'a').maturity.label).toBe('Aucune donnée')
    expect(body.find((e: { tenantId: string }) => e.tenantId === 'b').maturity.label).toBe('Apprentissage')
    expect(body.find((e: { tenantId: string }) => e.tenantId === 'c').maturity.label).toBe('Coefficients partiels')
    expect(body.find((e: { tenantId: string }) => e.tenantId === 'd').maturity.label).toBe('Calibration complète')
  })
})
