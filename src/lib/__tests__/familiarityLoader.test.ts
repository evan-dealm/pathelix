import { describe, it, expect } from 'vitest'
import { getFamiliarityBonus } from '../familiarityLoader'
import type { FamiliarityMap } from '@/lib/vrp/types'

function makeMap(entries: Array<[string, number]>): FamiliarityMap {
  return new Map(entries)
}

describe('getFamiliarityBonus', () => {
  it('returns 0 when familiarity map is undefined', () => {
    expect(getFamiliarityBonus(undefined, 'd-1', 'site-1', 1.0)).toBe(0)
  })

  it('returns 0 when siteId is undefined', () => {
    const map = makeMap([['d-1:site-1', 10]])
    expect(getFamiliarityBonus(map, 'd-1', undefined, 1.0)).toBe(0)
  })

  it('returns 0 when siteId is null', () => {
    const map = makeMap([['d-1:site-1', 10]])
    expect(getFamiliarityBonus(map, 'd-1', null, 1.0)).toBe(0)
  })

  it('returns 0 when stabilityWeight is 0', () => {
    const map = makeMap([['d-1:site-1', 20]])
    expect(getFamiliarityBonus(map, 'd-1', 'site-1', 0)).toBe(0)
  })

  it('returns 0 when visits < 5', () => {
    const map = makeMap([['d-1:site-1', 4]])
    expect(getFamiliarityBonus(map, 'd-1', 'site-1', 1.0)).toBe(0)
  })

  it('returns 0 when driver-site pair not in map', () => {
    const map = makeMap([['d-2:site-1', 10]])
    expect(getFamiliarityBonus(map, 'd-1', 'site-1', 1.0)).toBe(0)
  })

  it('returns negative bonus when visits >= 5', () => {
    const map = makeMap([['d-1:site-1', 10]])
    const bonus = getFamiliarityBonus(map, 'd-1', 'site-1', 1.0)
    expect(bonus).toBeLessThan(0)
  })

  it('bonus magnitude increases with visits', () => {
    const map10 = makeMap([['d-1:site-1', 10]])
    const map50 = makeMap([['d-1:site-1', 50]])
    const b10 = getFamiliarityBonus(map10, 'd-1', 'site-1', 1.0)
    const b50 = getFamiliarityBonus(map50, 'd-1', 'site-1', 1.0)
    expect(b50).toBeLessThan(b10) // more negative = bigger bonus magnitude
  })

  it('bonus is capped at -maxBonus * stabilityWeight', () => {
    const map = makeMap([['d-1:site-1', 1_000_000]])
    const bonus = getFamiliarityBonus(map, 'd-1', 'site-1', 1.0)
    expect(bonus).toBeGreaterThanOrEqual(-15) // maxBonus = 15
  })

  it('stabilityWeight scales the bonus', () => {
    const map = makeMap([['d-1:site-1', 20]])
    const b1 = getFamiliarityBonus(map, 'd-1', 'site-1', 0.5)
    const b2 = getFamiliarityBonus(map, 'd-1', 'site-1', 1.0)
    expect(b1).toBeCloseTo(b2 / 2, 5)
  })

  it('stabilityWeight < 0 returns 0', () => {
    const map = makeMap([['d-1:site-1', 20]])
    expect(getFamiliarityBonus(map, 'd-1', 'site-1', -0.1)).toBe(0)
  })
})
