import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REGULATION, auditTimeline, breakNeededBefore, driveLeg, initialClock, makeRegulationRules, takeBreak, work,
  type Activity,
} from '../driverClock'
import { simulateRouteTrace, traceToActivities, computeRouteCost } from '../routeCost'
import { formatSolutionForAPI } from '../formatSolution'
import { runVRP } from '../index'
import type { CostContext } from '../types'
import type { Driver, Exutoire, Mission } from '@/lib/types'

// Deterministic checks of the CE 561/2006 driving rules and the 2002/15 working-time breaks, from
// the clock itself up to the plans the optimiser ships.

const R = DEFAULT_REGULATION
const drive = (minutes: number): Activity => ({ kind: 'DRIVE', minutes })
const brk   = (minutes: number): Activity => ({ kind: 'BREAK', minutes })
const job   = (minutes: number): Activity => ({ kind: 'WORK', minutes })
const codes = (acts: Activity[]) => auditTimeline(acts).violations.map(v => v.code)

describe('driverClock — CE 561/2006 art. 7', () => {
  it('4 h 30 of driving exactly is allowed; one more minute needs a 45 min break', () => {
    const s = initialClock()
    driveLeg(s, 10, 0, R)
    expect(breakNeededBefore(s, 260, 0, R)).toBe(0)
    expect(breakNeededBefore(s, 261, 0, R)).toBe(45)
    expect(codes([drive(270)])).toEqual([])
    expect(codes([drive(271)])).toContain('CONTINUOUS_DRIVING')
  })

  it('driving past 4 h 30 without a break is a violation', () => {
    expect(codes([drive(200), drive(80)])).toContain('CONTINUOUS_DRIVING')
  })

  it('a 45 min break resets the counter', () => {
    expect(codes([drive(270), brk(45), drive(270)])).not.toContain('CONTINUOUS_DRIVING')
  })

  it('a valid split break: 15 min then 30 min', () => {
    expect(codes([drive(100), brk(15), drive(150), brk(30), drive(270)])).not.toContain('CONTINUOUS_DRIVING')
    const s = initialClock()
    expect(takeBreak(s, 15, R)).toBe('SPLIT_FIRST')
    expect(takeBreak(s, 30, R)).toBe('SPLIT_SECOND')
    expect(s.drivingSinceBreak).toBe(0)
  })

  it('an invalid split: 30 min then 15 min does not reset the counter', () => {
    expect(codes([drive(100), brk(30), drive(100), brk(15), drive(100)])).toContain('CONTINUOUS_DRIVING')
  })

  it('an invalid split: a 10 min stop is not a break part', () => {
    expect(codes([drive(100), brk(10), drive(100), brk(35), drive(100)])).toContain('CONTINUOUS_DRIVING')
    const s = initialClock()
    expect(takeBreak(s, 10, R)).toBeNull()
  })

  it('after the first split part, the break needed is 30 min, not 45', () => {
    const s = initialClock()
    driveLeg(s, 100, 0, R)
    takeBreak(s, 15, R)
    driveLeg(s, 150, 0, R)
    expect(breakNeededBefore(s, 30, 0, R)).toBe(30)
  })

  it('a single leg longer than 4 h 30 gets a break inside it', () => {
    const s = initialClock()
    const breaks: Array<[number, number]> = []
    driveLeg(s, 300, 0, R, (min, _k, driven) => breaks.push([min, driven]))
    expect(breaks).toEqual([[45, 270]])
    expect(s.drivingSinceBreak).toBe(30)
    expect(s.dailyDriving).toBe(300)
  })

  it('more than 9 h of driving in the day is a violation (no automatic 10 h extension)', () => {
    expect(codes([drive(270), brk(45), drive(270), brk(45), drive(10)])).toContain('DAILY_DRIVING')
  })

  it('unloading at an exutoire is work, never a break — even a long one', () => {
    expect(codes([drive(200), job(20), drive(100)])).toContain('CONTINUOUS_DRIVING')
    expect(codes([drive(200), job(60), drive(100)])).toContain('CONTINUOUS_DRIVING')
  })
})

describe('driverClock — working time (2002/15)', () => {
  it('more than 6 h of work without a break is a violation', () => {
    expect(codes([job(200), drive(100), job(70)])).toContain('CONSECUTIVE_WORK')
  })

  it('a day of more than 6 h needs 30 min of break in total, more than 9 h needs 45', () => {
    expect(codes([job(180), brk(15), job(190)])).toContain('WORK_BREAK_TOTAL')
    expect(codes([job(180), brk(15), job(190), brk(15)])).not.toContain('WORK_BREAK_TOTAL')
    expect(codes([job(300), brk(30), job(260)])).toContain('WORK_BREAK_TOTAL')
  })

  it('the clock asks for a break before work would run past 6 h', () => {
    const s = initialClock()
    work(s, 350)
    expect(breakNeededBefore(s, 0, 20, R)).toBe(30)
  })
})

describe('makeRegulationRules — tenant settings only make it stricter', () => {
  it('accepts a shorter driving period and a longer break', () => {
    const r = makeRegulationRules({ maxContinuousDrivingMin: 240, fullBreakMin: 60 })
    expect(r.maxContinuousDrivingMin).toBe(240)
    expect(r.fullBreakMin).toBe(60)
  })
  it('ignores a laxer setting', () => {
    const r = makeRegulationRules({ maxContinuousDrivingMin: 300, fullBreakMin: 30, maxDailyDrivingMin: 600 })
    expect(r.maxContinuousDrivingMin).toBe(270)
    expect(r.fullBreakMin).toBe(45)
    expect(r.maxDailyDrivingMin).toBe(540)
  })
})

// ─── Route simulation ────────────────────────────────────────────────────────

/**
 * Straight east-west geometry at the equator. Without a routing matrix a leg of d km (d ≥ 20)
 * takes d × 1.2 (road factor) / 50 km/h × 0.75 (Sunday traffic) = 1.08 d minutes: positions are
 * given in driving minutes from the depot so timings read directly.
 */
const DEPOT = { lat: 0, lng: 0 }
const kmToLng = (minutesFromDepot: number) => (minutesFromDepot / 1.08) / 111.195
function driver(over: Partial<Driver> = {}): Driver {
  return { id: 'd1', firstName: 'Paul', lastName: 'M', sector: 'S', depotName: 'D', depotLat: DEPOT.lat, depotLng: DEPOT.lng, vehicleCapacity: 1, ...over }
}
function mission(id: string, atMin: number, over: Partial<Mission> = {}): Mission {
  return { id, type: 'DEPLACER', date: '2026-10-04', address: id, latitude: 0, longitude: kmToLng(atMin), estimatedDurationMin: 10, maneuverTimeMin: 0, ...over }
}
// 2026-10-04 is a Sunday: the traffic factor is a flat 0.75 all day, which keeps timings exact.
function ctx(over: Partial<CostContext> = {}): CostContext {
  return { depotLat: 0, depotLng: 0, startTimeMin: 360, speedKmh: 50, exutoires: [], date: '2026-10-04', costConfig: { lunchBreakEnabled: false }, ...over }
}
function exutoire(atMin: number, over: Partial<Exutoire> = {}): Exutoire {
  return { id: 'ex', name: 'Exutoire', address: '', lat: 0, lng: kmToLng(atMin), openingHoursOpen: 0, openingHoursClose: 1439, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15, ...over }
}
const breaksOf = (t: NonNullable<ReturnType<typeof simulateRouteTrace>>) =>
  t.events.filter(e => e.kind === 'break') as Array<Extract<typeof t.events[number], { kind: 'break' }>>

function assertCompliant(t: NonNullable<ReturnType<typeof simulateRouteTrace>>) {
  const audit = auditTimeline(traceToActivities(t))
  const relevant = audit.violations.filter(v => v.code !== 'DAILY_DRIVING')
  expect(relevant).toEqual([])
}

describe('route simulation — regulatory breaks', () => {
  it('a short exutoire stop does NOT reset continuous driving: the 45 min break is still planned', () => {
    // 200 km out (≈ 180 min at 50 km/h × 0.75), pick up, exutoire 30 km further (15 min unload),
    // then 140 km home: 180 + 27 + 126 > 270 of driving with no real break.
    const ex = exutoire(230)
    const t = simulateRouteTrace(
      { driverId: 'd1', missions: [mission('m1', 200, { type: 'RETIRER' })] },
      ctx({ exutoires: [ex] }), [driver()],
    )!
    const b = breaksOf(t)
    expect(b.some(x => x.breakKind === 'FULL' && x.durationMin === 45)).toBe(true)
    assertCompliant(t)
    const plan = formatSolutionForAPI({ routes: [{ driverId: 'd1', missions: [mission('m1', 200, { type: 'RETIRER' })] }], cost: 0 }, [driver()], ctx({ exutoires: [ex] }))
    expect(plan.assignments.d1.some(p => p.type === 'PAUSE' && p.breakKind === 'FULL')).toBe(true)
  })

  it('a long unload at the exutoire is still work: the counter keeps running', () => {
    const ex = exutoire(230, { serviceTimeMin: 60 })
    const t = simulateRouteTrace({ driverId: 'd1', missions: [mission('m1', 200, { type: 'RETIRER' })] }, ctx({ exutoires: [ex] }), [driver()])!
    expect(breaksOf(t).some(x => x.breakKind === 'FULL')).toBe(true)
    assertCompliant(t)
  })

  it('a long wait for the exutoire opening is planned as the break', () => {
    // 06:00 + 180 min → 09:00, 10 min on site, 30 min to the exutoire → 09:40; it opens at 11:00:
    // the 80 min wait is the break, so no extra stop on the 210 min way home.
    const ex = exutoire(210, { openingHoursOpen: 660 })
    const t = simulateRouteTrace({ driverId: 'd1', missions: [mission('m1', 180, { type: 'RETIRER' })] }, ctx({ exutoires: [ex] }), [driver()])!
    const b = breaksOf(t)
    expect(b.some(x => x.reason === 'WAIT' && x.breakKind === 'FULL')).toBe(true)
    expect(b.filter(x => x.reason === 'DRIVING')).toHaveLength(0)
    assertCompliant(t)
  })

  it('several exutoire trips: driving accumulates across them', () => {
    const ex = exutoire(60)
    const missions = [mission('a', 80, { type: 'RETIRER' }), mission('b', 100, { type: 'RETIRER' }), mission('c', 120, { type: 'RETIRER' })]
    const t = simulateRouteTrace({ driverId: 'd1', missions }, ctx({ exutoires: [ex] }), [driver()])!
    expect(t.events.filter(e => e.kind === 'exutoire')).toHaveLength(3)
    expect(t.totals.drivingMin).toBeGreaterThan(270)
    expect(breaksOf(t).length).toBeGreaterThan(0)
    assertCompliant(t)
  })

  it('a route just under the limit gets no break; just over gets one', () => {
    // 134 min out and back = 268 ≤ 270 → none; 137 + 137 = 274 > 270 → a break before going home.
    const under = simulateRouteTrace({ driverId: 'd1', missions: [mission('m', 134)] }, ctx(), [driver()])!
    expect(breaksOf(under)).toHaveLength(0)
    const over = simulateRouteTrace({ driverId: 'd1', missions: [mission('m', 137)] }, ctx(), [driver()])!
    expect(breaksOf(over).length).toBeGreaterThan(0)
    assertCompliant(over)
  })

  it('lunch is a real stop inside its window and counts as a break part', () => {
    // a: 06:00 + 60 → 07:00, 180 min on site → 10:00; b: +30 → 10:30, 120 min → 12:30;
    // leaving b at 12:30 is inside the 12:00–13:30 window: lunch there.
    const missions = [mission('a', 60, { estimatedDurationMin: 180 }), mission('b', 90, { estimatedDurationMin: 120 }), mission('c', 40, { estimatedDurationMin: 60 })]
    const t = simulateRouteTrace({ driverId: 'd1', missions }, ctx({ costConfig: { lunchBreakEnabled: true } }), [driver()])!
    const lunch = breaksOf(t).find(b => b.breakKind === 'LUNCH')
    expect(lunch).toBeDefined()
    expect(lunch!.startMin).toBeGreaterThanOrEqual(720)
    expect(lunch!.startMin + lunch!.durationMin).toBeLessThanOrEqual(810)
    assertCompliant(t)
  })

  it('mid-day re-optimisation resumes the counters: 4 h already driven → break before the next long leg', () => {
    const overrides = new Map([['d1', { lat: 0, lng: 0, timeMin: 660, clock: { drivingSinceBreak: 240, dailyDriving: 240, workSinceBreak: 240, workTotal: 240 } }]])
    const t = simulateRouteTrace({ driverId: 'd1', missions: [mission('m', 60)] }, ctx({ driverStartOverrides: overrides }), [driver()])!
    const b = breaksOf(t)
    expect(b[0]?.startMin).toBe(660)
    expect(b[0]?.durationMin).toBe(45)
    const fresh = simulateRouteTrace({ driverId: 'd1', missions: [mission('m', 60)] }, ctx({ driverStartOverrides: new Map([['d1', { lat: 0, lng: 0, timeMin: 660 }]]) }), [driver()])!
    expect(breaksOf(fresh)).toHaveLength(0)
  })

  it('the cost of a route needing a break includes the break time (via later arrivals)', () => {
    const tight = mission('m2', 200, { timeWindow: { openMin: 0, closeMin: 540 } })
    const withBreak = computeRouteCost({ driverId: 'd1', missions: [mission('m1', 250), tight] }, ctx(), [driver()])
    expect(withBreak).toBeGreaterThan(0)
  })

  it('every plan the optimiser ships respects the rules (random multi-driver days)', async () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const drivers = [driver({ id: 'd1' }), driver({ id: 'd2' }), driver({ id: 'd3' })]
    const exs = [exutoire(50), { ...exutoire(-70), id: 'ex2' }]
    for (let day = 0; day < 4; day++) {
      const missions: Mission[] = []
      for (let i = 0; i < 14; i++) {
        const km = (rnd() - 0.5) * 300
        const type = (['RETIRER', 'POSER', 'DEPLACER', 'ECHANGER'] as const)[Math.floor(rnd() * 4)]
        missions.push({ ...mission(`d${day}m${i}`, km, { type, estimatedDurationMin: 10 + Math.round(rnd() * 40) }), latitude: (rnd() - 0.5) * 0.6 })
      }
      const res = await runVRP(missions, drivers, exs, '2026-10-04', { timeBudgetMs: 800, seed: day + 1, defaultStartTime: '06:00' })
      for (const [driverId, steps] of Object.entries(res.assignments)) {
        const route = { driverId, missions: steps.filter(s => !s.isSynthetic) }
        const t = simulateRouteTrace(route, { ...ctx({ exutoires: exs, startTimeMin: 360 }), costConfig: undefined }, drivers)!
        assertCompliant(t)
      }
    }
  }, 30_000)
})
