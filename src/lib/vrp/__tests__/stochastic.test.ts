import { describe, it, expect, vi } from 'vitest'

vi.mock('../routeCost', () => ({
  computeRouteCost: vi.fn((_route: unknown, _ctx: unknown, _drivers: unknown) => 100),
}))

import { generateScenarios, applyScenario, evaluateCVaR } from '../stochastic'
import type { VRPSolution, CostContext } from '../types'
import type { Driver, Mission } from '@/lib/types'

function makeMission(id: string, opts: Partial<Mission> = {}): Mission {
  return {
    id,
    type:                 'POSER',
    address:              'addr',
    latitude:             48.85,
    longitude:            2.35,
    estimatedDurationMin: 30,
    maneuverTimeMin:      5,
    ...opts,
  } as Mission
}

function makeCtx(overrides: Partial<CostContext> = {}): CostContext {
  return {
    startTimeMin: 480,
    speedKmh:     50,
    date:         '2026-05-16',
    exutoires:    [],
    ...overrides,
  } as CostContext
}

// ─── generateScenarios ────────────────────────────────────────────────────────

describe('generateScenarios', () => {
  it('returns 5 scenarios by default', () => {
    const scenarios = generateScenarios()
    expect(scenarios).toHaveLength(5)
  })

  it('returns exactly n scenarios', () => {
    expect(generateScenarios(3)).toHaveLength(3)
    expect(generateScenarios(8)).toHaveLength(8)
  })

  it('first scenario is Nominal (factor 1.0)', () => {
    const scenarios = generateScenarios(5, 42)
    expect(scenarios[0].durationFactor).toBe(1.0)
    expect(scenarios[0].travelFactor).toBe(1.0)
    expect(scenarios[0].label).toBe('Nominal')
  })

  it('second scenario is Optimiste (factors < 1)', () => {
    const scenarios = generateScenarios()
    expect(scenarios[1].durationFactor).toBeLessThan(1.0)
    expect(scenarios[1].travelFactor).toBeLessThan(1.0)
  })

  it('last preset scenario is Worst case (factors > 1)', () => {
    const scenarios = generateScenarios(5)
    expect(scenarios[4].durationFactor).toBeGreaterThan(1.0)
    expect(scenarios[4].label).toBe('Worst case')
  })

  it('generates deterministic extra scenarios for same seed', () => {
    const a = generateScenarios(7, 100)
    const b = generateScenarios(7, 100)
    expect(a[5].durationFactor).toBe(b[5].durationFactor)
    expect(a[6].travelFactor).toBe(b[6].travelFactor)
  })

  it('generates different extra scenarios for different seeds', () => {
    const a = generateScenarios(6, 1)
    const b = generateScenarios(6, 9999)
    expect(a[5].durationFactor).not.toBe(b[5].durationFactor)
  })
})

// ─── applyScenario ────────────────────────────────────────────────────────────

describe('applyScenario', () => {
  it('returns same array reference when durationFactor is 1.0', () => {
    const missions = [makeMission('m1')]
    const scenario = { durationFactor: 1.0, travelFactor: 1.0, label: 'Nominal' }
    const result = applyScenario(missions, scenario)
    expect(result).toBe(missions)
  })

  it('scales estimatedDurationMin by durationFactor', () => {
    const missions = [makeMission('m1', { estimatedDurationMin: 30 })]
    const scenario = { durationFactor: 1.5, travelFactor: 1.0, label: 'Test' }
    const result = applyScenario(missions, scenario)
    expect(result[0].estimatedDurationMin).toBe(45) // 30 * 1.5 = 45
  })

  it('scales maneuverTimeMin by durationFactor', () => {
    const missions = [makeMission('m1', { maneuverTimeMin: 10 })]
    const scenario = { durationFactor: 2.0, travelFactor: 1.0, label: 'Test' }
    const result = applyScenario(missions, scenario)
    expect(result[0].maneuverTimeMin).toBe(20)
  })

  it('handles null maneuverTimeMin as 0', () => {
    const missions = [makeMission('m1', { maneuverTimeMin: undefined })]
    const scenario = { durationFactor: 1.5, travelFactor: 1.0, label: 'Test' }
    const result = applyScenario(missions, scenario)
    // 0 * 1.5 = 0, round(0) = 0
    expect(result[0].maneuverTimeMin).toBe(0)
  })

  it('does not mutate original missions', () => {
    const original = makeMission('m1', { estimatedDurationMin: 30 })
    const missions = [original]
    const scenario = { durationFactor: 2.0, travelFactor: 1.0, label: 'Test' }
    applyScenario(missions, scenario)
    expect(original.estimatedDurationMin).toBe(30)
  })
})

// ─── evaluateCVaR ─────────────────────────────────────────────────────────────

describe('evaluateCVaR', () => {
  const mockDrivers: Driver[] = []

  function makeSolution(nRoutes = 1): VRPSolution {
    return {
      routes: Array.from({ length: nRoutes }, (_, i) => ({
        driverId: `d${i}`,
        missions: [makeMission(`m${i}`) as never],
      })),
      cost: 0,
    }
  }

  it('returns meanCost and cvarCost for default scenarios', () => {
    const solution = makeSolution(1)
    const scenarios = generateScenarios(5)
    const result = evaluateCVaR(solution, makeCtx(), mockDrivers, scenarios)
    expect(result.meanCost).toBeGreaterThanOrEqual(0)
    expect(result.cvarCost).toBeGreaterThanOrEqual(result.meanCost)
  })

  it('cvarCost >= meanCost (CVaR is worst-tail average)', () => {
    const solution = makeSolution(2)
    const scenarios = generateScenarios(5)
    const result = evaluateCVaR(solution, makeCtx(), mockDrivers, scenarios)
    expect(result.cvarCost).toBeGreaterThanOrEqual(result.meanCost)
  })

  it('returns scenarioCosts for each scenario', () => {
    const solution = makeSolution(1)
    const scenarios = generateScenarios(5)
    const result = evaluateCVaR(solution, makeCtx(), mockDrivers, scenarios)
    expect(result.scenarioCosts).toHaveLength(5)
    for (const sc of result.scenarioCosts) {
      expect(sc.label).toBeTruthy()
      expect(typeof sc.cost).toBe('number')
    }
  })

  it('scenarioCosts are sorted descending by cost', () => {
    const solution = makeSolution(1)
    const scenarios = generateScenarios(5)
    const result = evaluateCVaR(solution, makeCtx(), mockDrivers, scenarios)
    for (let i = 1; i < result.scenarioCosts.length; i++) {
      expect(result.scenarioCosts[i - 1].cost).toBeGreaterThanOrEqual(result.scenarioCosts[i].cost)
    }
  })

  it('returns 0 cost for empty solution', () => {
    const solution: VRPSolution = { routes: [], cost: 0 }
    const scenarios = generateScenarios(3)
    const result = evaluateCVaR(solution, makeCtx(), mockDrivers, scenarios)
    expect(result.meanCost).toBe(0)
    expect(result.cvarCost).toBe(0)
  })

  it('adjusts speed for travel scenario', async () => {
    // computeRouteCost receives perturbed ctx with different speedKmh
    const { computeRouteCost } = vi.mocked(await import('../routeCost'))
    const solution = makeSolution(1)
    const scenarios = [{ durationFactor: 1.0, travelFactor: 2.0, label: 'High travel' }]
    evaluateCVaR(solution, makeCtx({ speedKmh: 50 }), mockDrivers, scenarios)
    // The perturbed ctx should have speedKmh = 50 / 2.0 = 25
    expect(computeRouteCost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ speedKmh: 25 }),
      mockDrivers,
    )
  })
})
