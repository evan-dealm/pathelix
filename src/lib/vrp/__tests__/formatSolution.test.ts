import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mission, Driver, Exutoire } from '@/lib/types'
import type { CostContext, VRPSolution } from '../types'

// vi.hoisted so these refs are valid inside the vi.mock factory (which is hoisted)
const { mockRealDurationMin, mockRealDistanceKm } = vi.hoisted(() => ({
  mockRealDurationMin: vi.fn(() => 10),
  mockRealDistanceKm:  vi.fn(() => 0),
}))

vi.mock('../realDistance', () => ({
  realDurationMin: mockRealDurationMin,
  realDistanceKm:  mockRealDistanceKm,
}))
vi.mock('@/lib/familiarityLoader', () => ({
  getFamiliarityBonus: vi.fn(() => 0),
}))

import { buildInitialSolution, formatSolutionForAPI } from '../formatSolution'
import { MAX_CONTINUOUS_MIN, MAX_WORK_MIN, MAX_DRIVING_MIN } from '@/lib/constraints'

// ─── helpers ──────────────────────────────────────────────────────────────

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

function exutoire(id: string): Exutoire {
  return {
    id, name: 'Centre', address: 'Addr',
    lat: 45.95, lng: 6.15,
    openingHoursOpen: 360, openingHoursClose: 1200,
    closedDays: [], acceptedWasteTypes: [],
    serviceTimeMin: 15,
  }
}

function ctx(overrides: Partial<CostContext> = {}): CostContext {
  return {
    depotLat: 45.9, depotLng: 6.1,
    startTimeMin: 480, speedKmh: 50,
    exutoires: [], date: '2025-06-15',
    ...overrides,
  }
}

function solution(driverId: string, missions: Mission[]): VRPSolution {
  return { routes: [{ driverId, missions }], cost: 0 }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRealDurationMin.mockReturnValue(10)
  mockRealDistanceKm.mockReturnValue(0)
})

// ─── buildInitialSolution ─────────────────────────────────────────────────

describe('buildInitialSolution', () => {
  it('returns empty routes when no drivers', () => {
    const result = buildInitialSolution([mission('m-1')], [], ctx())
    expect(result.routes).toEqual([])
  })

  it('assigns single mission to single driver', () => {
    const result = buildInitialSolution([mission('m-1')], [driver()], ctx())
    expect(result.routes[0].missions).toHaveLength(1)
    expect(result.routes[0].missions[0].id).toBe('m-1')
  })

  it('assigns all missions when capacity allows', () => {
    const missions = ['m-1', 'm-2', 'm-3'].map(id => mission(id))
    const result = buildInitialSolution(missions, [driver()], ctx())
    expect(result.routes[0].missions).toHaveLength(3)
  })

  it('respects existing plans — m-1 present in route', () => {
    const missions = [mission('m-1'), mission('m-2')]
    const existingPlans = { 'd-1': ['m-1'] }
    const result = buildInitialSolution(missions, [driver()], ctx(), existingPlans)
    const ids = result.routes[0].missions.map(m => m.id)
    expect(ids).toContain('m-1')
  })

  it('P1 mission is assigned (priority regret bonus ensures selection)', () => {
    const missions = [
      mission('low', { priority: 3 }),
      mission('p1',  { priority: 1 }),
    ]
    const result = buildInitialSolution(missions, [driver()], ctx())
    const ids = result.routes.flatMap(r => r.missions.map(m => m.id))
    expect(ids).toContain('p1')
  })

  it('returns cost 0', () => {
    const result = buildInitialSolution([mission('m-1')], [driver()], ctx())
    expect(result.cost).toBe(0)
  })
})

// ─── formatSolutionForAPI — basic ─────────────────────────────────────────

describe('formatSolutionForAPI — basic', () => {
  it('returns empty assignments for empty routes', () => {
    const result = formatSolutionForAPI({ routes: [], cost: 0 }, [], ctx())
    expect(result.assignments).toEqual({})
    expect(result.unassignedMissions).toHaveLength(0)
  })

  it('assigns missions in sequenceOrder', () => {
    const missions = [mission('m-1'), mission('m-2')]
    const result = formatSolutionForAPI(solution('d-1', missions), [driver()], ctx())
    const planned = result.assignments['d-1']!
    expect(planned[0].id).toBe('m-1')
    expect(planned[0].sequenceOrder).toBe(0)
    expect(planned[1].id).toBe('m-2')
    expect(planned[1].sequenceOrder).toBe(1)
  })

  it('sets precomputedTravelMin from realDurationMin', () => {
    mockRealDurationMin.mockReturnValue(15)
    const result = formatSolutionForAPI(solution('d-1', [mission('m-1')]), [driver()], ctx())
    expect(result.assignments['d-1']![0].precomputedTravelMin).toBe(15)
  })

  it('stats reflect assigned vs total', () => {
    const result = formatSolutionForAPI(solution('d-1', [mission('m-1'), mission('m-2')]), [driver()], ctx())
    expect(result.stats.assignedMissions).toBe(2)
    expect(result.stats.totalMissions).toBe(2)
  })

  it('skips route when driver not found in drivers list', () => {
    const result = formatSolutionForAPI(solution('d-unknown', [mission('m-1')]), [driver('d-1')], ctx())
    expect(Object.keys(result.assignments)).toHaveLength(0)
  })
})

// ─── formatSolutionForAPI — time window ───────────────────────────────────

describe('formatSolutionForAPI — time window', () => {
  it('adds late-arrival warning when arrival after closeMin', () => {
    // mission closes at 490 min (10 min after start), travel = 10 min → arrival = 490, which is exactly at close
    // To get a warning we need arrival > closeMin: make travel return 20
    mockRealDurationMin.mockReturnValue(20)
    const m = mission('m-1', { timeWindow: { openMin: 480, closeMin: 490 } })
    const result = formatSolutionForAPI(solution('d-1', [m]), [driver()], ctx())
    const warn = result.warnings.find(w => w.message.includes('m-1'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('warning')
  })

  it('no warning when arrival within time window', () => {
    mockRealDurationMin.mockReturnValue(5)
    const m = mission('m-1', { timeWindow: { openMin: 480, closeMin: 600 } })
    const result = formatSolutionForAPI(solution('d-1', [m]), [driver()], ctx())
    expect(result.warnings.filter(w => w.message.includes('m-1'))).toHaveLength(0)
  })
})

// ─── formatSolutionForAPI — regulatory break ──────────────────────────────

describe('formatSolutionForAPI — regulatory break', () => {
  it('inserts PAUSE mission when continuous driving exceeds MAX_CONTINUOUS_MIN', () => {
    // MAX_CONTINUOUS_MIN = 270; make travel exceed it on the first mission
    mockRealDurationMin.mockReturnValue(MAX_CONTINUOUS_MIN + 5)
    const result = formatSolutionForAPI(solution('d-1', [mission('m-1')]), [driver()], ctx())
    const planned = result.assignments['d-1']!
    const pause = planned.find(p => p.type === 'PAUSE')
    expect(pause).toBeDefined()
    expect(pause!.isSynthetic).toBe(true)
  })
})

// ─── formatSolutionForAPI — overtime and driving warnings ─────────────────

describe('formatSolutionForAPI — overtime warnings', () => {
  it('emits error warning when total work exceeds MAX_WORK_MIN', () => {
    // 30 missions × (20 + 5 on-site + 10 travel) = 1050 min > 600
    const missions = Array.from({ length: 18 }, (_, i) =>
      mission(`m-${i}`, { estimatedDurationMin: 30, maneuverTimeMin: 5 }),
    )
    mockRealDurationMin.mockReturnValue(5)
    const result = formatSolutionForAPI(solution('d-1', missions), [driver()], ctx())
    const warn = result.warnings.find(w => w.message.includes('10h'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('error')
  })

  it('emits error warning when total driving exceeds MAX_DRIVING_MIN', () => {
    // Many missions each with MAX_DRIVING_MIN/count+1 travel
    const missionCount = 5
    const travelPerMission = Math.ceil(MAX_DRIVING_MIN / missionCount) + 1
    mockRealDurationMin.mockReturnValue(travelPerMission)
    const missions = Array.from({ length: missionCount }, (_, i) =>
      mission(`m-${i}`, { estimatedDurationMin: 5, maneuverTimeMin: 0 }),
    )
    const result = formatSolutionForAPI(solution('d-1', missions), [driver()], ctx())
    const warn = result.warnings.find(w => w.message.includes('9h'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('error')
  })

  // Regression N12: `mission.estimatedDurationMin + (mission.maneuverTimeMin ?? 0)` had no `?? 0`
  // guard on estimatedDurationMin itself (unlike every other usage in this file). Type says it's
  // required, but a malformed/legacy row bypassing that would turn onSiteMin into NaN, which then
  // poisons totalWork/currentMin for every mission processed after it in the same route — e.g.
  // silently suppressing a legitimate overtime warning, since `NaN > MAX_WORK_MIN` is false.
  it('still correctly totals work (and warns) when one mission has a malformed duration', () => {
    const missions = [
      // Malformed: bypasses the required `number` type — simulates bad/legacy data.
      mission('m-bad', { estimatedDurationMin: undefined as unknown as number, maneuverTimeMin: 5 }),
      ...Array.from({ length: 18 }, (_, i) =>
        mission(`m-${i}`, { estimatedDurationMin: 30, maneuverTimeMin: 5 }),
      ),
    ]
    mockRealDurationMin.mockReturnValue(5)
    const result = formatSolutionForAPI(solution('d-1', missions), [driver()], ctx())
    const warn = result.warnings.find(w => w.message.includes('10h'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('error')
  })
})

// ─── formatSolutionForAPI — P1 deadline ───────────────────────────────────

describe('formatSolutionForAPI — P1 deadline warning', () => {
  it('emits error when P1 mission served after deadline', () => {
    // effectiveP1Deadline = max(P1_DEADLINE_MIN=660, startTime=480+240) = 720
    // travel = 300 → arrival = 480+300 = 780 > 720
    mockRealDurationMin.mockReturnValue(300)
    const m = mission('p1', { priority: 1, estimatedDurationMin: 5, maneuverTimeMin: 0 })
    const result = formatSolutionForAPI(solution('d-1', [m]), [driver()], ctx())
    const warn = result.warnings.find(w => w.driverId === 'd-1' && w.severity === 'error' && w.message.includes('P1'))
    expect(warn).toBeDefined()
  })
})

// ─── formatSolutionForAPI — ALLER_RETOUR ──────────────────────────────────

describe('formatSolutionForAPI — ALLER_RETOUR', () => {
  it('warns when no exutoire found for ALLER_RETOUR', () => {
    const m = mission('m-ar', { type: 'ALLER_RETOUR' })
    const result = formatSolutionForAPI(solution('d-1', [m]), [driver()], ctx({ exutoires: [] }))
    const warn = result.warnings.find(w => w.message.includes('aucun exutoire'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('warning')
  })

  it('inserts synthetic VIDER + POSER steps when exutoire found', () => {
    const ex = exutoire('ex-1')
    const m  = mission('m-ar', { type: 'ALLER_RETOUR', linkedExutoireId: 'ex-1' })
    const result = formatSolutionForAPI(
      solution('d-1', [m]), [driver()],
      ctx({ exutoires: [ex] }),
    )
    const planned = result.assignments['d-1']!
    expect(planned.some(p => p.type === 'VIDER')).toBe(true)
    expect(planned.some(p => p.type === 'POSER' && p.isSynthetic)).toBe(true)
  })
})

// ─── formatSolutionForAPI — congestion detection ──────────────────────────

describe('formatSolutionForAPI — exutoire congestion', () => {
  it('warns when 3+ trucks arrive at same exutoire within 30 min', () => {
    const ex = exutoire('ex-cong')
    // 3 drivers each with a RETIRER mission linked to the same exutoire
    // All arrive at currentMin ≈ 480+10+20=510, well within 30-min window
    mockRealDurationMin.mockReturnValue(5)
    const drivers  = ['d-1', 'd-2', 'd-3'].map(id => driver(id))
    const missions3 = drivers.map((d, i) => mission(`m-${i}`, {
      type: 'RETIRER', linkedExutoireId: 'ex-cong',
    }))
    const sol: VRPSolution = {
      routes: drivers.map((d, i) => ({ driverId: d.id, missions: [missions3[i]] })),
      cost: 0,
    }
    const result = formatSolutionForAPI(sol, drivers, ctx({ exutoires: [ex] }))
    const warn = result.warnings.find(w => w.message.includes('Congestion'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('warning')
  })
})
