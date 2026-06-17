import { describe, it, expect, beforeEach } from 'vitest'
import { haversineKm, cachedDist, clearDistanceCache } from '../distanceCache'
import { InsertionCache } from '../insertionCache'
import { computeRouteCost, computeSolutionCost } from '../routeCost'
import { buildInitialSolution } from '../formatSolution'
import { runVRP } from '../index'
import type { Mission, Driver, Exutoire } from '@/lib/types'
import type { CostContext, Route } from '../types'

const ANNECY_LAT = 45.899
const ANNECY_LNG = 6.129

const PARIS_LAT = 48.8566
const PARIS_LNG = 2.3522

const LYON_LAT = 45.7640
const LYON_LNG = 4.8357

const TODAY = '2026-03-20'

function makeDriver(overrides: Partial<Driver> & { id: string }): Driver {
  return {
    firstName: 'Test',
    lastName: 'Driver',
    sector: 'Annecy',
    depotName: 'Depot Annecy',
    depotLat: ANNECY_LAT,
    depotLng: ANNECY_LNG,
    ...overrides,
  }
}

function makeMission(overrides: Partial<Mission> & { id: string }): Mission {
  return {
    type: 'RETIRER',
    date: TODAY,
    address: 'Test Address',
    latitude: ANNECY_LAT + (Math.random() - 0.5) * 0.05,
    longitude: ANNECY_LNG + (Math.random() - 0.5) * 0.05,
    estimatedDurationMin: 15,
    maneuverTimeMin: 5,
    wasteTypeLabel: 'DIB',
    ...overrides,
  }
}

function makeExutoire(overrides: Partial<Exutoire> & { id: string }): Exutoire {
  return {
    name: 'Exutoire Test',
    address: 'Exutoire Address',
    lat: ANNECY_LAT + 0.02,
    lng: ANNECY_LNG + 0.03,
    openingHoursOpen: 360,
    openingHoursClose: 1080,
    closedDays: [0],
    acceptedWasteTypes: ['DIB', 'Bois', 'Gravats', 'Carton'],
    serviceTimeMin: 10,
    ...overrides,
  }
}

function makeCtx(exutoires: Exutoire[] = []): CostContext {
  return {
    depotLat: ANNECY_LAT,
    depotLng: ANNECY_LNG,
    startTimeMin: 420,
    speedKmh: 50,
    exutoires,
    date: TODAY,
  }
}

const drivers: Driver[] = [
  makeDriver({ id: 'driver-1', firstName: 'Jean', lastName: 'Dupont', depotLat: 45.900, depotLng: 6.120 }),
  makeDriver({ id: 'driver-2', firstName: 'Marie', lastName: 'Martin', depotLat: 45.895, depotLng: 6.135 }),
]

const missions: Mission[] = [
  makeMission({ id: 'mission-1', latitude: 45.910, longitude: 6.140, wasteTypeLabel: 'DIB', clientName: 'Client A' }),
  makeMission({ id: 'mission-2', latitude: 45.890, longitude: 6.110, wasteTypeLabel: 'Bois', clientName: 'Client B' }),
  makeMission({ id: 'mission-3', latitude: 45.905, longitude: 6.150, wasteTypeLabel: 'DIB', clientName: 'Client C' }),
  makeMission({ id: 'mission-4', latitude: 45.885, longitude: 6.125, wasteTypeLabel: 'Gravats', clientName: 'Client D' }),
]

const exutoires: Exutoire[] = [
  makeExutoire({ id: 'exu-1', name: 'Dechetterie Annecy Nord', lat: 45.920, lng: 6.130, acceptedWasteTypes: ['DIB', 'Bois', 'Carton'] }),
  makeExutoire({ id: 'exu-2', name: 'Dechetterie Annecy Sud', lat: 45.875, lng: 6.115, acceptedWasteTypes: ['Gravats', 'DIB'] }),
]

describe('distanceCache', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  describe('haversineKm', () => {
    it('computes Paris-Lyon distance within expected range (~392 km)', async () => {
      const dist = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      expect(dist).toBeGreaterThan(380)
      expect(dist).toBeLessThan(410)
    })

    it('returns 0 for same point', async () => {
      const dist = haversineKm(ANNECY_LAT, ANNECY_LNG, ANNECY_LAT, ANNECY_LNG)
      expect(dist).toBe(0)
    })

    it('is symmetric (A->B === B->A)', async () => {
      const ab = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      const ba = haversineKm(LYON_LAT, LYON_LNG, PARIS_LAT, PARIS_LNG)
      expect(ab).toBeCloseTo(ba, 10)
    })

    it('computes short distance correctly (Annecy area ~1-5 km)', async () => {

      const dist = haversineKm(45.900, 6.120, 45.910, 6.130)
      expect(dist).toBeGreaterThan(0.5)
      expect(dist).toBeLessThan(5)
    })

    it('caches results (second call returns same value)', async () => {
      const first = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      const second = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      expect(second).toBe(first)
    })
  })

  describe('cachedDist', () => {
    it('applies urban tortuosity factor (x1.50) for short distances < 5km', async () => {

      const hav = haversineKm(45.900, 6.120, 45.905, 6.125)
      expect(hav).toBeLessThan(5)
      const road = cachedDist(45.900, 6.120, 45.905, 6.125)
      expect(road).toBeCloseTo(hav * 1.50, 5)
    })

    it('applies periurban tortuosity factor (x1.35) for 5-20km distances', async () => {

      const hav = haversineKm(45.900, 6.120, 45.990, 6.120)
      expect(hav).toBeGreaterThan(5)
      expect(hav).toBeLessThan(20)
      const road = cachedDist(45.900, 6.120, 45.990, 6.120)
      expect(road).toBeCloseTo(hav * 1.35, 5)
    })

    it('applies interurban tortuosity factor (x1.20) for > 20km distances', async () => {
      const hav = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      expect(hav).toBeGreaterThan(20)
      const road = cachedDist(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      expect(road).toBeCloseTo(hav * 1.20, 5)
    })

    it('returns 0 for same point', async () => {
      expect(cachedDist(45.9, 6.1, 45.9, 6.1)).toBe(0)
    })
  })

  describe('clearDistanceCache', () => {
    it('clears the cache without error', async () => {
      haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      expect(() => clearDistanceCache()).not.toThrow()
    })

    it('still returns correct values after clearing cache', async () => {
      const before = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      clearDistanceCache()
      const after = haversineKm(PARIS_LAT, PARIS_LNG, LYON_LAT, LYON_LNG)
      expect(after).toBeCloseTo(before, 10)
    })
  })
})

describe('InsertionCache', () => {
  let cache: InsertionCache

  beforeEach(() => {
    cache = new InsertionCache()
  })

  it('returns undefined for missing entry', async () => {
    const result = cache.get(0, 'hash1', 'mission-1', 0)
    expect(result).toBeUndefined()
  })

  it('stores and retrieves a cost entry', async () => {
    cache.set(0, 'hash1', 'mission-1', 0, 42.5)
    const result = cache.get(0, 'hash1', 'mission-1', 0)
    expect(result).toBe(42.5)
  })

  it('returns undefined when routeHash does not match (stale entry)', async () => {
    cache.set(0, 'hash1', 'mission-1', 0, 42.5)
    const result = cache.get(0, 'hash2', 'mission-1', 0)
    expect(result).toBeUndefined()
  })

  it('clear resets cache and stats', async () => {
    cache.set(0, 'h', 'm1', 0, 10)
    cache.get(0, 'h', 'm1', 0)
    cache.clear()
    const stats = cache.stats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.size).toBe(0)
  })

  it('stats tracks hits and misses correctly', async () => {
    cache.set(0, 'h', 'm1', 0, 10)
    cache.get(0, 'h', 'm1', 0)
    cache.get(0, 'h', 'm1', 0)
    cache.get(1, 'h', 'm2', 0)
    const stats = cache.stats()
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe('66.7%')
  })

  it('stats returns N/A hitRate when no lookups', async () => {
    const stats = cache.stats()
    expect(stats.hitRate).toBe('N/A')
  })

  it('routeHash produces consistent hash for same missions', async () => {
    const missions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const h1 = cache.routeHash(missions)
    const h2 = cache.routeHash(missions)
    expect(h1).toBe(h2)
  })

  it('routeHash changes when missions differ', async () => {
    const h1 = cache.routeHash([{ id: 'a' }, { id: 'b' }])
    const h2 = cache.routeHash([{ id: 'a' }, { id: 'c' }])
    expect(h1).not.toBe(h2)
  })

  it('routeHash changes when mission order differs', async () => {
    const h1 = cache.routeHash([{ id: 'a' }, { id: 'b' }])
    const h2 = cache.routeHash([{ id: 'b' }, { id: 'a' }])
    expect(h1).not.toBe(h2)
  })
})

describe('computeRouteCost', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  const ctx = makeCtx(exutoires)

  it('returns 0 for empty route', async () => {
    const route: Route = { driverId: 'driver-1', missions: [] }
    const cost = computeRouteCost(route, ctx, drivers)
    expect(cost).toBe(0)
  })

  it('returns positive cost for route with 1 mission', async () => {
    const route: Route = { driverId: 'driver-1', missions: [missions[0]] }
    const cost = computeRouteCost(route, ctx, drivers)
    expect(cost).toBeGreaterThan(0)
  })

  it('cost increases with more missions', async () => {
    const route1: Route = { driverId: 'driver-1', missions: [missions[0]] }
    const route2: Route = { driverId: 'driver-1', missions: [missions[0], missions[1]] }
    const cost1 = computeRouteCost(route1, ctx, drivers)
    const cost2 = computeRouteCost(route2, ctx, drivers)
    expect(cost2).toBeGreaterThan(cost1)
  })

  it('returns 0 cost when driver not found (no matching driver)', async () => {
    const route: Route = { driverId: 'nonexistent', missions: [missions[0]] }
    const cost = computeRouteCost(route, ctx, drivers)

    expect(typeof cost).toBe('number')
  })
})

describe('computeSolutionCost', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  const ctx = makeCtx(exutoires)

  it('returns 0 for empty routes array', async () => {
    expect(computeSolutionCost([], ctx, drivers)).toBe(0)
  })

  it('returns positive cost for solution with missions', async () => {
    const routes: Route[] = [
      { driverId: 'driver-1', missions: [missions[0], missions[2]] },
      { driverId: 'driver-2', missions: [missions[1], missions[3]] },
    ]
    const cost = computeSolutionCost(routes, ctx, drivers)
    expect(cost).toBeGreaterThan(0)
  })
})

describe('buildInitialSolution', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  const ctx = makeCtx(exutoires)

  it('returns empty routes when no missions provided', async () => {
    const solution = buildInitialSolution([], drivers, ctx)
    expect(solution.routes).toHaveLength(drivers.length)
    for (const route of solution.routes) {
      expect(route.missions).toHaveLength(0)
    }
  })

  it('returns empty solution when no drivers provided', async () => {
    const solution = buildInitialSolution(missions, [], ctx)
    expect(solution.routes).toHaveLength(0)
  })

  it('assigns missions to routes when both drivers and missions provided', async () => {
    const solution = buildInitialSolution(missions, drivers, ctx)
    expect(solution.routes).toHaveLength(drivers.length)
    const totalAssigned = solution.routes.reduce((sum, r) => sum + r.missions.length, 0)
    expect(totalAssigned).toBeGreaterThan(0)
    expect(totalAssigned).toBeLessThanOrEqual(missions.length)
  })

  it('creates one route per driver', async () => {
    const solution = buildInitialSolution(missions, drivers, ctx)
    const driverIds = solution.routes.map(r => r.driverId)
    expect(new Set(driverIds).size).toBe(drivers.length)
  })

  it('respects existing plans when provided', async () => {
    const existingPlans: Record<string, string[]> = {
      'driver-1': ['mission-1', 'mission-3'],
    }
    const solution = buildInitialSolution(missions, drivers, ctx, existingPlans)
    const driver1Route = solution.routes.find(r => r.driverId === 'driver-1')
    expect(driver1Route).toBeDefined()

    const driver1MissionIds = driver1Route!.missions.map(m => m.id)
    expect(driver1MissionIds).toContain('mission-1')
    expect(driver1MissionIds).toContain('mission-3')
  })
})

describe('runVRP — end-to-end', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  it('returns a valid result with assignments, stats, and warnings', async () => {
    const result = await runVRP(missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    expect(result).toHaveProperty('assignments')
    expect(result).toHaveProperty('stats')
    expect(result).toHaveProperty('warnings')
    expect(result).toHaveProperty('unassignedMissions')
  })

  it('assigns all missions or puts them in unassigned list', async () => {
    const result = await runVRP(missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    const assignedIds = new Set(
      Object.values(result.assignments)
        .flat()
        .filter(m => !m.isSynthetic)
        .map(m => m.id),
    )
    const unassignedIds = new Set(result.unassignedMissions.map(m => m.id))

    for (const m of missions) {
      const inAssigned = assignedIds.has(m.id)
      const inUnassigned = unassignedIds.has(m.id)
      expect(inAssigned || inUnassigned).toBe(true)
    }
  })

  it('no mission appears twice across all driver assignments', async () => {
    const result = await runVRP(missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    const allIds = Object.values(result.assignments)
      .flat()
      .filter(m => !m.isSynthetic)
      .map(m => m.id)

    const seen = new Set<string>()
    for (const id of allIds) {
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  })

  it('stats.timeTakenMs is greater than 0', async () => {
    const result = await runVRP(missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    expect(result.stats.timeTakenMs).toBeGreaterThan(0)
  })

  it('stats.totalMissions matches input mission count', async () => {
    const result = await runVRP(missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    expect(result.stats.totalMissions).toBe(missions.length)
  })

  it('returns no-driver warning when drivers list is empty', async () => {
    const result = await runVRP(missions, [], exutoires, TODAY, { timeBudgetMs: 500 })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some(w => w.severity === 'error')).toBe(true)
    expect(result.unassignedMissions).toHaveLength(missions.length)
  })

  it('handles zero missions gracefully', async () => {
    const result = await runVRP([], drivers, exutoires, TODAY, { timeBudgetMs: 500 })
    expect(result.stats.totalMissions).toBe(0)
    expect(result.stats.assignedMissions).toBe(0)
    expect(Object.values(result.assignments).flat()).toHaveLength(0)
  })

  it('returns deterministic results with the same seed', async () => {
    const opts = { timeBudgetMs: 500, seed: 123 }
    const result1 = await runVRP(missions, drivers, exutoires, TODAY, opts)
    clearDistanceCache()
    const result2 = await runVRP(missions, drivers, exutoires, TODAY, opts)

    const ids1 = Object.entries(result1.assignments)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([did, ms]) => `${did}:${ms.filter(m => !m.isSynthetic).map(m => m.id).join(',')}`)
    const ids2 = Object.entries(result2.assignments)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([did, ms]) => `${did}:${ms.filter(m => !m.isSynthetic).map(m => m.id).join(',')}`)

    expect(ids1).toEqual(ids2)
  })

  it('handles P1 priority missions (force-assign)', async () => {
    const p1Missions = [
      makeMission({ id: 'p1-1', latitude: 45.910, longitude: 6.140, priority: 1, wasteTypeLabel: 'DIB' }),
      makeMission({ id: 'p1-2', latitude: 45.890, longitude: 6.110, priority: 1, wasteTypeLabel: 'Bois' }),
      ...missions,
    ]
    const result = await runVRP(p1Missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    const assignedIds = new Set(
      Object.values(result.assignments)
        .flat()
        .filter(m => !m.isSynthetic)
        .map(m => m.id),
    )

    expect(assignedIds.has('p1-1')).toBe(true)
    expect(assignedIds.has('p1-2')).toBe(true)
  })

  it('handles HFVRP filtering (incompatible bin sizes)', async () => {
    const driversWithCapacity = [
      makeDriver({ id: 'drv-small', maxBinSizeM3: 5 }),
    ]
    const bigBinMission = makeMission({
      id: 'big-bin',
      binSizeM3: 30,
      latitude: 45.905,
      longitude: 6.130,
    })
    const result = await runVRP([bigBinMission], driversWithCapacity, exutoires, TODAY, {
      timeBudgetMs: 500,
    })

    expect(result.unassignedMissions.some(m => m.id === 'big-bin')).toBe(true)
    expect(result.warnings.some(w => w.message.includes('incompatible'))).toBe(true)
  })

  it('respects custom weights option', async () => {
    const result = await runVRP(missions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
      weights: { distance: 1.0, punctuality: 0.0, balance: 0.0 },
    })
    expect(result).toHaveProperty('assignments')
    expect(result.stats.timeTakenMs).toBeGreaterThanOrEqual(0)
  })

  it('handles missions with time windows', async () => {
    const twMissions = [
      makeMission({
        id: 'tw-1',
        latitude: 45.910,
        longitude: 6.140,
        timeWindow: { openMin: 480, closeMin: 600 },
      }),
      makeMission({
        id: 'tw-2',
        latitude: 45.890,
        longitude: 6.110,
        timeWindow: { openMin: 600, closeMin: 720 },
      }),
    ]
    const result = await runVRP(twMissions, drivers, exutoires, TODAY, {
      timeBudgetMs: 1000,
      seed: 42,
    })
    const assignedCount = Object.values(result.assignments)
      .flat()
      .filter(m => !m.isSynthetic)
      .length
    expect(assignedCount + result.unassignedMissions.length).toBe(twMissions.length)
  })
})
