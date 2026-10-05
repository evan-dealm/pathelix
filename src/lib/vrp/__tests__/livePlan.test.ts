import { describe, it, expect } from 'vitest'
import { isLocked, lockedSteps, mergeLockedAndOptimized, nowMinutesInTimeZone, parsePlanMissions } from '../livePlan'
import type { PlannedMission } from '@/lib/types'

const pm = (id: string, seq: number): PlannedMission => ({
  id, sequenceOrder: seq, type: 'POSER', date: '2026-10-05', address: id, latitude: 45, longitude: 5,
  estimatedDurationMin: 10, maneuverTimeMin: 5,
})

describe('livePlan', () => {
  it('locks every step the driver acted on, including "en route"', () => {
    expect(isLocked({ status: 'en_route' })).toBe(true)
    expect(isLocked({ status: 'done' })).toBe(true)
    expect(isLocked({ status: 'todo' })).toBe(false)
    expect(isLocked(undefined)).toBe(false)
  })

  it('keeps locked steps in their original order and puts the re-optimised rest after them', () => {
    const plan = [pm('a', 0), pm('b', 1), pm('c', 2)]
    const locked = lockedSteps(plan, { b: { status: 'done' }, a: { status: 'arrived' } })
    expect(locked.map(m => m.id)).toEqual(['a', 'b'])
    const merged = mergeLockedAndOptimized(locked, [pm('d', 0), pm('c', 1), pm('b', 2)])
    expect(merged.map(m => m.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(merged.map(m => m.sequenceOrder)).toEqual([0, 1, 2, 3])
  })

  it('reads plan JSON stored as array or string', () => {
    expect(parsePlanMissions([pm('a', 0)])).toHaveLength(1)
    expect(parsePlanMissions(JSON.stringify([pm('a', 0)]))).toHaveLength(1)
    expect(parsePlanMissions('not json')).toEqual([])
  })

  it('computes "now" in the tenant time zone, not the UTC server clock', () => {
    const t = new Date('2026-07-01T10:30:00Z')
    expect(nowMinutesInTimeZone('Europe/Paris', t)).toBe(12 * 60 + 30) // CEST = UTC+2
    expect(nowMinutesInTimeZone('UTC', t)).toBe(10 * 60 + 30)
  })
})
