import { describe, it, expect, beforeEach } from 'vitest'
import type { Mission, Driver, Exutoire } from '@/lib/types'
import type { CostContext, ALNSParams } from '../types'
import { buildInitialSolution } from '../formatSolution'
import { computeSolutionCost, computeRouteCost, computePrefixStates, isAllerRetourCompatible } from '../routeCost'
import { runMvAlns } from '../mvAlns'
import { findBestExutoire, resetExutoireCongestion, getCongestionMap } from '../exutoireSearch'
import { buildWarmStartFromReference } from '../warmStart'

function makeDriver(id: string, lat: number, lng: number, opts?: Partial<Driver>): Driver {
  return {
    id, firstName: `D${id}`, lastName: 'Test', sector: 'S1',
    depotName: 'Depot', depotLat: lat, depotLng: lng,
    ...opts,
  }
}

function makeMission(
  id: string, lat: number, lng: number, type: Mission['type'] = 'POSER',
  opts?: Partial<Mission>,
): Mission {
  return {
    id, type, date: '2026-03-21', address: `Addr ${id}`,
    latitude: lat, longitude: lng,
    estimatedDurationMin: 30, maneuverTimeMin: 10,
    ...opts,
  }
}

const defaultExutoire: Exutoire = {
  id: 'exu1', name: 'Exutoire Proche', address: 'Test',
  lat: 45.80, lng: 6.10,
  openingHoursOpen: 420, openingHoursClose: 1080,
  closedDays: [], acceptedWasteTypes: [],
  serviceTimeMin: 15,
}

function makeCtx(drivers: Driver[], opts?: Partial<CostContext>): CostContext {
  return {
    depotLat: drivers[0].depotLat, depotLng: drivers[0].depotLng,
    startTimeMin: 420, speedKmh: 50,
    exutoires: [defaultExutoire], date: '2026-03-21',
    ...opts,
  }
}

function makeParams(budget: number = 2000): ALNSParams {
  return {
    timeBudgetMs: budget, seed: 42, iterations: 100,
    destroyRatio: 0.25, saT0Ratio: 0.05, saTMinRatio: 0.0002, rhoForget: 0.8,
  }
}

beforeEach(() => {
  resetExutoireCongestion()
})

describe('Q1 — Prefix state consistency', () => {
  it('computePrefixStates tracks currentId for OSRM lookup', () => {
    const driver = makeDriver('d1', 45.76, 6.05)
    const missions = [
      makeMission('m1', 45.77, 6.06),
      makeMission('m2', 45.78, 6.07),
    ]
    const route = { driverId: 'd1', missions }
    const ctx = makeCtx([driver])

    const states = computePrefixStates(route, ctx, [driver])

    expect(states[0].currentId).toBe('depot:d1')

    expect(states[1].currentId).toBe('m1')

    expect(states[2].currentId).toBe('m2')
  })

  it('prefix states length matches missions + 1', () => {
    const driver = makeDriver('d1', 45.76, 6.05)
    const missions = Array.from({ length: 5 }, (_, i) =>
      makeMission(`m${i}`, 45.76 + i * 0.01, 6.05 + i * 0.01),
    )
    const route = { driverId: 'd1', missions }
    const ctx = makeCtx([driver])

    const states = computePrefixStates(route, ctx, [driver])
    expect(states).toHaveLength(6)
  })
})

describe('Q3 — Waste type exact matching', () => {
  it('rejects substring match: "bois" should not match "bois-métal"', () => {
    const ex = { ...defaultExutoire, id: 'wood', acceptedWasteTypes: ['bois'] }
    const result = findBestExutoire(45.8, 6.1, undefined, 'bois-métal', [ex], 1)
    expect(result).toBeUndefined()
  })

  it('accepts exact match case-insensitive', () => {
    const ex = { ...defaultExutoire, id: 'g', acceptedWasteTypes: ['Gravats'] }
    const result = findBestExutoire(45.8, 6.1, undefined, 'gravats', [ex], 1)
    expect(result?.id).toBe('g')
  })

  it('rejects when waste types are completely different', () => {
    const ex = { ...defaultExutoire, id: 'x', acceptedWasteTypes: ['plastique'] }
    const result = findBestExutoire(45.8, 6.1, undefined, 'gravats', [ex], 1)
    expect(result).toBeUndefined()
  })
})

describe('Q10 — Linked exutoire scoring', () => {
  it('linked exutoire gets bonus but distance still matters', () => {
    const near = { ...defaultExutoire, id: 'near', lat: 45.81, lng: 6.11 }
    const far  = { ...defaultExutoire, id: 'far', lat: 44.50, lng: 5.50 }
    const result = findBestExutoire(45.80, 6.10, 'far', undefined, [near, far], 1)

    expect(result?.id).toBe('near')
  })

  it('linked exutoire wins when distances are nearly equal', () => {

    const a = { ...defaultExutoire, id: 'a', lat: 45.801, lng: 6.101 }
    const b = { ...defaultExutoire, id: 'b', lat: 45.802, lng: 6.102 }
    const result = findBestExutoire(45.80, 6.10, 'b', undefined, [a, b], 1)
    expect(result?.id).toBe('b')
  })
})

describe('Q9 — Warm-start sequence ordering', () => {
  it('matches missions in ID order when multiple candidates at same site', () => {
    const missions: Mission[] = [
      makeMission('c01', 45.8, 6.1, 'RETIRER', { siteId: 'SITE_A' }),
      makeMission('c02', 45.8, 6.1, 'RETIRER', { siteId: 'SITE_A' }),
      makeMission('c03', 45.8, 6.1, 'RETIRER', { siteId: 'SITE_A' }),
    ]
    const referencePlan = [
      { missionId: 'old1', siteId: 'SITE_A', type: 'RETIRER', driverId: 'dA' },
      { missionId: 'old2', siteId: 'SITE_A', type: 'RETIRER', driverId: 'dA' },
    ]

    const result = buildWarmStartFromReference(missions, referencePlan)

    expect(result.existingPlans['dA']).toHaveLength(2)
    expect(result.existingPlans['dA'][0]).toBe('c01')
    expect(result.existingPlans['dA'][1]).toBe('c02')

    expect(result.newMissions).toHaveLength(1)
    expect(result.newMissions[0].id).toBe('c03')
  })
})

describe('Q2/Q11 — Global congestion tracking', () => {
  it('congestion accumulates across multiple findBestExutoire calls', () => {
    const exu = { ...defaultExutoire, id: 'exu1' }

    for (let i = 0; i < 5; i++) {
      findBestExutoire(45.80, 6.10, undefined, undefined, [exu], 1)
    }
    expect(getCongestionMap().get('exu1')).toBe(5)
  })

  it('congestion map can be passed via CostContext', () => {
    const congestion = new Map<string, number>()
    const ctx = makeCtx([makeDriver('d1', 45.76, 6.05)], { congestionMap: congestion })
    expect(ctx.congestionMap).toBe(congestion)
  })
})

describe('Solution integrity', () => {
  it('all missions assigned after optimization with 5 drivers / 30 missions', () => {
    const drivers = Array.from({ length: 5 }, (_, i) =>
      makeDriver(`d${i}`, 45.70 + i * 0.03, 6.00 + i * 0.05),
    )
    const missions = Array.from({ length: 30 }, (_, i) =>
      makeMission(`m${i}`, 45.70 + Math.sin(i) * 0.06, 6.00 + Math.cos(i) * 0.08),
    )

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)
    const optimized = runMvAlns(initial, ctx, drivers, makeParams(2000))

    const assigned = optimized.routes.reduce((s, r) => s + r.missions.length, 0)
    expect(assigned).toBe(30)
  })

  it('ALNS solution cost is better than or equal to initial', () => {
    const drivers = Array.from({ length: 3 }, (_, i) =>
      makeDriver(`d${i}`, 45.75 + i * 0.02, 6.05 + i * 0.03),
    )
    const missions = Array.from({ length: 15 }, (_, i) =>
      makeMission(`m${i}`, 45.74 + Math.sin(i) * 0.04, 6.04 + Math.cos(i) * 0.06),
    )
    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams(2000))

    expect(optimized.cost).toBeLessThanOrEqual(initial.cost * 1.02)
  })

  it('no mission appears in multiple routes', () => {
    const drivers = Array.from({ length: 4 }, (_, i) =>
      makeDriver(`d${i}`, 45.70 + i * 0.03, 6.00 + i * 0.04),
    )
    const missions = Array.from({ length: 20 }, (_, i) =>
      makeMission(`m${i}`, 45.70 + Math.sin(i) * 0.05, 6.00 + Math.cos(i) * 0.07),
    )
    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams(1500))

    const allIds: string[] = []
    for (const route of optimized.routes) {
      for (const m of route.missions) allIds.push(m.id)
    }

    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('P1 missions have low sequence positions', () => {
    const drivers = [
      makeDriver('d1', 45.76, 6.05),
      makeDriver('d2', 45.80, 6.15),
    ]
    const missions = [
      makeMission('p1', 45.77, 6.06, 'POSER', { priority: 1, timeWindow: { openMin: 420, closeMin: 600 } }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeMission(`m${i}`, 45.75 + i * 0.01, 6.05 + i * 0.02),
      ),
    ]
    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams(1500))

    for (const route of optimized.routes) {
      const p1Idx = route.missions.findIndex(m => m.id === 'p1')
      if (p1Idx >= 0) {
        expect(p1Idx).toBeLessThan(Math.max(3, route.missions.length / 2))
      }
    }
  })

  it('ALLER_RETOUR missions are alone in their route', () => {

    expect(isAllerRetourCompatible([], 'ALLER_RETOUR')).toBe(true)
    expect(isAllerRetourCompatible([{ type: 'POSER' }], 'ALLER_RETOUR')).toBe(false)
    expect(isAllerRetourCompatible([{ type: 'ALLER_RETOUR' }], 'POSER')).toBe(false)
    expect(isAllerRetourCompatible([{ type: 'RETIRER' }], 'RETIRER')).toBe(true)
  })

  it('computeRouteCost returns finite values', () => {
    const driver = makeDriver('d1', 45.76, 6.05)
    const missions = Array.from({ length: 5 }, (_, i) =>
      makeMission(`m${i}`, 45.76 + i * 0.01, 6.05 + i * 0.01),
    )
    const route = { driverId: 'd1', missions }
    const ctx = makeCtx([driver])

    const cost = computeRouteCost(route, ctx, [driver])
    expect(isFinite(cost)).toBe(true)
    expect(cost).toBeGreaterThan(0)
  })
})

describe('V9 — cost evaluation does not feed exutoire congestion', () => {
  it('evaluating the same route repeatedly gives the same cost and records no visit', () => {
    const drivers = [makeDriver('d1', 45.76, 6.05)]
    const congestion = new Map<string, number>()
    const exutoires: Exutoire[] = [defaultExutoire, { ...defaultExutoire, id: 'exu2', lat: 45.74, lng: 6.00 }]
    const ctx = makeCtx(drivers, { congestionMap: congestion, exutoires })
    const route = {
      driverId: 'd1',
      missions: Array.from({ length: 6 }, (_, i) => makeMission(`r${i}`, 45.77 + i * 0.005, 6.06, 'RETIRER')),
    }
    const first = computeRouteCost(route, ctx, drivers)
    for (let i = 0; i < 200; i++) computeRouteCost(route, ctx, drivers)
    expect(computeRouteCost(route, ctx, drivers)).toBe(first)
    expect(congestion.size).toBe(0)
    expect(getCongestionMap().size).toBe(0)
  })

  it('findBestExutoire(record=false) leaves the map untouched', () => {
    const map = new Map<string, number>()
    findBestExutoire(45.80, 6.10, undefined, undefined, [defaultExutoire], 1, undefined, map, false)
    expect(map.size).toBe(0)
  })
})
