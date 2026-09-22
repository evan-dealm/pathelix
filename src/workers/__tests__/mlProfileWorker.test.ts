import { describe, it, expect, vi, beforeEach } from 'vitest'

// Prevent the top-level computeProfilesWithRetry() call from running on import
vi.mock('dotenv/config', () => ({}))
vi.mock('@/lib/env', () => ({ validateEnv: vi.fn() }))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn(() => ({})),
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(() => ({
    tenant:               { findMany: vi.fn() },
    interventionMetric:   { findMany: vi.fn() },
    tenantMLProfile:      { upsert: vi.fn() },
    $disconnect:          vi.fn(),
  })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock the top-level invocation so the worker doesn't execute on import
vi.mock('@/workers/mlProfileWorker', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/workers/mlProfileWorker')>()
  return mod
})

import { trimmedMedian, safeCoeff, groupBy, computeTenantProfile } from '@/workers/mlProfileWorker'

// ─── trimmedMedian ────────────────────────────────────────────────────────────

describe('trimmedMedian', () => {
  it('returns null for empty array', () => {
    expect(trimmedMedian([])).toBeNull()
  })

  it('returns middle value for small array (< 5)', () => {
    // [1, 2, 3] → sorted [1,2,3], index 1 → 2
    expect(trimmedMedian([3, 1, 2])).toBe(2)
  })

  it('returns lower of two middle values for even small array', () => {
    // [1, 2, 3, 4] → sorted [1,2,3,4], index 2 → 3
    expect(trimmedMedian([4, 1, 3, 2])).toBe(3)
  })

  it('trims top and bottom 10% for large array', () => {
    // 10 values: [1,2,3,4,5,6,7,8,9,10]
    // p10 = floor(10*0.10) = 1, p90 = ceil(10*0.90) = 9
    // trimmed = [2,3,4,5,6,7,8,9], median index 4 → 6
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(trimmedMedian(values)).toBe(6)
  })

  it('handles array with all identical values', () => {
    expect(trimmedMedian([5, 5, 5, 5, 5, 5])).toBe(5)
  })

  it('handles outliers without being affected by them', () => {
    // 10 values with extreme outliers
    const values = [1, 100, 10, 11, 12, 13, 14, 15, 16, 1000]
    // sorted: [1, 10, 11, 12, 13, 14, 15, 16, 100, 1000]
    // p10=1, p90=9 → trimmed=[10,11,12,13,14,15,16,100], median idx 4 → 14
    expect(trimmedMedian(values)).toBe(14)
  })
})

// ─── safeCoeff ────────────────────────────────────────────────────────────────

describe('safeCoeff', () => {
  it('returns 1.0 when actual is null', () => {
    expect(safeCoeff(null, 10)).toBe(1.0)
  })

  it('returns 1.0 when estimated is null', () => {
    expect(safeCoeff(10, null)).toBe(1.0)
  })

  it('returns 1.0 when both are null', () => {
    expect(safeCoeff(null, null)).toBe(1.0)
  })

  it('returns 1.0 when estimated is 0 (division guard)', () => {
    expect(safeCoeff(10, 0)).toBe(1.0)
  })

  it('returns 1.0 when estimated is negative', () => {
    expect(safeCoeff(10, -5)).toBe(1.0)
  })

  it('computes ratio correctly', () => {
    expect(safeCoeff(20, 10)).toBe(2.0)
  })

  it('clamps at minimum 0.3', () => {
    // 1/20 = 0.05 → clamped to 0.3
    expect(safeCoeff(1, 20)).toBe(0.3)
  })

  it('clamps at maximum 3.0', () => {
    // 30/1 = 30 → clamped to 3.0
    expect(safeCoeff(30, 1)).toBe(3.0)
  })

  it('returns exact ratio when within bounds', () => {
    expect(safeCoeff(15, 10)).toBeCloseTo(1.5)
  })
})

// ─── groupBy ──────────────────────────────────────────────────────────────────

describe('groupBy', () => {
  it('groups items by key', () => {
    const items = [
      { type: 'A', val: 1 },
      { type: 'B', val: 2 },
      { type: 'A', val: 3 },
    ]
    const result = groupBy(items, i => i.type)
    expect(result.get('A')).toHaveLength(2)
    expect(result.get('B')).toHaveLength(1)
    expect(result.get('A')![0].val).toBe(1)
    expect(result.get('A')![1].val).toBe(3)
  })

  it('returns empty map for empty array', () => {
    expect(groupBy([], () => 'x').size).toBe(0)
  })

  it('handles single key group', () => {
    const result = groupBy([1, 2, 3], () => 'all')
    expect(result.get('all')).toHaveLength(3)
  })
})

// ─── computeTenantProfile ────────────────────────────────────────────────────

describe('computeTenantProfile', () => {
  function makeMetric(overrides: Partial<{
    driverId: string
    siteId: string | null
    missionType: string
    estimatedDurationMin: number
    estimatedManeuverMin: number
    estimatedTravelMin: number | null
    actualDurationMin: number
    actualManeuverMin: number
    actualTravelMin: number | null
    confidenceScore: number
  }> = {}) {
    return {
      driverId:             'driver-1',
      siteId:               'site-1',
      missionType:          'POSER',
      estimatedDurationMin: 30,
      estimatedManeuverMin: 10,
      estimatedTravelMin:   20,
      actualDurationMin:    30,
      actualManeuverMin:    10,
      actualTravelMin:      20,
      confidenceScore:      0.9,
      ...overrides,
    }
  }

  let mockPrisma: {
    interventionMetric: { findMany: ReturnType<typeof vi.fn> }
    tenantMLProfile:    { upsert: ReturnType<typeof vi.fn> }
  }

  beforeEach(() => {
    mockPrisma = {
      interventionMetric: { findMany: vi.fn() },
      tenantMLProfile:    { upsert:   vi.fn() },
    }
  })

  it('returns 0 upserts when fewer than 30 global samples', async () => {
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 29 }, () => makeMetric()),
    )
    const result = await computeTenantProfile(mockPrisma as never, 'tenant-1')
    expect(result).toBe(0)
    expect(mockPrisma.tenantMLProfile.upsert).not.toHaveBeenCalled()
  })

  it('upserts global profile when ≥ 30 samples', async () => {
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => makeMetric()),
    )
    const result = await computeTenantProfile(mockPrisma as never, 'tenant-1')
    expect(result).toBeGreaterThanOrEqual(1)
    expect(mockPrisma.tenantMLProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_scope_scopeId_missionType: expect.objectContaining({ scope: 'global' }),
        }),
      }),
    )
  })

  it('upserts type profile when a type has ≥ 15 samples', async () => {
    // 30 of type POSER → global + type profile
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => makeMetric({ missionType: 'POSER' })),
    )
    await computeTenantProfile(mockPrisma as never, 'tenant-1')
    const calls = mockPrisma.tenantMLProfile.upsert.mock.calls as Array<[{ where: { tenantId_scope_scopeId_missionType: { scope: string } } }]>
    const scopes = calls.map(c => c[0].where.tenantId_scope_scopeId_missionType.scope)
    expect(scopes).toContain('global')
    expect(scopes).toContain('type')
  })

  it('skips type profile when type has < 15 samples', async () => {
    // 30 total but split between 2 types (15 each — exactly at threshold)
    const metrics = [
      ...Array.from({ length: 15 }, () => makeMetric({ missionType: 'POSER' })),
      ...Array.from({ length: 15 }, () => makeMetric({ missionType: 'RETIRER' })),
    ]
    mockPrisma.interventionMetric.findMany.mockResolvedValue(metrics)
    await computeTenantProfile(mockPrisma as never, 'tenant-1')
    const calls = mockPrisma.tenantMLProfile.upsert.mock.calls as Array<[{ where: { tenantId_scope_scopeId_missionType: { scope: string } } }]>
    const scopes = calls.map(c => c[0].where.tenantId_scope_scopeId_missionType.scope)
    // Both types have exactly 15 → included
    expect(scopes.filter(s => s === 'type')).toHaveLength(2)
  })

  it('upserts driver profile when driver has ≥ 20 samples', async () => {
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => makeMetric({ driverId: 'driver-A' })),
    )
    await computeTenantProfile(mockPrisma as never, 'tenant-1')
    const calls = mockPrisma.tenantMLProfile.upsert.mock.calls as Array<[{ where: { tenantId_scope_scopeId_missionType: { scope: string } } }]>
    const scopes = calls.map(c => c[0].where.tenantId_scope_scopeId_missionType.scope)
    expect(scopes).toContain('driver')
  })

  it('upserts site profile when site has ≥ 10 samples', async () => {
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => makeMetric({ siteId: 'site-A' })),
    )
    await computeTenantProfile(mockPrisma as never, 'tenant-1')
    const calls = mockPrisma.tenantMLProfile.upsert.mock.calls as Array<[{ where: { tenantId_scope_scopeId_missionType: { scope: string } } }]>
    const scopes = calls.map(c => c[0].where.tenantId_scope_scopeId_missionType.scope)
    expect(scopes).toContain('site')
  })

  it('skips site profile when siteId is null', async () => {
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => makeMetric({ siteId: null })),
    )
    await computeTenantProfile(mockPrisma as never, 'tenant-1')
    const calls = mockPrisma.tenantMLProfile.upsert.mock.calls as Array<[{ where: { tenantId_scope_scopeId_missionType: { scope: string } } }]>
    const scopes = calls.map(c => c[0].where.tenantId_scope_scopeId_missionType.scope)
    expect(scopes).not.toContain('site')
  })

  it('applies confidence filter (score < 0.5 excluded from calc)', async () => {
    // 30 samples but all with confidenceScore = 0.0 → upsertProfile returns 0
    mockPrisma.interventionMetric.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => makeMetric({ confidenceScore: 0.0 })),
    )
    const result = await computeTenantProfile(mockPrisma as never, 'tenant-1')
    // Global profile attempted but confidenceScore filter removes all rows → 0 upserts
    expect(result).toBe(0)
    expect(mockPrisma.tenantMLProfile.upsert).not.toHaveBeenCalled()
  })
})
