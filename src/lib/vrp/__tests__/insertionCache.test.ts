import { describe, it, expect } from 'vitest'
import { InsertionCache, computeFeasibilitySignature, canInsertFast } from '../insertionCache'

describe('InsertionCache', () => {
  it('get returns undefined on miss', () => {
    const c = new InsertionCache()
    expect(c.get(0, 'h1', 'm-1', 0)).toBeUndefined()
  })

  it('set then get returns the cost', () => {
    const c = new InsertionCache()
    c.set(0, 'h1', 'm-1', 0, 42)
    expect(c.get(0, 'h1', 'm-1', 0)).toBe(42)
  })

  it('get returns undefined when routeHash differs', () => {
    const c = new InsertionCache()
    c.set(0, 'h1', 'm-1', 0, 99)
    expect(c.get(0, 'h2', 'm-1', 0)).toBeUndefined()
  })

  it('routeHash returns consistent string for same missions', () => {
    const c = new InsertionCache()
    const missions = [{ id: 'm-1' }, { id: 'm-2' }]
    expect(c.routeHash(missions)).toBe(c.routeHash(missions))
  })

  it('routeHash differs for different mission order', () => {
    const c = new InsertionCache()
    const h1 = c.routeHash([{ id: 'm-1' }, { id: 'm-2' }])
    const h2 = c.routeHash([{ id: 'm-2' }, { id: 'm-1' }])
    expect(h1).not.toBe(h2)
  })

  it('routeHash empty missions returns consistent value', () => {
    const c = new InsertionCache()
    expect(c.routeHash([])).toBe(c.routeHash([]))
  })

  it('clear resets cache and stats', () => {
    const c = new InsertionCache()
    c.set(0, 'h1', 'm-1', 0, 10)
    c.get(0, 'h1', 'm-1', 0)
    c.clear()
    expect(c.stats().size).toBe(0)
    expect(c.stats().hits).toBe(0)
    expect(c.stats().hitRate).toBe('N/A')
  })

  it('stats tracks hits and misses', () => {
    const c = new InsertionCache()
    c.set(0, 'h1', 'm-1', 0, 5)
    c.get(0, 'h1', 'm-1', 0) // hit
    c.get(0, 'h1', 'm-2', 0) // miss
    const s = c.stats()
    expect(s.hits).toBe(1)
    expect(s.misses).toBe(1)
    expect(s.hitRate).toBe('50.0%')
  })

  it('stats hitRate is N/A when no lookups', () => {
    const c = new InsertionCache()
    expect(c.stats().hitRate).toBe('N/A')
  })

  it('invalidateRoute is a no-op (does not throw)', () => {
    const c = new InsertionCache()
    expect(() => c.invalidateRoute(0)).not.toThrow()
  })
})

describe('computeFeasibilitySignature', () => {
  it('computes slackMin and binSlack', () => {
    const sig = computeFeasibilitySignature(300, 5, 480, 4, 2)
    expect(sig.totalWorkMin).toBe(300)
    expect(sig.missionCount).toBe(5)
    expect(sig.slackMin).toBe(180)  // 480 - 300
    expect(sig.binSlack).toBe(2)    // 4 - 2
  })

  it('slackMin is 0 when totalWorkMin equals maxWorkMin', () => {
    const sig = computeFeasibilitySignature(480, 3, 480, 4, 1)
    expect(sig.slackMin).toBe(0)
  })

  it('binSlack is 0 when full', () => {
    const sig = computeFeasibilitySignature(100, 2, 480, 3, 3)
    expect(sig.binSlack).toBe(0)
  })
})

describe('canInsertFast', () => {
  it('returns true when both slack conditions met', () => {
    const sig = computeFeasibilitySignature(100, 2, 480, 4, 1)
    // slackMin = 380, binSlack = 3
    expect(canInsertFast(sig, 30, 1)).toBe(true)
  })

  it('returns false when slackMin < missionDurationMin + 30', () => {
    const sig = computeFeasibilitySignature(450, 2, 480, 4, 1)
    // slackMin = 30, need > 30 + 30 = 60 → false
    expect(canInsertFast(sig, 30, 1)).toBe(false)
  })

  it('returns false when binSlack < missionBins', () => {
    const sig = computeFeasibilitySignature(100, 2, 480, 2, 2)
    // binSlack = 0, missionBins = 1 → false
    expect(canInsertFast(sig, 10, 1)).toBe(false)
  })

  it('uses missionBins default of 1', () => {
    const sig = computeFeasibilitySignature(100, 2, 480, 4, 3)
    // binSlack = 1 >= default 1 → ok; slackMin = 380 >= 10+30 → true
    expect(canInsertFast(sig, 10)).toBe(true)
  })

  it('returns false when binSlack = 0 and default missionBins used', () => {
    const sig = computeFeasibilitySignature(100, 2, 480, 3, 3)
    // binSlack = 0 < 1 → false
    expect(canInsertFast(sig, 10)).toBe(false)
  })
})
