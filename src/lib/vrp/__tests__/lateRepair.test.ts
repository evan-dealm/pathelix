import { describe, expect, it } from 'vitest'
import { validateAndRepair, LATE_TOLERANCE_MIN } from '../explain'
import { simulateRouteTrace } from '../routeCost'
import type { CostContext } from '../types'
import type { Driver, Exutoire, Mission } from '@/lib/types'

const kmToLng = (km: number) => km / 111.195
const truck: Driver = { id: 'd', firstName: 'd', lastName: '', sector: 'S', depotName: 'D', depotLat: 0, depotLng: 0, vehicleCapacity: 3 }
const EX: Exutoire = { id: 'ex', name: 'Tri', address: '', lat: 0, lng: kmToLng(4), openingHoursOpen: 0, openingHoursClose: 1439, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15 }
const ctx: CostContext = { depotLat: 0, depotLng: 0, startTimeMin: 420, speedKmh: 50, exutoires: [EX], date: '2026-10-07' }
const pose = (id: string, km: number, dur: number, over: Partial<Mission> = {}): Mission =>
  ({ id, type: 'POSER', date: '2026-10-07', address: id, latitude: 0, longitude: kmToLng(km), estimatedDurationMin: dur, maneuverTimeMin: 0, ...over })

describe('validateAndRepair — customer windows', () => {
  it('never leaves a visit far past its window: moved where it is on time, or out with the reason', () => {
    // two 2-hour jobs first: the third would arrive around 11:00 for a window closing at 08:30
    const late = pose('late', 3, 15, { timeWindow: { openMin: 420, closeMin: 510 } })
    const sol = { routes: [{ driverId: 'd', missions: [pose('a', 1, 120), pose('b', 2, 120), late] }], cost: 0 }
    const { solution, removed } = validateAndRepair(sol, [truck], ctx)
    const t = simulateRouteTrace(solution.routes[0], ctx, [truck])!
    expect(t.violations.filter(v => v.code === 'TIME_WINDOW' && (v.amount ?? 0) > LATE_TOLERANCE_MIN)).toEqual([])
    expect(removed.has('late') ? removed.get('late')!.code : solution.routes[0].missions[0].id).toBe(removed.has('late') ? 'TIME_WINDOW' : 'late')
  })

  it('takes it out when no position keeps the window', () => {
    // window already closed when the day starts
    const late = pose('late', 30, 15, { timeWindow: { openMin: 300, closeMin: 360 } })
    const sol = { routes: [{ driverId: 'd', missions: [pose('a', 1, 20), late] }], cost: 0 }
    const { solution, removed } = validateAndRepair(sol, [truck], ctx)
    expect(removed.get('late')?.code).toBe('TIME_WINDOW')
    expect(solution.routes[0].missions.map(m => m.id)).toEqual(['a'])
  })

  it(`keeps a visit a few minutes late (≤ ${LATE_TOLERANCE_MIN} min)`, () => {
    const slightly = pose('slightly', 3, 15, { timeWindow: { openMin: 420, closeMin: 420 + 120 + 120 - 10 } })
    const sol = { routes: [{ driverId: 'd', missions: [pose('a', 1, 120), pose('b', 2, 120), slightly] }], cost: 0 }
    expect(validateAndRepair(sol, [truck], ctx).removed.has('slightly')).toBe(false)
  })

  it('never takes out an emergency (P1) for lateness', () => {
    const p1 = pose('p1', 3, 15, { priority: 1, timeWindow: { openMin: 420, closeMin: 510 } })
    const sol = { routes: [{ driverId: 'd', missions: [pose('a', 1, 120), pose('b', 2, 120), p1] }], cost: 0 }
    expect(validateAndRepair(sol, [truck], ctx).removed.has('p1')).toBe(false)
  })
})
