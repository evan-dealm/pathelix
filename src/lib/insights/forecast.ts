/**
 * Daily volume forecast — plain statistics, no "AI": for each weekday, the average of the same
 * weekday over the last weeks, with an 80 % interval from their spread. Its accuracy is measured
 * on the recent past (rolling backtest) and shown with the forecast, so nobody takes it for more
 * than it is. Missions already booked for a day are a floor: the forecast never shows less.
 */

export interface DayCount { date: string; count: number }
export interface ForecastDay { date: string; expected: number; low: number; high: number; booked: number }
export interface Forecast {
  days: ForecastDay[]
  /** Mean absolute error (missions/day) of the same method on the last weeks — null if too little history. */
  mae: number | null
  /** Mean absolute percentage error on days that had work. */
  mape: number | null
  weeksOfHistory: number
  /** Why there is no forecast (French), when there is none. */
  reason?: string
}

const Z80 = 1.2816
const DAY_MS = 86_400_000
const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`)
const addDays = (iso: string, n: number) => new Date(toDate(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10)

/** Weekday statistics from the `weeks` weeks before `day` (exclusive). */
function predictDay(counts: Map<string, number>, day: string, weeks: number): { mean: number; sd: number; n: number } {
  const values: number[] = []
  for (let w = 1; w <= weeks; w++) {
    const d = addDays(day, -7 * w)
    values.push(counts.get(d) ?? 0)
  }
  const n = values.length
  const mean = values.reduce((a, v) => a + v, 0) / n
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { mean, sd, n }
}

/**
 * @param history missions per day (any order), up to `today` excluded
 * @param booked  missions already on the books for future days
 */
export function forecastVolume(history: DayCount[], booked: DayCount[], today: string, horizonDays = 14, weeks = 8): Forecast {
  const counts = new Map(history.map(h => [h.date, h.count]))
  const first = history.filter(h => h.count > 0).map(h => h.date).sort()[0]
  const weeksOfHistory = first ? Math.floor((toDate(today).getTime() - toDate(first).getTime()) / (7 * DAY_MS)) : 0
  if (weeksOfHistory < 4) {
    return { days: [], mae: null, mape: null, weeksOfHistory, reason: `Historique insuffisant (${weeksOfHistory} semaine${weeksOfHistory > 1 ? 's' : ''} ; 4 au minimum)` }
  }
  const w = Math.min(weeks, weeksOfHistory)

  // Rolling backtest over the last 4 weeks: each day predicted from the weeks before it only.
  const errors: number[] = []
  const pctErrors: number[] = []
  for (let i = 28; i >= 1; i--) {
    const d = addDays(today, -i)
    const back = Math.min(w, Math.floor((toDate(d).getTime() - toDate(first).getTime()) / (7 * DAY_MS)))
    if (back < 2) continue
    const p = predictDay(counts, d, back).mean
    const actual = counts.get(d) ?? 0
    errors.push(Math.abs(p - actual))
    if (actual > 0) pctErrors.push(Math.abs(p - actual) / actual)
  }

  const bookedMap = new Map(booked.map(b => [b.date, b.count]))
  const days: ForecastDay[] = []
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(today, i)
    const { mean, sd } = predictDay(counts, d, w)
    const b = bookedMap.get(d) ?? 0
    const expected = Math.max(b, Math.round(mean))
    days.push({ date: d, booked: b, expected, low: Math.max(b, Math.floor(mean - Z80 * sd)), high: Math.max(b, Math.ceil(mean + Z80 * sd)) })
  }
  const r1 = (n: number) => Math.round(n * 10) / 10
  return {
    days,
    mae: errors.length ? r1(errors.reduce((a, v) => a + v, 0) / errors.length) : null,
    mape: pctErrors.length ? Math.round(pctErrors.reduce((a, v) => a + v, 0) / pctErrors.length * 100) : null,
    weeksOfHistory,
  }
}
