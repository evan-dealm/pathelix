import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

import { enforceMissionConservation, runVRP } from '../index'
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
