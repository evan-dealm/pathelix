import { describe, it, expect, vi, afterEach } from 'vitest'
import { today } from '@/lib/dateUtils'

describe('today() — format', () => {
  it('returns a string', () => {
    expect(typeof today()).toBe('string')
  })

  it('has length of exactly 10', () => {
    expect(today()).toHaveLength(10)
  })

  it('matches YYYY-MM-DD regex', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('contains two hyphens at positions 4 and 7', () => {
    const result = today()
    expect(result[4]).toBe('-')
    expect(result[7]).toBe('-')
  })

  it('year part is a 4-digit number >= 2024', () => {
    const year = parseInt(today().split('-')[0], 10)
    expect(year).toBeGreaterThanOrEqual(2024)
    expect(year.toString()).toHaveLength(4)
  })

  it('month part is between 01 and 12', () => {
    const month = parseInt(today().split('-')[1], 10)
    expect(month).toBeGreaterThanOrEqual(1)
    expect(month).toBeLessThanOrEqual(12)
  })

  it('month part is zero-padded (2 chars)', () => {
    const monthStr = today().split('-')[1]
    expect(monthStr).toHaveLength(2)
  })

  it('day part is between 01 and 31', () => {
    const day = parseInt(today().split('-')[2], 10)
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(31)
  })

  it('day part is zero-padded (2 chars)', () => {
    const dayStr = today().split('-')[2]
    expect(dayStr).toHaveLength(2)
  })

  it('return value is a valid ISO date parseable by new Date()', () => {
    const result = today()
    const parsed = new Date(result)
    expect(parsed.getTime()).not.toBeNaN()
  })

  it('parsed Date is not Invalid Date', () => {
    const result = today()
    expect(new Date(result).toString()).not.toBe('Invalid Date')
  })
})

describe('today() — returns current date', () => {
  it('returns the current date (matches new Date() ISO date)', () => {
    const before = new Date().toISOString().split('T')[0]
    const result = today()
    const after = new Date().toISOString().split('T')[0]

    expect([before, after]).toContain(result)
  })

  it('multiple calls within same second return same value', () => {
    const a = today()
    const b = today()
    const c = today()
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('result can be split into 3 parts by hyphen', () => {
    const parts = today().split('-')
    expect(parts).toHaveLength(3)
  })

  it('year extracted from result is a valid year (parsed integer)', () => {
    const yearStr = today().split('-')[0]
    const year = parseInt(yearStr, 10)
    expect(Number.isInteger(year)).toBe(true)
    expect(year).toBeGreaterThan(0)
  })

  it('month extracted from result is a valid month integer', () => {
    const monthStr = today().split('-')[1]
    const month = parseInt(monthStr, 10)
    expect(Number.isInteger(month)).toBe(true)
  })

  it('day extracted from result is a valid day integer', () => {
    const dayStr = today().split('-')[2]
    const day = parseInt(dayStr, 10)
    expect(Number.isInteger(day)).toBe(true)
  })
})

describe('today() — with fake timers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 2024-12-25 when fake date is Christmas 2024', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-12-25T10:00:00.000Z'))
    expect(today()).toBe('2024-12-25')
  })

  it('returns 2025-01-01 for first day of year 2025', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
    expect(today()).toBe('2025-01-01')
  })

  it('returns 2025-12-31 for last day of year 2025', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-12-31T23:59:59.000Z'))
    expect(today()).toBe('2025-12-31')
  })

  it('returns 2024-02-29 for leap day 2024', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-02-29T12:00:00.000Z'))
    expect(today()).toBe('2024-02-29')
  })

  it('returns 2026-03-24 for a specific project date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-24T08:30:00.000Z'))
    expect(today()).toBe('2026-03-24')
  })

  it('returns 2024-01-01 for first day of leap year 2024', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    expect(today()).toBe('2024-01-01')
  })

  it('result with fake timer matches YYYY-MM-DD regex', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-07-04T15:00:00.000Z'))
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('result with fake timer has correct length of 10', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-11-05T09:00:00.000Z'))
    expect(today()).toHaveLength(10)
  })

  it('returns 2025-06-01 for June 1st 2025', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-01T06:00:00.000Z'))
    expect(today()).toBe('2025-06-01')
  })

  it('returns 2024-10-31 for Halloween 2024', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-10-31T18:00:00.000Z'))
    expect(today()).toBe('2024-10-31')
  })
})
