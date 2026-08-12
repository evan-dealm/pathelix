import { describe, it, expect } from 'vitest'
import type { Mission, Driver } from '@/lib/types'
import type { VRPSolution, CostContext } from '../types'
import { forceAssignP1 } from '../index'

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
    priority: undefined,
    ...overrides,
  }
}

const CTX: CostContext = {
  depotLat: 45.9, depotLng: 6.1, startTimeMin: 420, speedKmh: 40, exutoires: [], date: '2025-06-15',
}

describe('forceAssignP1', () => {
  it('does nothing when no P1 mission is unassigned', () => {
    const solution: VRPSolution = { routes: [{ driverId: 'd-1', missions: [] }], cost: 0 }
    const result = forceAssignP1(solution, [], CTX, [driver('d-1')])
    expect(result.routes[0].missions).toHaveLength(0)
  })

  // Regression M10: the fallback (no route passed the isHfvrpCompatible + isAllerRetourCompatible
  // checks in the main search) used to pick the least-loaded route with NO further check at all,
  // able to silently violate ALLER_RETOUR (a route must carry no other mission alongside one).
  it('respects ALLER_RETOUR in the fallback when an empty route is available — no warning needed', () => {
    const m1 = mission('m-routed', { priority: 2 })
    const p1 = mission('m-p1', { type: 'ALLER_RETOUR', priority: 1 })
    const solution: VRPSolution = {
      routes: [
        { driverId: 'd-full',  missions: [m1] }, // non-empty: NOT ALLER_RETOUR-compatible
        { driverId: 'd-empty', missions: [] },   // empty: the only valid target for ALLER_RETOUR
      ],
      cost: 0,
    }
    const warnings: NonNullable<Parameters<typeof forceAssignP1>[4]> = []
    const result = forceAssignP1(solution, [m1, p1], CTX, [driver('d-full'), driver('d-empty')], warnings)

    const emptyRoute = result.routes.find(r => r.driverId === 'd-empty')!
    expect(emptyRoute.missions.map(m => m.id)).toEqual(['m-p1'])
    // Placed into a genuinely compatible route — no need to warn about a violated constraint.
    expect(warnings.find(w => w.message.includes('m-p1'))).toBeUndefined()
  })

  it('forces the mission through and warns when NO route respects ALLER_RETOUR', () => {
    const m1 = mission('m-routed-1', { priority: 2 })
    const m2 = mission('m-routed-2', { priority: 2 })
    const p1 = mission('m-p1', { type: 'ALLER_RETOUR', priority: 1 })
    // Both routes already carry a mission — isAllerRetourCompatible is false for both.
    const solution: VRPSolution = {
      routes: [
        { driverId: 'd-1', missions: [m1] },
        { driverId: 'd-2', missions: [m2] },
      ],
      cost: 0,
    }
    const warnings: NonNullable<Parameters<typeof forceAssignP1>[4]> = []
    const result = forceAssignP1(solution, [m1, m2, p1], CTX, [driver('d-1'), driver('d-2')], warnings)

    // Still gets placed somewhere — forced assignment must not just drop the P1 mission.
    const placedIn = result.routes.filter(r => r.missions.some(m => m.id === 'm-p1'))
    expect(placedIn).toHaveLength(1)

    // But since this violates ALLER_RETOUR, it must be surfaced to the dispatcher.
    const warning = warnings.find(w => w.message.includes('m-p1'))
    expect(warning).toBeDefined()
    expect(warning!.severity).toBe('warning')
  })

  it('does not throw when warnings array is omitted', () => {
    const m1 = mission('m-routed-1', { priority: 2 })
    const m2 = mission('m-routed-2', { priority: 2 })
    const p1 = mission('m-p1', { type: 'ALLER_RETOUR', priority: 1 })
    const solution: VRPSolution = {
      routes: [
        { driverId: 'd-1', missions: [m1] },
        { driverId: 'd-2', missions: [m2] },
      ],
      cost: 0,
    }
    expect(() => forceAssignP1(solution, [m1, m2, p1], CTX, [driver('d-1'), driver('d-2')])).not.toThrow()
  })

  // Regression M7: unlike its sibling steps (threeOptOnWorstRoutes, ejectionChainSearch), this
  // function had no internal deadline check at all — on a large instance it could run past
  // timeBudgetMs uncontrolled. A past deadline must not stop it from placing P1 missions (they
  // are high priority) — it must skip straight to the cheap ALLER_RETOUR-respecting fallback
  // instead of the expensive per-position cost search.
  it('still places a P1 mission when the deadline has already passed, skipping the cost search', () => {
    const m1 = mission('m-routed', { priority: 2 })
    const p1 = mission('m-p1', { priority: 1 })
    const solution: VRPSolution = {
      routes: [
        { driverId: 'd-1', missions: [m1] },
        { driverId: 'd-empty', missions: [] },
      ],
      cost: 0,
    }
    const pastDeadline = Date.now() - 1000
    const result = forceAssignP1(solution, [m1, p1], CTX, [driver('d-1'), driver('d-empty')], undefined, pastDeadline)

    const placedIn = result.routes.filter(r => r.missions.some(m => m.id === 'm-p1'))
    expect(placedIn).toHaveLength(1)
  })
})
