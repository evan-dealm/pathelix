import { describe, it, expect } from 'vitest'
import type { Mission, Driver, Exutoire } from '@/lib/types'
import type { CostContext, ALNSParams } from '../types'
import { buildInitialSolution } from '../formatSolution'
import { computeSolutionCost } from '../routeCost'
import { runMvAlns } from '../mvAlns'

function makeDriver(id: string, lat: number, lng: number): Driver {
  return {
    id, firstName: `D${id}`, lastName: 'Test', sector: 'S1',
    depotName: 'Depot', depotLat: lat, depotLng: lng,
    vehicleCapacity: 20,
  }
}

function makeMission(
  id: string, lat: number, lng: number, type: 'POSER' | 'RETIRER' = 'POSER',
  opts?: { priority?: 1 | 2 | 3; twOpen?: number; twClose?: number; duration?: number },
): Mission {
  return {
    id, type, date: '2026-03-21', address: `Addr ${id}`,
    latitude: lat, longitude: lng,
    estimatedDurationMin: opts?.duration ?? 30,
    maneuverTimeMin: 10,
    priority: opts?.priority,
    timeWindow: opts?.twOpen !== undefined
      ? { openMin: opts.twOpen, closeMin: opts.twClose ?? opts.twOpen + 120 }
      : undefined,
  }
}

const defaultExutoire: Exutoire = {
  id: 'exu1', name: 'Exutoire Test', address: 'Test',
  lat: 45.80, lng: 6.10,
  openingHoursOpen: 420, openingHoursClose: 1080,
  closedDays: [], acceptedWasteTypes: [],
  serviceTimeMin: 15,
}

function makeCtx(drivers: Driver[]): CostContext {
  return {
    depotLat: drivers[0].depotLat, depotLng: drivers[0].depotLng,
    startTimeMin: 420, speedKmh: 50,
    exutoires: [defaultExutoire], date: '2026-03-21',
  }
}

function makeParams(budget: number = 2000): ALNSParams {
  return {
    timeBudgetMs: budget, seed: 42, iterations: 100,
    destroyRatio: 0.25, saT0Ratio: 0.05, saTMinRatio: 0.0002, rhoForget: 0.8,
  }
}

describe('VRP Solver Benchmarks', () => {
  it('Benchmark: 10 missions / 2 drivers — cost within threshold', () => {
    const drivers = [
      makeDriver('d1', 45.76, 6.05),
      makeDriver('d2', 45.80, 6.15),
    ]
    const missions = Array.from({ length: 10 }, (_, i) =>
      makeMission(`m${i}`, 45.75 + Math.sin(i) * 0.05, 6.05 + Math.cos(i) * 0.08),
    )

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams())

    expect(optimized.cost).toBeLessThan(5000)

    const assigned = optimized.routes.reduce((s, r) => s + r.missions.length, 0)
    expect(assigned).toBe(10)
  })

  it('Benchmark: 50 missions / 5 drivers — cost within threshold', () => {
    const drivers = Array.from({ length: 5 }, (_, i) =>
      makeDriver(`d${i}`, 45.70 + i * 0.03, 6.00 + i * 0.05),
    )
    const missions = Array.from({ length: 50 }, (_, i) =>
      makeMission(
        `m${i}`,
        45.70 + Math.sin(i * 0.7) * 0.08,
        6.00 + Math.cos(i * 0.7) * 0.12,
        i % 3 === 0 ? 'RETIRER' : 'POSER',
        { priority: i < 3 ? 1 : undefined },
      ),
    )

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams(3000))

    expect(optimized.cost).toBeLessThan(15000)
    const assigned = optimized.routes.reduce((s, r) => s + r.missions.length, 0)
    expect(assigned).toBe(50)

    expect(optimized.cost).toBeLessThanOrEqual(initial.cost * 1.05)
  })

  it('Benchmark: with time windows — respects P1 deadlines', () => {
    const drivers = [
      makeDriver('d1', 45.76, 6.05),
      makeDriver('d2', 45.80, 6.15),
    ]
    const missions = [
      makeMission('p1-1', 45.77, 6.06, 'POSER', { priority: 1, twOpen: 420, twClose: 540 }),
      makeMission('p1-2', 45.78, 6.07, 'POSER', { priority: 1, twOpen: 450, twClose: 570 }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeMission(`m${i}`, 45.75 + i * 0.01, 6.05 + i * 0.02, 'POSER'),
      ),
    ]

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams())

    const assigned = optimized.routes.reduce((s, r) => s + r.missions.length, 0)
    expect(assigned).toBe(10)

    const p1Positions: number[] = []
    for (const route of optimized.routes) {
      for (let i = 0; i < route.missions.length; i++) {
        if (route.missions[i].priority === 1) p1Positions.push(i)
      }
    }

    for (const pos of p1Positions) {
      expect(pos).toBeLessThan(4)
    }
  })

  it('Benchmark: ALNS improves over initial solution', () => {
    const drivers = Array.from({ length: 3 }, (_, i) =>
      makeDriver(`d${i}`, 45.75 + i * 0.02, 6.05 + i * 0.03),
    )
    const missions = Array.from({ length: 20 }, (_, i) =>
      makeMission(`m${i}`, 45.74 + Math.sin(i) * 0.04, 6.04 + Math.cos(i) * 0.06),
    )

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams(2000))

    expect(optimized.cost).toBeLessThanOrEqual(initial.cost)
  })
})

const SOLOMON_C101: Array<{ x: number; y: number; ready: number; due: number }> = [
  { x: 45, y: 68, ready: 912, due: 967 },
  { x: 45, y: 70, ready: 825, due: 870 },
  { x: 42, y: 66, ready: 65,  due: 146 },
  { x: 42, y: 68, ready: 727, due: 782 },
  { x: 42, y: 65, ready: 15,  due: 67  },
  { x: 40, y: 69, ready: 621, due: 702 },
  { x: 40, y: 66, ready: 170, due: 225 },
  { x: 38, y: 68, ready: 255, due: 324 },
  { x: 38, y: 70, ready: 534, due: 605 },
  { x: 35, y: 66, ready: 357, due: 410 },
  { x: 35, y: 69, ready: 448, due: 505 },
  { x: 25, y: 85, ready: 652, due: 721 },
  { x: 22, y: 75, ready: 30,  due: 92  },
  { x: 22, y: 85, ready: 567, due: 620 },
  { x: 20, y: 80, ready: 384, due: 429 },
]

function solomonLat(y: number): number { return 45.75 + (y - 50) * 0.003 }
function solomonLng(x: number): number { return 6.05  + (x - 40) * 0.003 }
function solomonMin(t: number): number { return 420   + Math.round(t * 660 / 1236) }

describe('Solomon C101 — Reference regression tests', () => {
  it('C101-15: all missions assigned with time windows', () => {
    const drivers = [
      makeDriver('d1', 45.75, 6.05),
      makeDriver('d2', 45.75, 6.05),
      makeDriver('d3', 45.75, 6.05),
    ]

    const missions = SOLOMON_C101.map((c, i) =>
      makeMission(`c${i + 1}`, solomonLat(c.y), solomonLng(c.x), 'POSER', {
        twOpen:  solomonMin(c.ready),
        twClose: solomonMin(c.due),
        duration: 30,
      }),
    )

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = runMvAlns(initial, ctx, drivers, makeParams(3000))

    const assigned = optimized.routes.reduce((s, r) => s + r.missions.length, 0)
    expect(assigned).toBe(15)

    expect(optimized.cost).toBeLessThan(25_000)

    expect(optimized.cost).toBeLessThanOrEqual(initial.cost * 1.05)
  })

  it('C101-15: solver completes within 5s time budget', () => {
    const drivers = [
      makeDriver('d1', 45.75, 6.05),
      makeDriver('d2', 45.75, 6.05),
    ]
    const missions = SOLOMON_C101.slice(0, 10).map((c, i) =>
      makeMission(`c${i + 1}`, solomonLat(c.y), solomonLng(c.x), 'POSER', {
        twOpen:  solomonMin(c.ready),
        twClose: solomonMin(c.due),
        duration: 30,
      }),
    )

    const ctx = makeCtx(drivers)
    const initial = buildInitialSolution(missions, drivers, ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const t0 = Date.now()
    const optimized = runMvAlns(initial, ctx, drivers, makeParams(4000))
    const elapsed = Date.now() - t0

    expect(elapsed).toBeLessThan(5000)
    const assigned = optimized.routes.reduce((s, r) => s + r.missions.length, 0)
    expect(assigned).toBe(10)
  })
})
