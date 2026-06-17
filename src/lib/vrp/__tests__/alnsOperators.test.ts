import { describe, it, expect, vi } from 'vitest'
import {
  SeededRng,
  destroyRandom,
  destroyWorst,
  repairGreedy,
  repairRegret2,
  crossRouteOrOpt,
  relocateSearch,
  swapSearch,
} from '../operators'
import type { VRPSolution, CostContext } from '../types'
import type { Driver, Mission } from '@/lib/types'

vi.mock('@/lib/algorithm', () => ({
  travelTimeMin: () => 10,
}))
vi.mock('@/lib/familiarityLoader', () => ({
  getFamiliarityBonus: () => 0,
}))
vi.mock('../realDistance', () => ({
  realDurationMin: () => null,
  realDistanceKm: () => null,
}))

function makeMission(id: string, lat = 45.9, lng = 6.1): Mission {
  return {
    id,
    type: 'POSER',
    date: '2025-06-15',
    address: 'test',
    latitude: lat,
    longitude: lng,
    estimatedDurationMin: 20,
    maneuverTimeMin: 5,
  }
}

function makeSolution(routes: { driverId: string; missions: Mission[] }[]): VRPSolution {
  return { routes, cost: 0 }
}

function makeCtx(): CostContext {
  return {
    depotLat: 45.9,
    depotLng: 6.1,
    startTimeMin: 480,
    speedKmh: 40,
    exutoires: [],
    date: '2025-06-15',
  }
}

function makeDrivers(): Driver[] {
  return [
    { id: 'd-1', firstName: 'A', lastName: 'A', sector: 'N', depotName: 'D', depotLat: 45.9, depotLng: 6.1, archived: false },
    { id: 'd-2', firstName: 'B', lastName: 'B', sector: 'N', depotName: 'D', depotLat: 45.9, depotLng: 6.1, archived: false },
  ]
}

describe('SeededRng', () => {
  it('produit des nombres entre 0 et 1', () => {
    const rng = new SeededRng(42)
    for (let i = 0; i < 100; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('est déterministe avec la même graine', () => {
    const rng1 = new SeededRng(123)
    const rng2 = new SeededRng(123)
    for (let i = 0; i < 50; i++) {
      expect(rng1.next()).toBe(rng2.next())
    }
  })

  it('produit des séquences différentes pour des graines différentes', () => {
    const rng1 = new SeededRng(1)
    const rng2 = new SeededRng(2)
    const seq1 = Array.from({ length: 10 }, () => rng1.next())
    const seq2 = Array.from({ length: 10 }, () => rng2.next())
    expect(seq1).not.toEqual(seq2)
  })

  it('distribution uniforme approximative', () => {
    const rng = new SeededRng(999)
    let below = 0
    const N = 10000
    for (let i = 0; i < N; i++) {
      if (rng.next() < 0.5) below++
    }
    expect(below / N).toBeGreaterThan(0.45)
    expect(below / N).toBeLessThan(0.55)
  })

  it('int(n) produit des entiers dans [0, n)', () => {
    const rng = new SeededRng(42)
    for (let i = 0; i < 100; i++) {
      const v = rng.int(10)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(10)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('int(1) retourne toujours 0', () => {
    const rng = new SeededRng(42)
    for (let i = 0; i < 20; i++) {
      expect(rng.int(1)).toBe(0)
    }
  })
})

describe('destroyRandom', () => {
  it('retire le bon nombre de missions', () => {
    const missions = Array.from({ length: 10 }, (_, i) => makeMission(`m-${i}`))
    const solution = makeSolution([{ driverId: 'd-1', missions }])
    const rng = new SeededRng(42)
    const result = destroyRandom(solution, 3, rng)
    expect(result.removed).toHaveLength(3)
    const remaining = result.partial.routes.reduce((acc, r) => acc + r.missions.length, 0)
    expect(remaining + result.removed.length).toBe(10)
  })

  it('ne retire pas plus que disponible', () => {
    const solution = makeSolution([{ driverId: 'd-1', missions: [makeMission('m-1')] }])
    const rng = new SeededRng(42)
    const result = destroyRandom(solution, 5, rng)
    expect(result.removed.length).toBeLessThanOrEqual(1)
  })

  it('missions retirées sont uniques', () => {
    const missions = Array.from({ length: 20 }, (_, i) => makeMission(`m-${i}`))
    const solution = makeSolution([{ driverId: 'd-1', missions }])
    const rng = new SeededRng(42)
    const result = destroyRandom(solution, 8, rng)
    const ids = result.removed.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('destroyWorst', () => {
  it('retire des missions (les plus coûteuses)', () => {
    const missions = Array.from({ length: 10 }, (_, i) =>
      makeMission(`m-${i}`, 45.9 + i * 0.1, 6.1 + i * 0.1)
    )
    const solution = makeSolution([{ driverId: 'd-1', missions }])
    const ctx = makeCtx()
    const drivers = makeDrivers()
    const rng = new SeededRng(42)
    const result = destroyWorst(solution, 3, ctx, drivers)
    expect(result.removed.length).toBeGreaterThan(0)
    expect(result.removed.length).toBeLessThanOrEqual(3)
  })
})

describe('repairGreedy', () => {
  it('insère les missions retirées dans les routes', () => {
    const solution = makeSolution([
      { driverId: 'd-1', missions: [makeMission('m-1')] },
      { driverId: 'd-2', missions: [] },
    ])
    const removed = [makeMission('m-2'), makeMission('m-3')]
    const ctx = makeCtx()
    const drivers = makeDrivers()
    const result = repairGreedy(solution, removed, ctx, drivers)
    const totalMissions = result.routes.reduce((acc, r) => acc + r.missions.length, 0)
    expect(totalMissions).toBe(3)
  })
})

describe('repairRegret2', () => {
  it('insère les missions avec stratégie regret', () => {
    const solution = makeSolution([
      { driverId: 'd-1', missions: [] },
      { driverId: 'd-2', missions: [] },
    ])
    const removed = [makeMission('m-1'), makeMission('m-2')]
    const ctx = makeCtx()
    const drivers = makeDrivers()
    const result = repairRegret2(solution, removed, ctx, drivers)
    const totalMissions = result.routes.reduce((acc, r) => acc + r.missions.length, 0)
    expect(totalMissions).toBe(2)
  })
})

describe('relocateSearch', () => {
  it('conserve toutes les missions', () => {
    const solution = makeSolution([
      { driverId: 'd-1', missions: [makeMission('m-1'), makeMission('m-2'), makeMission('m-3')] },
      { driverId: 'd-2', missions: [makeMission('m-4')] },
    ])
    const ctx = makeCtx()
    const drivers = makeDrivers()
    const deadline = Date.now() + 2000
    const result = relocateSearch(solution, ctx, drivers, deadline)
    const totalBefore = solution.routes.reduce((acc, r) => acc + r.missions.length, 0)
    const totalAfter = result.routes.reduce((acc, r) => acc + r.missions.length, 0)
    expect(totalAfter).toBe(totalBefore)
  })
})

describe('swapSearch', () => {
  it('conserve toutes les missions', () => {
    const solution = makeSolution([
      { driverId: 'd-1', missions: [makeMission('m-1', 46.0, 6.5), makeMission('m-2', 45.91, 6.11)] },
      { driverId: 'd-2', missions: [makeMission('m-3', 45.92, 6.12), makeMission('m-4', 46.1, 6.6)] },
    ])
    const ctx = makeCtx()
    const drivers = makeDrivers()
    const deadline = Date.now() + 2000
    const result = swapSearch(solution, ctx, drivers, deadline)
    const totalBefore = solution.routes.reduce((acc, r) => acc + r.missions.length, 0)
    const totalAfter = result.routes.reduce((acc, r) => acc + r.missions.length, 0)
    expect(totalAfter).toBe(totalBefore)
  })
})

describe('crossRouteOrOpt', () => {
  it('conserve toutes les missions', () => {
    const solution = makeSolution([
      { driverId: 'd-1', missions: [makeMission('m-1'), makeMission('m-2'), makeMission('m-3')] },
      { driverId: 'd-2', missions: [makeMission('m-4'), makeMission('m-5')] },
    ])
    const ctx = makeCtx()
    const drivers = makeDrivers()
    const deadline = Date.now() + 2000
    const result = crossRouteOrOpt(solution, ctx, drivers, deadline)
    const totalBefore = solution.routes.reduce((acc, r) => acc + r.missions.length, 0)
    const totalAfter = result.routes.reduce((acc, r) => acc + r.missions.length, 0)
    expect(totalAfter).toBe(totalBefore)
  })
})
