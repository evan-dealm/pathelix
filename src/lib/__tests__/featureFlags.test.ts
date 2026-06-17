import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  tenantSettings: { findUnique: vi.fn() },
  tenant:         { findUnique: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

import { getFeatureFlags, hasFeature, invalidateFlagsCache } from '@/lib/featureFlags'

beforeEach(() => {
  vi.clearAllMocks()
  invalidateFlagsCache('t-free')
  invalidateFlagsCache('t-pro')
  invalidateFlagsCache('t-ent')
  invalidateFlagsCache('t-over')
  invalidateFlagsCache('t-err')
  invalidateFlagsCache('t-null')
})

describe('getFeatureFlags', () => {
  it('returns FREE defaults for FREE plan', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'FREE' })

    const flags = await getFeatureFlags('t-free')
    expect(flags.gantt).toBe(false)
    expect(flags.tracking).toBe(true)
    expect(flags.pdf).toBe(false)
  })

  it('returns PRO defaults for PRO plan', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'PRO' })

    const flags = await getFeatureFlags('t-pro')
    expect(flags.gantt).toBe(true)
    expect(flags.pdf).toBe(true)
    expect(flags.delayScoring).toBe(false)
  })

  it('returns ENTERPRISE defaults for ENTERPRISE plan', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' })

    const flags = await getFeatureFlags('t-ent')
    expect(flags.delayScoring).toBe(true)
    expect(flags.anomalyDetect).toBe(true)
    expect(flags.benchmarking).toBe(true)
  })

  it('merges feature overrides from tenantSettings', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue({ features: { gantt: true, weather: true } })
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'FREE' })

    const flags = await getFeatureFlags('t-over')
    expect(flags.gantt).toBe(true)
    expect(flags.weather).toBe(true)
    expect(flags.pdf).toBe(false)
  })

  it('falls back to FREE on DB error', async () => {
    mockPrisma.tenantSettings.findUnique.mockRejectedValue(new Error('DB fail'))
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))

    const flags = await getFeatureFlags('t-err')
    expect(flags.gantt).toBe(false)
    expect(flags.tracking).toBe(true)
  })

  it('falls back to FREE when tenant not found', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue(null)

    const flags = await getFeatureFlags('t-null')
    expect(flags.gantt).toBe(false)
  })

  it('caches the result on second call', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'PRO' })

    await getFeatureFlags('t-pro')
    await getFeatureFlags('t-pro')

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('invalidateFlagsCache', () => {
  it('forces a fresh DB read after invalidation', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'PRO' })

    await getFeatureFlags('t-pro')
    invalidateFlagsCache('t-pro')
    await getFeatureFlags('t-pro')

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(2)
  })
})

describe('hasFeature', () => {
  it('returns true for enabled feature', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' })

    expect(await hasFeature('t-ent', 'anomalyDetect')).toBe(true)
  })

  it('returns false for disabled feature', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'FREE' })

    expect(await hasFeature('t-free', 'gantt')).toBe(false)
  })
})
