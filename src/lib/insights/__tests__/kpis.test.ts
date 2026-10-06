import { describe, expect, it } from 'vitest'
import { localMinutes, previousPeriod } from '../kpis'

describe('kpis helpers', () => {
  it('reads an arrival in the tenant time zone (summer and winter time)', () => {
    expect(localMinutes('2026-07-01T06:30:00Z', 'Europe/Paris')).toBe(8 * 60 + 30)
    expect(localMinutes('2026-12-01T06:30:00Z', 'Europe/Paris')).toBe(7 * 60 + 30)
    expect(localMinutes('not a date', 'Europe/Paris')).toBeNull()
  })

  it('compares with the period of the same length just before', () => {
    expect(previousPeriod('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    expect(previousPeriod('2026-10-06', '2026-10-06')).toEqual({ from: '2026-10-05', to: '2026-10-05' })
  })
})
