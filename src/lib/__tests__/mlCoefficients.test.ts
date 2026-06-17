import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mission } from '@/lib/types'

const mockFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  default: { tenantMLProfile: { findMany: mockFindMany } },
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/cache', () => ({
  TtlCache: vi.fn().mockImplementation(() => ({
    // Always miss cache so each test hits the DB mock directly
    getOrSet: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
    delete:   vi.fn(),
  })),
}))

import { applyMLCoefficients, getTravelCoeff, invalidateMLCache } from '../mlCoefficients'

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm-1', type: 'POSER', date: '2025-06-15',
    address: 'x', latitude: 45.9, longitude: 6.1,
    estimatedDurationMin: 30, maneuverTimeMin: 5,
    ...overrides,
  }
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'driver', scopeId: 'd-1', missionType: 'POSER',
    durationCoeff: 1.2, maneuverCoeff: 0.8, travelCoeff: 1.1,
    sampleCount: 10,
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('applyMLCoefficients', () => {
  it('returns missions unchanged when no profiles', async () => {
    mockFindMany.mockResolvedValueOnce([])
    const m = [mission()]
    expect(await applyMLCoefficients('t-1', m, 'd-1')).toEqual(m)
  })

  it('returns mission unchanged when sampleCount < 5', async () => {
    mockFindMany.mockResolvedValueOnce([profile({ sampleCount: 3, durationCoeff: 2.0 })])
    const m = mission({ estimatedDurationMin: 30 })
    const [result] = await applyMLCoefficients('t-1', [m], 'd-1')
    expect(result.estimatedDurationMin).toBe(30)
  })

  it('applies duration coefficient when deviation > 5%', async () => {
    mockFindMany.mockResolvedValueOnce([profile({ durationCoeff: 1.2, maneuverCoeff: 1.0 })])
    const [result] = await applyMLCoefficients('t-1', [mission({ estimatedDurationMin: 30 })], 'd-1')
    expect(result.estimatedDurationMin).toBe(Math.round(30 * 1.2))
  })

  it('applies maneuver coefficient when deviation > 5%', async () => {
    mockFindMany.mockResolvedValueOnce([profile({ durationCoeff: 1.0, maneuverCoeff: 0.8 })])
    const [result] = await applyMLCoefficients('t-1', [mission({ maneuverTimeMin: 10 })], 'd-1')
    expect(result.maneuverTimeMin).toBe(Math.round(10 * 0.8))
  })

  it('leaves mission unchanged when coefficients within 5% of 1.0', async () => {
    mockFindMany.mockResolvedValueOnce([profile({ durationCoeff: 1.03, maneuverCoeff: 0.97 })])
    const m = mission({ estimatedDurationMin: 30, maneuverTimeMin: 5 })
    const [result] = await applyMLCoefficients('t-1', [m], 'd-1')
    expect(result.estimatedDurationMin).toBe(30)
    expect(result.maneuverTimeMin).toBe(5)
  })

  it('falls back to global profile when no specific match', async () => {
    mockFindMany.mockResolvedValueOnce([
      { scope: 'global', scopeId: 'global', missionType: '_ALL_',
        durationCoeff: 1.15, maneuverCoeff: 1.0, travelCoeff: 1.0, sampleCount: 20 },
    ])
    const [result] = await applyMLCoefficients('t-1', [mission({ estimatedDurationMin: 20 })], 'other-driver')
    expect(result.estimatedDurationMin).toBe(Math.round(20 * 1.15))
  })

  it('uses site profile when driver profile absent', async () => {
    mockFindMany.mockResolvedValueOnce([
      profile({ scope: 'site', scopeId: 's-1', durationCoeff: 1.3, maneuverCoeff: 1.0, sampleCount: 8 }),
    ])
    const [result] = await applyMLCoefficients('t-1', [mission({ estimatedDurationMin: 20, siteId: 's-1' })], 'other')
    expect(result.estimatedDurationMin).toBe(Math.round(20 * 1.3))
  })

  it('uses driver-global profile over type-only profile', async () => {
    mockFindMany.mockResolvedValueOnce([
      profile({ scope: 'driver', scopeId: 'd-1', missionType: '_ALL_', durationCoeff: 1.25, maneuverCoeff: 1.0, sampleCount: 15 }),
      profile({ scope: 'type', scopeId: 'RETIRER', missionType: 'RETIRER', durationCoeff: 1.5, maneuverCoeff: 1.0, sampleCount: 10 }),
    ])
    // Mission type is RETIRER but driver has driverGlobal — driverGlobal wins
    const [result] = await applyMLCoefficients('t-1', [mission({ type: 'RETIRER', estimatedDurationMin: 20 })], 'd-1')
    expect(result.estimatedDurationMin).toBe(Math.round(20 * 1.25))
  })

  it('returns default coeff (no change) when no profile matches', async () => {
    mockFindMany.mockResolvedValueOnce([
      profile({ scope: 'driver', scopeId: 'd-99', missionType: 'RETIRER', sampleCount: 10 }),
    ])
    const m = mission({ estimatedDurationMin: 30 })
    // No matching driver/site/global profile → default {1.0, 1.0, 1.0} → no change
    const [result] = await applyMLCoefficients('t-1', [m], 'd-1')
    expect(result.estimatedDurationMin).toBe(30)
  })
})

describe('getTravelCoeff', () => {
  it('returns 1.0 when no profiles', async () => {
    mockFindMany.mockResolvedValueOnce([])
    expect(await getTravelCoeff('t-1')).toBe(1.0)
  })

  it('returns 1.0 when global profile has fewer than 5 samples', async () => {
    mockFindMany.mockResolvedValueOnce([
      { scope: 'global', scopeId: 'global', missionType: '_ALL_',
        durationCoeff: 1.0, maneuverCoeff: 1.0, travelCoeff: 1.6, sampleCount: 3 },
    ])
    expect(await getTravelCoeff('t-1')).toBe(1.0)
  })

  it('returns travelCoeff from global profile with sufficient samples', async () => {
    mockFindMany.mockResolvedValueOnce([
      { scope: 'global', scopeId: 'global', missionType: '_ALL_',
        durationCoeff: 1.0, maneuverCoeff: 1.0, travelCoeff: 1.45, sampleCount: 25 },
    ])
    expect(await getTravelCoeff('t-1')).toBe(1.45)
  })
})

describe('invalidateMLCache', () => {
  it('does not throw', () => {
    expect(() => invalidateMLCache('t-1')).not.toThrow()
  })
})
