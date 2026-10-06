import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

import { enforceMissionConservation, runVRP } from '../index'
import { buildInitialSolution } from '../formatSolution'
import { computeRouteCost } from '../routeCost'
import type { CostContext } from '../types'
import type { Mission, OptimizationResult, PlannedMission, Driver } from '@/lib/types'

const m = (id: string, lat = 45.75, lng = 4.85): Mission => ({
  id, type: 'POSER', date: '2026-10-05', address: id, latitude: lat, longitude: lng, estimatedDurationMin: 10, maneuverTimeMin: 5,
})
const pm = (id: string, seq: number, synthetic = false): PlannedMission => ({ ...m(id), sequenceOrder: seq, ...(synthetic ? { isSynthetic: true, type: 'VIDER' as const } : {}) })

function result(assignments: Record<string, PlannedMission[]>, unassigned: Mission[] = []): OptimizationResult {
  return { assignments, unassignedMissions: unassigned, stats: { assignedMissions: 0, totalMissions: 0, score: 0, timeTakenMs: 0 }, warnings: [] } as OptimizationResult
}

describe('enforceMissionConservation', () => {
  it('returns a mission missing from every route as unassigned, with a warning', () => {
    const r = result({ d1: [pm('a', 0)] })
    enforceMissionConservation(r, [m('a'), m('b')])
    expect(r.unassignedMissions.map(x => x.id)).toEqual(['b'])
    expect(r.warnings.some(w => /pas pu être placées/.test(w.message))).toBe(true)
    expect(r.stats).toMatchObject({ totalMissions: 2, assignedMissions: 1 })
  })

  it('removes a mission planned in two routes (keeps the first)', () => {
    const r = result({ d1: [pm('a', 0)], d2: [pm('a', 0), pm('b', 1)] })
    enforceMissionConservation(r, [m('a'), m('b')])
    expect(r.assignments.d2.map(x => x.id)).toEqual(['b'])
    expect(r.warnings.some(w => /doublon/.test(w.message))).toBe(true)
  })

  it('never touches synthetic steps and drops an unassigned entry that is actually planned', () => {
    const r = result({ d1: [pm('a', 0), pm('vider-1', 1, true), pm('vider-1', 2, true)] }, [m('a')])
    enforceMissionConservation(r, [m('a')])
    expect(r.assignments.d1).toHaveLength(3)
    expect(r.unassignedMissions).toEqual([])
  })
})

describe('runVRP end to end — every mission accounted for exactly once', () => {
  const drivers: Driver[] = [1, 2, 3].map(i => ({ id: `d${i}`, firstName: 'D', lastName: String(i), sector: 'S', depotName: 'Dépôt', depotLat: 45.75, depotLng: 4.85 }))

  it('with duplicate ids and random points', async () => {
    const missions: Mission[] = []
    for (let i = 0; i < 25; i++) missions.push(m(`m${i}`, 45.7 + (i % 5) * 0.02, 4.8 + Math.floor(i / 5) * 0.02))
    missions.push(m('m3')) // duplicate id
    const out = await runVRP(missions, drivers, [], '2026-10-05', { timeBudgetMs: 1500, seed: 7 })
    const planned = Object.values(out.assignments).flat().filter(x => !x.isSynthetic).map(x => x.id)
    const all = [...planned, ...out.unassignedMissions.map(x => x.id)].sort()
    expect(all).toEqual([...new Set(missions.map(x => x.id))].sort())
    expect(out.stats.totalMissions).toBe(25)
    expect(out.warnings.some(w => /en double/.test(w.message))).toBe(true)
  })
})

describe('HFVRP — a bin never ends up on a truck that cannot carry it', () => {
  const small: Driver = { id: 'small', firstName: 'S', lastName: 'S', sector: 'S', depotName: 'Dépôt', depotLat: 45.75, depotLng: 4.85, maxBinSizeM3: 10 }
  const big: Driver   = { id: 'big', firstName: 'B', lastName: 'B', sector: 'S', depotName: 'Dépôt', depotLat: 45.75, depotLng: 4.85, maxBinSizeM3: 30 }

  it('the warm start does not seed a 30 m³ bin onto a 10 m³ truck', () => {
    const missions = [{ ...m('huge', 45.76, 4.86), binSizeM3: 30 }, m('a', 45.74, 4.84)]
    const ctx: CostContext = { depotLat: 45.75, depotLng: 4.85, startTimeMin: 420, speedKmh: 50, exutoires: [], date: '2026-10-05' }
    const init = buildInitialSolution(missions, [small, big], ctx, { small: ['huge', 'a'] })
    expect(init.routes.find(r => r.driverId === 'small')!.missions.map(x => x.id)).toEqual(['a'])
    expect(init.routes.find(r => r.driverId === 'big')!.missions.map(x => x.id)).toEqual(['huge'])
  })

  it('the route cost prices an incompatible bin like a capacity violation', () => {
    const ctx: CostContext = { depotLat: 45.75, depotLng: 4.85, startTimeMin: 420, speedKmh: 50, exutoires: [], date: '2026-10-05' }
    const huge = { ...m('huge', 45.76, 4.86), binSizeM3: 30 }
    const onSmall = computeRouteCost({ driverId: 'small', missions: [huge] }, ctx, [small, big])
    const onBig   = computeRouteCost({ driverId: 'big', missions: [huge] }, ctx, [small, big])
    expect(onSmall - onBig).toBeGreaterThanOrEqual(50_000)
  })

  it('the output guard unassigns an incompatible placement with an error warning', () => {
    const r = result({ small: [{ ...pm('huge', 0), binSizeM3: 30 }] })
    enforceMissionConservation(r, [{ ...m('huge'), binSizeM3: 30 }], [], [small])
    expect(r.assignments.small).toEqual([])
    expect(r.unassignedMissions.map(x => x.id)).toEqual(['huge'])
    expect(r.warnings.some(w => w.severity === 'error' && /trop grande/.test(w.message))).toBe(true)
  })
})
