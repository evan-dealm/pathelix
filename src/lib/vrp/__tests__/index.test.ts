import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mission, Driver, Exutoire } from '@/lib/types'

vi.mock('@/lib/mlCoefficients', () => ({
  applyMLCoefficients: vi.fn(async (_t: string, missions: unknown[]) => missions),
  getTravelCoeff:      vi.fn(async () => 1.0),
}))
vi.mock('@/lib/familiarityLoader', () => ({
  loadFamiliarity:    vi.fn(async () => new Map()),
  getFamiliarityBonus: vi.fn(() => 0),
}))
vi.mock('../valhallaMatrix', () => ({
  buildValhallaMatrix: vi.fn(async () => ({ source: 'haversine', size: 0 })),
}))
vi.mock('../externalRoutingApi', () => ({
  buildExternalRoutingMatrix: vi.fn(async () => null),
}))

const { mockRunSectorsInParallel } = vi.hoisted(() => ({
  mockRunSectorsInParallel: vi.fn(),
}))
vi.mock('../threadPool', () => ({
  runSectorsInParallel: mockRunSectorsInParallel,
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { runVRP } from '../index'
import { applyMLCoefficients, getTravelCoeff } from '@/lib/mlCoefficients'
import { loadFamiliarity } from '@/lib/familiarityLoader'

// ─── helpers ──────────────────────────────────────────────────────────────────

function driver(id = 'd-1', overrides: Partial<Driver> = {}): Driver {
  return {
    id, firstName: 'A', lastName: 'B',
    depotLat: 45.9, depotLng: 6.1,
    sector: 'N', depotName: 'D', archived: false,
    vehicleCapacity: 4,
    ...overrides,
  }
}

function mission(id: string, overrides: Partial<Mission> = {}): Mission {
  return {
    id, type: 'POSER', date: '2025-06-15',
    address: 'Addr', latitude: 45.9, longitude: 6.1,
    estimatedDurationMin: 20, maneuverTimeMin: 5,
    ...overrides,
  }
}

const DATE = '2025-06-15'
const FAST = { timeBudgetMs: 100 }

beforeEach(() => {
  vi.clearAllMocks()
  mockRunSectorsInParallel.mockResolvedValue([])
})

// ─── no drivers ───────────────────────────────────────────────────────────────

describe('runVRP — no drivers', () => {
  it('returns empty assignments', async () => {
    const result = await runVRP([mission('m-1')], [], [], DATE, FAST)
    expect(result.assignments).toEqual({})
  })

  it('returns all missions as unassigned', async () => {
    const result = await runVRP([mission('m-1'), mission('m-2')], [], [], DATE, FAST)
    expect(result.unassignedMissions).toHaveLength(2)
  })

  it('emits "Aucun chauffeur" error warning', async () => {
    const result = await runVRP([mission('m-1')], [], [], DATE, FAST)
    const w = result.warnings.find(w => w.message.includes('Aucun chauffeur'))
    expect(w).toBeDefined()
    expect(w!.severity).toBe('error')
  })
})

// ─── no missions ──────────────────────────────────────────────────────────────

describe('runVRP — no missions', () => {
  it('returns assignedMissions=0', async () => {
    const result = await runVRP([], [driver()], [], DATE, FAST)
    expect(result.stats.assignedMissions).toBe(0)
    expect(result.stats.totalMissions).toBe(0)
  })

  it('returns no warnings', async () => {
    const result = await runVRP([], [driver()], [], DATE, FAST)
    expect(result.warnings).toHaveLength(0)
  })
})

// ─── basic assignment ─────────────────────────────────────────────────────────

describe('runVRP — basic', () => {
  it('includes timeTakenMs in stats', async () => {
    const result = await runVRP([mission('m-1')], [driver()], [], DATE, FAST)
    expect(result.stats.timeTakenMs).toBeGreaterThanOrEqual(0)
  })

  it('routingSource defaults to haversine when no matrix set', async () => {
    const result = await runVRP([mission('m-1')], [driver()], [], DATE, FAST)
    expect(result.stats.routingSource).toBe('haversine')
  })

  it('includes cvarScore in stats', async () => {
    const result = await runVRP([mission('m-1')], [driver()], [], DATE, FAST)
    expect(typeof result.stats.cvarScore).toBe('number')
  })

  it('totalMissions equals input length', async () => {
    const result = await runVRP([mission('m-1'), mission('m-2')], [driver()], [], DATE, FAST)
    expect(result.stats.totalMissions).toBe(2)
  })
})

// ─── startingExutoireId ───────────────────────────────────────────────────────

describe('runVRP — startingExutoireId', () => {
  it('uses exutoire coords as driver depot without throwing', async () => {
    const ex: Exutoire = {
      id: 'ex-1', name: 'Centre', address: 'Addr',
      lat: 46.0, lng: 6.5,
      openingHoursOpen: 360, openingHoursClose: 1200,
      closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15,
    }
    const d = driver('d-1', { startingExutoireId: 'ex-1' })
    const result = await runVRP([mission('m-1')], [d], [ex], DATE, FAST)
    expect(result.stats.totalMissions).toBe(1)
  })
})

// ─── tenantId / ML calibration ────────────────────────────────────────────────

describe('runVRP — tenantId ML calibration', () => {
  it('calls applyMLCoefficients', async () => {
    await runVRP([mission('m-1')], [driver()], [], DATE, { ...FAST, tenantId: 't-1' })
    expect(applyMLCoefficients).toHaveBeenCalledWith('t-1', expect.any(Array))
  })

  it('calls getTravelCoeff', async () => {
    await runVRP([mission('m-1')], [driver()], [], DATE, { ...FAST, tenantId: 't-1' })
    expect(getTravelCoeff).toHaveBeenCalledWith('t-1')
  })

  it('does not call applyMLCoefficients when tenantId absent', async () => {
    await runVRP([mission('m-1')], [driver()], [], DATE, FAST)
    expect(applyMLCoefficients).not.toHaveBeenCalled()
  })
})

// ─── stability weight / familiarity ──────────────────────────────────────────

describe('runVRP — stability weight', () => {
  it('calls loadFamiliarity when tenantId + stability>0', async () => {
    await runVRP([mission('m-1')], [driver()], [], DATE, {
      ...FAST,
      tenantId: 't-1',
      weights: { distance: 1, punctuality: 1, balance: 1, stability: 1 },
    })
    expect(loadFamiliarity).toHaveBeenCalledWith('t-1')
  })

  it('does not call loadFamiliarity when stability is 0', async () => {
    await runVRP([mission('m-1')], [driver()], [], DATE, {
      ...FAST,
      tenantId: 't-1',
      weights: { distance: 1, punctuality: 1, balance: 1, stability: 0 },
    })
    expect(loadFamiliarity).not.toHaveBeenCalled()
  })
})

// ─── usePareto ────────────────────────────────────────────────────────────────

describe('runVRP — usePareto', () => {
  it('includes paretoFront array in stats when usePareto:true', async () => {
    const result = await runVRP([mission('m-1')], [driver()], [], DATE, {
      ...FAST,
      usePareto: true,
    })
    expect(Array.isArray(result.stats.paretoFront)).toBe(true)
  })

  it('omits paretoFront when usePareto not set', async () => {
    const result = await runVRP([mission('m-1')], [driver()], [], DATE, FAST)
    expect(result.stats.paretoFront).toBeUndefined()
  })
})

// ─── HFVRP incompatibility ───────────────────────────────────────────────────

describe('runVRP — HFVRP incompatibility', () => {
  it('puts oversized mission in unassigned', async () => {
    const m = mission('m-big', { binSizeM3: 100 })
    const d = driver('d-1', { maxBinSizeM3: 4 })
    const result = await runVRP([m], [d], [], DATE, FAST)
    expect(result.unassignedMissions.some(u => u.id === 'm-big')).toBe(true)
  })

  it('emits error warning for incompatible mission', async () => {
    const m = mission('m-big', { binSizeM3: 100 })
    const d = driver('d-1', { maxBinSizeM3: 4 })
    const result = await runVRP([m], [d], [], DATE, FAST)
    expect(result.warnings.some(w => w.message.includes('m-big') && w.severity === 'error')).toBe(true)
  })
})

// ─── sector decomposition (>20 drivers) ──────────────────────────────────────

describe('runVRP — sector decomposition', () => {
  it('calls runSectorsInParallel when drivers > 20', async () => {
    const drivers = Array.from({ length: 21 }, (_, i) => driver(`d-${i}`))
    await runVRP([mission('m-1')], drivers, [], DATE, FAST)
    expect(mockRunSectorsInParallel).toHaveBeenCalled()
  })

  it('does not call runSectorsInParallel for ≤20 drivers', async () => {
    await runVRP([mission('m-1')], [driver()], [], DATE, FAST)
    expect(mockRunSectorsInParallel).not.toHaveBeenCalled()
  })
})

// ─── existingPlans ────────────────────────────────────────────────────────────

describe('runVRP — existingPlans', () => {
  it('accepts existingPlans without throwing', async () => {
    const result = await runVRP(
      [mission('m-1'), mission('m-2')],
      [driver()],
      [],
      DATE,
      { ...FAST, existingPlans: { 'd-1': ['m-1'] } },
    )
    expect(result.stats.totalMissions).toBe(2)
  })
})
