import { describe, expect, it } from 'vitest'
import { forecastVolume, type DayCount } from '../forecast'

const TODAY = '2026-10-06' // Tuesday
function history(weeks: number, perWeekday: (dow: number, week: number) => number): DayCount[] {
  const out: DayCount[] = []
  for (let i = weeks * 7; i >= 1; i--) {
    const d = new Date(Date.parse(`${TODAY}T12:00:00Z`) - i * 86_400_000)
    out.push({ date: d.toISOString().slice(0, 10), count: perWeekday(d.getUTCDay(), Math.floor(i / 7)) })
  }
  return out
}

describe('forecastVolume', () => {
  it('refuses to forecast without 4 weeks of history, and says why', () => {
    const f = forecastVolume(history(2, () => 5), [], TODAY)
    expect(f.days).toEqual([])
    expect(f.reason).toMatch(/Historique insuffisant/)
  })

  it('learns the weekly pattern and is exact on a perfectly regular history', () => {
    const f = forecastVolume(history(10, dow => (dow === 0 ? 0 : dow === 1 ? 12 : 8)), [], TODAY)
    const monday = f.days.find(d => new Date(`${d.date}T12:00:00Z`).getUTCDay() === 1)!
    const sunday = f.days.find(d => new Date(`${d.date}T12:00:00Z`).getUTCDay() === 0)!
    expect(monday).toMatchObject({ expected: 12, low: 12, high: 12 })
    expect(sunday.expected).toBe(0)
    expect(f.mae).toBe(0)
    expect(f.mape).toBe(0)
  })

  it('widens the interval when the history is noisy, and reports its measured error', () => {
    const f = forecastVolume(history(10, (dow, week) => (dow === 0 ? 0 : week % 2 ? 4 : 12)), [], TODAY)
    const d = f.days.find(x => x.expected > 0)!
    expect(d.high - d.low).toBeGreaterThanOrEqual(8)
    expect(f.mae).toBeGreaterThan(0)
  })

  it('never shows less than what is already booked', () => {
    const f = forecastVolume(history(10, () => 3), [{ date: TODAY, count: 9 }], TODAY)
    expect(f.days[0]).toMatchObject({ booked: 9, expected: 9, low: 9 })
  })
})
