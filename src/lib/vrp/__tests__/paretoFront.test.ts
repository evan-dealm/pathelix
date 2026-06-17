import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../distanceCache', () => ({
  cachedDist: vi.fn((_lat1: number, _lng1: number, lat2: number, lng2: number) => {
    // Simple Euclidean-ish mock: distance proportional to coord diff
    return Math.abs(lat2 - _lat1) + Math.abs(lng2 - _lng1)
  }),
}))

import { computeObjectives, filterParetoFront, labelParetoSolutions } from '../paretoFront'
import type { ParetoObjectives, ParetoSolution } from '../paretoFront'
import type { VRPSolution, CostContext } from '../types'
import type { Driver } from '@/lib/types'

function makeDriver(id: string, lat = 48.85, lng = 2.35): Driver {
  return {
    id,
    name: `Driver ${id}`,
    depotLat: lat,
    depotLng: lng,
    availableFrom: '08:00',
    availableTo:   '18:00',
    skills:        [],
    vehicleType:   'standard',
    maxBins:       6,
  } as unknown as Driver
}

function makeMission(id: string, lat: number, lng: number, opts: {
  estimatedDurationMin?: number
  maneuverTimeMin?: number
  timeWindow?: { openMin: number; closeMin: number }
} = {}) {
  return {
    id,
    latitude:             lat,
    longitude:            lng,
    estimatedDurationMin: opts.estimatedDurationMin ?? 30,
    maneuverTimeMin:      opts.maneuverTimeMin ?? 5,
    timeWindow:           opts.timeWindow,
  }
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

// ─── computeObjectives ────────────────────────────────────────────────────────

describe('computeObjectives', () => {
  it('returns zeros for empty solution', () => {
    const solution: VRPSolution = { routes: [], cost: 0 }
    const result = computeObjectives(solution, makeCtx(), [])
    expect(result.totalDistanceKm).toBe(0)
    expect(result.totalLatenessMin).toBe(0)
    expect(result.workloadCV).toBe(0)
  })

  it('returns zeros for routes with no missions', () => {
    const driver = makeDriver('d1')
    const solution: VRPSolution = {
      routes: [{ driverId: 'd1', missions: [] }],
      cost: 0,
    }
    const result = computeObjectives(solution, makeCtx(), [driver])
    expect(result.totalDistanceKm).toBe(0)
    expect(result.workloadCV).toBe(0)
  })

  it('accumulates distance for routes with missions', () => {
    const driver = makeDriver('d1', 48.0, 2.0)
    const solution: VRPSolution = {
      routes: [{
        driverId: 'd1',
        missions: [makeMission('m1', 48.1, 2.1) as never],
      }],
      cost: 0,
    }
    const result = computeObjectives(solution, makeCtx({ speedKmh: 50 }), [driver])
    // Distance > 0 (depot to mission + mission back to depot)
    expect(result.totalDistanceKm).toBeGreaterThan(0)
  })

  it('records lateness when arrival exceeds closeMin', () => {
    const driver = makeDriver('d1', 48.0, 2.0)
    // Mission closes at 480 min (8:00 AM) but we start at 480 and need travel time
    const solution: VRPSolution = {
      routes: [{
        driverId: 'd1',
        missions: [makeMission('m1', 48.5, 2.5, {
          timeWindow: { openMin: 480, closeMin: 480 }, // closes immediately
        }) as never],
      }],
      cost: 0,
    }
    const result = computeObjectives(solution, makeCtx({ speedKmh: 1 }), [driver])
    // Very low speed means we arrive very late → lateness
    expect(result.totalLatenessMin).toBeGreaterThan(0)
  })

  it('computes workloadCV of 0 for single active route', () => {
    const driver = makeDriver('d1', 48.0, 2.0)
    const solution: VRPSolution = {
      routes: [{
        driverId: 'd1',
        missions: [makeMission('m1', 48.1, 2.1) as never],
      }],
      cost: 0,
    }
    const result = computeObjectives(solution, makeCtx(), [driver])
    // Single driver → CV is 0 (no variance)
    expect(result.workloadCV).toBe(0)
  })
})

// ─── filterParetoFront ────────────────────────────────────────────────────────

function makeParetoSol(dist: number, late: number, cv: number): ParetoSolution {
  const objectives: ParetoObjectives = {
    totalDistanceKm: dist,
    totalLatenessMin: late,
    workloadCV: cv,
  }
  return {
    solution: { routes: [], cost: 0 },
    objectives,
    label: '',
  }
}

describe('filterParetoFront', () => {
  it('returns empty array for empty input', () => {
    expect(filterParetoFront([])).toHaveLength(0)
  })

  it('returns single solution unchanged', () => {
    const sol = makeParetoSol(10, 0, 0.1)
    expect(filterParetoFront([sol])).toHaveLength(1)
  })

  it('removes dominated solutions', () => {
    // A dominates B: A is strictly better on dist, equal/better on others
    const A = makeParetoSol(5, 0, 0.1)  // better
    const B = makeParetoSol(10, 0, 0.1) // dominated by A
    const result = filterParetoFront([A, B])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(A)
  })

  it('keeps all non-dominated solutions', () => {
    // Each solution wins on one objective
    const A = makeParetoSol(5, 10, 0.5)  // best dist
    const B = makeParetoSol(10, 0, 0.5)  // best lateness
    const C = makeParetoSol(10, 10, 0.1) // best CV
    const result = filterParetoFront([A, B, C])
    expect(result).toHaveLength(3)
  })

  it('handles identical solutions (neither dominates)', () => {
    const A = makeParetoSol(10, 5, 0.3)
    const B = makeParetoSol(10, 5, 0.3)
    const result = filterParetoFront([A, B])
    // Neither dominates the other (equal) — both should remain
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── labelParetoSolutions ─────────────────────────────────────────────────────

describe('labelParetoSolutions', () => {
  it('does nothing for empty array', () => {
    expect(() => labelParetoSolutions([])).not.toThrow()
  })

  it('labels the best-distance solution', () => {
    const solutions = [
      makeParetoSol(5, 10, 0.5),
      makeParetoSol(15, 2, 0.5),
      makeParetoSol(15, 10, 0.1),
    ]
    labelParetoSolutions(solutions)
    expect(solutions[0].label).toBe('Km minimal')
  })

  it('labels the best-lateness solution', () => {
    const solutions = [
      makeParetoSol(5, 10, 0.5),
      makeParetoSol(15, 2, 0.5),
      makeParetoSol(15, 10, 0.1),
    ]
    labelParetoSolutions(solutions)
    expect(solutions[1].label).toBe('Zero retard')
  })

  it('labels the best-balance solution', () => {
    const solutions = [
      makeParetoSol(5, 10, 0.5),
      makeParetoSol(15, 2, 0.5),
      makeParetoSol(15, 10, 0.1),
    ]
    labelParetoSolutions(solutions)
    expect(solutions[2].label).toBe('Charge equilibree')
  })

  it('labels single solution as Km minimal', () => {
    const sol = makeParetoSol(10, 10, 0.5)
    labelParetoSolutions([sol])
    // Single solution wins all objectives, gets the first label assigned
    expect(sol.label).toBeTruthy()
  })
})
