import { describe, it, expect } from 'vitest'
import type { Mission, Driver } from '@/lib/types'
import type { VRPSolution, CostContext } from '../types'
import { compactRoutes } from '../index'

function driver(id: string, overrides: Partial<Driver> = {}): Driver {
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

const CTX: CostContext = {
  depotLat: 45.9, depotLng: 6.1, startTimeMin: 420, speedKmh: 40, exutoires: [], date: '2025-06-15',
}

// d-short's depot is far from its own mission (expensive standalone round trip); d-target's
// depot and mission sit right where m-short physically is, so folding m-short into d-target's
// route costs almost nothing extra — a clear net win, giving compactRoutes a real incentive to
// merge (unlike same-location fixtures, where standalone-vs-merged costs are both ~0 and there's
// nothing to gain either way).
function makeMergeableSolution() {
  const mShort  = mission('m-short',  { latitude: 45.9, longitude: 6.1 })
  const mTarget = mission('m-target', { latitude: 45.9, longitude: 6.1 })
  const drivers = [
    driver('d-short',  { depotLat: 0, depotLng: 0 }),
    driver('d-target', { depotLat: 45.9, depotLng: 6.1 }),
  ]
  const solution: VRPSolution = {
    routes: [
      { driverId: 'd-short',  missions: [mShort] },
      { driverId: 'd-target', missions: [mTarget] },
    ],
    cost: 0,
  }
  return { solution, drivers }
}

describe('compactRoutes', () => {
  it('folds a single-mission route into a compatible target route when there is time', () => {
    const { solution, drivers } = makeMergeableSolution()
    const result = compactRoutes(solution, CTX, drivers)

    const shortRoute = result.routes.find(r => r.driverId === 'd-short')!
    // The single mission should have been folded elsewhere, emptying its original route.
    expect(shortRoute.missions).toHaveLength(0)
    const totalMissions = result.routes.reduce((n, r) => n + r.missions.length, 0)
    expect(totalMissions).toBe(2) // conserved, nothing lost or duplicated
  })

  // Regression M7: unlike its sibling steps (threeOptOnWorstRoutes, ejectionChainSearch), this
  // function had no internal deadline check — on an instance with many single-mission routes it
  // could run long past timeBudgetMs, a plausible contributor to an unreproduced server CPU
  // incident noted in the July 2026 pre-pilot audit.
  it('does nothing once the deadline has already passed', () => {
    const { solution, drivers } = makeMergeableSolution()
    const pastDeadline = Date.now() - 1000
    const result = compactRoutes(solution, CTX, drivers, pastDeadline)

    // Untouched — the deadline was already gone before the first short route could be processed.
    const shortRoute = result.routes.find(r => r.driverId === 'd-short')!
    expect(shortRoute.missions.map(m => m.id)).toEqual(['m-short'])
  })

  it('still compacts normally when the deadline is comfortably in the future', () => {
    const { solution, drivers } = makeMergeableSolution()
    const farFuture = Date.now() + 60_000
    const result = compactRoutes(solution, CTX, drivers, farFuture)

    const shortRoute = result.routes.find(r => r.driverId === 'd-short')!
    expect(shortRoute.missions).toHaveLength(0)
  })
})
