import { describe, it, expect } from 'vitest'
import { planningWeightKg, maxLoadKg, loadIssueAlone } from '../vehicleLoad'
import { simulateRouteTrace } from '../routeCost'
import { runVRP } from '../index'
import { validateAndRepair } from '../explain'
import { estimateWeights } from '@/lib/data/planning'
import type { CostContext } from '../types'
import type { Driver, Exutoire, Mission } from '@/lib/types'

const kmToLng = (km: number) => km / 111.195
function truck(id: string, over: Partial<Driver> = {}): Driver {
  return { id, firstName: id, lastName: '', sector: 'S', depotName: 'D', depotLat: 0, depotLng: 0, vehicleCapacity: 2, ...over }
}
function pickup(id: string, km: number, kg: number | undefined, over: Partial<Mission> = {}): Mission {
  return {
    id, type: 'RETIRER', date: '2026-10-04', address: id, latitude: 0, longitude: kmToLng(km),
    estimatedDurationMin: 10, maneuverTimeMin: 5, ...(kg !== undefined ? { weightKg: kg, weightSource: 'WEIGHED' as const } : {}), ...over,
  }
}
const EX: Exutoire = { id: 'ex', name: 'Centre de tri', address: '', lat: 0, lng: kmToLng(30), openingHoursOpen: 0, openingHoursClose: 1439, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15 }
const ctx = (over: Partial<CostContext> = {}): CostContext => ({ depotLat: 0, depotLng: 0, startTimeMin: 420, speedKmh: 50, exutoires: [EX], date: '2026-10-04', ...over })

/** 26 t truck, 15 t tare → 11 t of load at most. */
const ptac26 = { payload: { gvwKg: 26_000, tareKg: 15_000 } }

describe('vehicleLoad', () => {
  it('planning weight = tare + content + uncertainty; unknown stays unknown', () => {
    expect(planningWeightKg({ weightKg: 5000, weightUncertaintyKg: 1000, binTareKg: 2000 })).toBe(8000)
    expect(planningWeightKg({})).toBeUndefined()
    expect(planningWeightKg({ binTareKg: 1800 })).toBe(1800)
  })

  it('max load is min(payload, PTAC − tare); no figures = no limit', () => {
    expect(maxLoadKg(truck('a', ptac26))).toBe(11_000)
    expect(maxLoadKg(truck('a', { payload: { gvwKg: 26_000, tareKg: 15_000, maxPayloadKg: 9_000 } }))).toBe(9_000)
    expect(maxLoadKg(truck('a'))).toBe(Infinity)
  })

  it('a bin heavier than the truck may carry is flagged alone', () => {
    expect(loadIssueAlone(pickup('m', 10, 12_000), truck('a', ptac26))).toBe('PAYLOAD')
    expect(loadIssueAlone(pickup('m', 10, 9_000), truck('a', ptac26))).toBeNull()
    expect(loadIssueAlone(pickup('m', 10, undefined), truck('a', ptac26))).toBeNull()
  })
})

describe('load along the route', () => {
  it('two 6 t bins on an 11 t truck: unload between the pickups, never overloaded', () => {
    const t = simulateRouteTrace({ driverId: 'a', missions: [pickup('m1', 10, 6000), pickup('m2', 15, 6000)] }, ctx(), [truck('a', ptac26)])!
    const exTrips = t.events.filter(e => e.kind === 'exutoire') as Array<Extract<typeof t.events[number], { kind: 'exutoire' }>>
    expect(exTrips[0].beforePickup).toBe(true)
    expect(exTrips[0].forMissionId).toBe('m2')
    expect(t.totals.maxLoadKg).toBeLessThanOrEqual(11_000)
    expect(t.violations.filter(v => v.hard)).toEqual([])
  })

  it('without weights, the same two bins ride together (bin slots only)', () => {
    const t = simulateRouteTrace({ driverId: 'a', missions: [pickup('m1', 10, undefined), pickup('m2', 15, undefined)] }, ctx(), [truck('a', ptac26)])!
    expect(t.events.filter(e => e.kind === 'exutoire')).toHaveLength(1)
  })

  it('the exutoire empties the truck: load goes back to zero', () => {
    const t = simulateRouteTrace({ driverId: 'a', missions: [pickup('m1', 10, 4000), pickup('m2', 15, 4000)] }, ctx(), [truck('a', { ...ptac26, vehicleCapacity: 1 })])!
    const exTrips = t.events.filter(e => e.kind === 'exutoire') as Array<Extract<typeof t.events[number], { kind: 'exutoire' }>>
    expect(exTrips.map(e => e.unloadedKg)).toEqual([4000, 4000])
  })

  it('an ALLER_RETOUR bin too heavy for the truck is a hard violation', () => {
    const t = simulateRouteTrace({ driverId: 'a', missions: [pickup('m', 10, 13_000, { type: 'ALLER_RETOUR' })] }, ctx(), [truck('a', ptac26)])!
    expect(t.violations.some(v => v.code === 'PAYLOAD' && v.hard)).toBe(true)
  })
})

describe('optimiser — PTAC impossible → unassigned with the right explanation', () => {
  it('no truck can carry it: unassigned, reason PAYLOAD', async () => {
    const res = await runVRP([pickup('heavy', 10, 14_000), pickup('ok', 12, 3000)], [truck('a', ptac26)], [EX], '2026-10-04', { timeBudgetMs: 300 })
    expect(res.unassignedMissions.map(m => m.id)).toEqual(['heavy'])
    expect(res.unassignedReasons?.heavy.code).toBe('PAYLOAD')
    expect(res.unassignedReasons?.heavy.message).toMatch(/charge utile/)
    expect(res.assignments.a.some(p => p.id === 'ok')).toBe(true)
  })

  it('a bigger truck exists: the heavy bin goes to it', async () => {
    const big = truck('big', { payload: { gvwKg: 32_000, tareKg: 14_000 } })
    const res = await runVRP([pickup('heavy', 10, 14_000)], [truck('a', ptac26), big], [EX], '2026-10-04', { timeBudgetMs: 300 })
    expect(res.unassignedMissions).toEqual([])
    expect(res.assignments.big?.some(p => p.id === 'heavy')).toBe(true)
  })

  it('validation takes a misplaced heavy bin out and re-inserts it in a truck that can carry it', () => {
    const big = truck('big', { payload: { gvwKg: 32_000, tareKg: 14_000 } })
    const sol = { routes: [{ driverId: 'a', missions: [pickup('heavy', 10, 14_000)] }, { driverId: 'big', missions: [] }], cost: 0 }
    const { solution, removed } = validateAndRepair(sol, [truck('a', ptac26), big], ctx())
    expect(removed.size).toBe(0)
    expect(solution.routes.find(r => r.driverId === 'big')!.missions.map(m => m.id)).toEqual(['heavy'])
  })

  it('missing skill and oversized bin are explained too', async () => {
    const res = await runVRP(
      [pickup('grue', 10, undefined, { requiredSkills: ['grue'] }), pickup('xl', 12, undefined, { binSizeM3: 30 })],
      [truck('a', { maxBinSizeM3: 20 })], [EX], '2026-10-04', { timeBudgetMs: 300 },
    )
    expect(res.unassignedReasons?.grue.code).toBe('SKILL')
    expect(res.unassignedReasons?.xl.code).toBe('BIN_SIZE')
  })

  it('a day over 9 h of driving drops a mission and says why', async () => {
    // Four missions 250 km apart from each other and from the depot: far more than 9 h of driving.
    const far = [0, 1, 2, 3].map(i => pickup(`f${i}`, 250 * (i % 2 === 0 ? 1 : -1) * (1 + i * 0.1), undefined, { type: 'DEPLACER' }))
    const res = await runVRP(far, [truck('a')], [EX], '2026-10-04', { timeBudgetMs: 400 })
    expect(res.unassignedMissions.length).toBeGreaterThan(0)
    const codes = res.unassignedMissions.map(m => res.unassignedReasons?.[m.id].code)
    expect(codes.every(c => c === 'DRIVING_TIME' || c === 'WORK_TIME')).toBe(true)
  })
})

describe('weight estimates from the material', () => {
  const materials = [{ id: 'mat-gravats', name: 'Gravats', densityKgM3: 1500, fillFactor: 0.8, uncertaintyPct: 0.25 }]
  it('density × volume × fill, with its uncertainty, marked ESTIMATED', () => {
    const [m] = estimateWeights([pickup('m', 10, undefined, { binSizeM3: 10, wasteTypeLabel: 'gravats' })], materials)
    expect(m.weightKg).toBe(12_000)
    expect(m.weightUncertaintyKg).toBe(3000)
    expect(m.weightSource).toBe('ESTIMATED')
  })
  it('never overrides a weighed value, never invents without density or volume', () => {
    const weighed = pickup('w', 10, 4000, { binSizeM3: 10, wasteTypeLabel: 'Gravats' })
    expect(estimateWeights([weighed], materials)[0].weightKg).toBe(4000)
    expect(estimateWeights([pickup('n', 10, undefined, { wasteTypeLabel: 'Gravats' })], materials)[0].weightKg).toBeUndefined()
    expect(estimateWeights([pickup('u', 10, undefined, { binSizeM3: 10, wasteTypeLabel: 'Bois' })], materials)[0].weightKg).toBeUndefined()
  })
})
