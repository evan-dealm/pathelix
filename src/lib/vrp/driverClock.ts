/**
 * Regulatory clock of one driver-day.
 *
 * Driving rules — Regulation (EC) 561/2006:
 *  - Art. 7: after 4 h 30 of driving, a break of at least 45 min, unless the driver starts a rest.
 *    The break may be split into a first part of at least 15 min followed by a second part of at
 *    least 30 min, both taken within the 4 h 30 period. A part shorter than 15 min is not a break.
 *  - Art. 6.1: daily driving at most 9 h (extendable to 10 h twice a week — never planned
 *    automatically here; the weekly count is not known to a one-day plan).
 *
 * Working-time breaks — Directive 2002/15/EC Art. 5 (Code des transports L3312-2 in France):
 *  - never more than 6 consecutive hours of work without a break;
 *  - at least 30 min of break when the day's work is between 6 h and 9 h, 45 min above 9 h;
 *  - breaks may be split into periods of at least 15 min.
 *
 * Only breaks count. Unloading at an exutoire, service on site, loading or manoeuvring are work;
 * a wait counts as a break only when the planner explicitly schedules it as one (the plan then
 * shows a PAUSE step there) and it lasts at least 15 min. Breaks taken for one rule count for the
 * other (a 45 min break satisfies both).
 */

export interface RegulationRules {
  /** Art. 7 — maximum driving before a qualifying break (min). */
  maxContinuousDrivingMin: number
  /** Art. 7 — uninterrupted break that resets the driving counter (min). */
  fullBreakMin: number
  /** Art. 7 — split break: first part (min). */
  splitFirstMin: number
  /** Art. 7 — split break: second part (min), must follow the first part. */
  splitSecondMin: number
  /** Art. 6.1 — daily driving limit used for planning (min). */
  maxDailyDrivingMin: number
  /** 2002/15 Art. 5 — maximum consecutive work without a break (min). */
  maxWorkBeforeBreakMin: number
  /** 2002/15 Art. 5 — total break required when daily work exceeds 6 h (min). */
  workBreakOver6hMin: number
  /** 2002/15 Art. 5 — total break required when daily work exceeds 9 h (min). */
  workBreakOver9hMin: number
  /** Shortest period that counts as a break for either rule (min). */
  minBreakPartMin: number
  /** A wait of at least `minBreakPartMin` before a time window may be planned as a break. */
  breakDuringWait: boolean
}

export const DEFAULT_REGULATION: RegulationRules = {
  maxContinuousDrivingMin: 270,
  fullBreakMin:            45,
  splitFirstMin:           15,
  splitSecondMin:          30,
  maxDailyDrivingMin:      540,
  maxWorkBeforeBreakMin:   360,
  workBreakOver6hMin:      30,
  workBreakOver9hMin:      45,
  minBreakPartMin:         15,
  breakDuringWait:         true,
}

/**
 * Tenant settings may only make the rules stricter: a shorter driving period or a longer break.
 * Values outside the legal bounds fall back to the regulation.
 */
export function makeRegulationRules(overrides?: Partial<RegulationRules>): RegulationRules {
  if (!overrides) return DEFAULT_REGULATION
  const d = DEFAULT_REGULATION
  const pick = (v: number | undefined, def: number, stricter: (_v: number) => boolean) =>
    typeof v === 'number' && Number.isFinite(v) && stricter(v) ? v : def
  return {
    maxContinuousDrivingMin: pick(overrides.maxContinuousDrivingMin, d.maxContinuousDrivingMin, v => v >= 60 && v <= d.maxContinuousDrivingMin),
    fullBreakMin:            pick(overrides.fullBreakMin,            d.fullBreakMin,            v => v >= d.fullBreakMin && v <= 180),
    splitFirstMin:           d.splitFirstMin,
    splitSecondMin:          d.splitSecondMin,
    maxDailyDrivingMin:      pick(overrides.maxDailyDrivingMin,      d.maxDailyDrivingMin,      v => v >= 60 && v <= d.maxDailyDrivingMin),
    maxWorkBeforeBreakMin:   pick(overrides.maxWorkBeforeBreakMin,   d.maxWorkBeforeBreakMin,   v => v >= 60 && v <= d.maxWorkBeforeBreakMin),
    workBreakOver6hMin:      d.workBreakOver6hMin,
    workBreakOver9hMin:      d.workBreakOver9hMin,
    minBreakPartMin:         d.minBreakPartMin,
    breakDuringWait:         overrides.breakDuringWait ?? d.breakDuringWait,
  }
}

/** Counters of the day so far. Plain numbers so a route simulation can copy it cheaply. */
export interface ClockState {
  /** Driving since the last qualifying (full or completed split) break. */
  drivingSinceBreak: number
  /** A first split part (≥ 15 min) was taken since the last qualifying break. */
  splitFirstTaken:   boolean
  /** Driving today. */
  dailyDriving:      number
  /** Work since the last break of at least 15 min. */
  workSinceBreak:    number
  /** Work today (driving + other work + waits not taken as a break). */
  workTotal:         number
  /** Breaks taken today (parts of at least 15 min only). */
  breakTotal:        number
}

export function initialClock(): ClockState {
  return { drivingSinceBreak: 0, splitFirstTaken: false, dailyDriving: 0, workSinceBreak: 0, workTotal: 0, breakTotal: 0 }
}

/** Kind of a qualifying break, for the plan and its explanation. */
export type BreakKind = 'FULL' | 'SPLIT_FIRST' | 'SPLIT_SECOND' | 'WORK'

/**
 * Records a break of `min` minutes. Returns what it counted as, or null when it is too short to
 * count (it is then neither work nor break — the caller decides; planners never schedule one).
 */
export function takeBreak(s: ClockState, min: number, r: RegulationRules): BreakKind | null {
  if (min < r.minBreakPartMin) return null
  s.breakTotal    += min
  s.workSinceBreak = 0
  if (min >= r.fullBreakMin) {
    s.drivingSinceBreak = 0
    s.splitFirstTaken   = false
    return 'FULL'
  }
  if (s.splitFirstTaken && min >= r.splitSecondMin) {
    s.drivingSinceBreak = 0
    s.splitFirstTaken   = false
    return 'SPLIT_SECOND'
  }
  if (min >= r.splitFirstMin && !s.splitFirstTaken) {
    s.splitFirstTaken = true
    return 'SPLIT_FIRST'
  }
  // A second part shorter than 30 min (or a third short part): it still interrupts work.
  return 'WORK'
}

/** Records driving time (no break logic — call {@link breakNeededBefore} first). */
export function drive(s: ClockState, min: number): void {
  s.drivingSinceBreak += min
  s.dailyDriving      += min
  s.workSinceBreak    += min
  s.workTotal         += min
}

/** Records non-driving work (service, manoeuvre, exutoire, loading, waiting not taken as a break). */
export function work(s: ClockState, min: number): void {
  s.workSinceBreak += min
  s.workTotal      += min
}

/** Total break the working-time rule requires once `workTotal` reaches the given amount. */
function requiredTotalBreak(workTotal: number, r: RegulationRules): number {
  if (workTotal > 540) return r.workBreakOver9hMin
  if (workTotal > 360) return r.workBreakOver6hMin
  return 0
}

/**
 * Length of the break to take right now so that `drivingMin` of driving followed by `otherWorkMin`
 * of work stays within both rules; 0 when none is needed. Never splits a driving leg: the break is
 * taken before departure (conservative — the driver may of course stop earlier).
 */
export function breakNeededBefore(s: ClockState, drivingMin: number, otherWorkMin: number, r: RegulationRules): number {
  let need = 0
  // A leg that fits in one driving period gets its break before departure; a longer one is broken
  // up on the road (see driveLeg) — a stop first would only add a break.
  if (drivingMin > 0 && drivingMin <= r.maxContinuousDrivingMin && s.drivingSinceBreak + drivingMin > r.maxContinuousDrivingMin) {
    need = s.splitFirstTaken ? r.splitSecondMin : r.fullBreakMin
  }
  const workAhead = drivingMin + otherWorkMin
  if (workAhead > 0) {
    if (s.workSinceBreak + workAhead > r.maxWorkBeforeBreakMin) need = Math.max(need, r.minBreakPartMin)
    const missing = requiredTotalBreak(s.workTotal + workAhead, r) - s.breakTotal
    if (missing > 0 && s.workTotal + workAhead > r.maxWorkBeforeBreakMin) {
      need = Math.max(need, Math.max(r.minBreakPartMin, missing))
    }
  }
  return need
}

/** Called for every break a leg requires: duration, what it counts as, driving already done on the leg. */
export type BreakSink = (_min: number, _kind: BreakKind, _drivenOnLegMin: number) => void

/**
 * Drives a leg of `legMin` followed by `otherWorkMin` of work, inserting the breaks the rules
 * require: before departure when needed, and inside the leg when the leg alone is longer than the
 * continuous-driving limit. Advances the clock; returns the total break time inserted.
 */
export function driveLeg(s: ClockState, legMin: number, otherWorkMin: number, r: RegulationRules, onBreak?: BreakSink): number {
  let added = 0
  const first = breakNeededBefore(s, legMin, otherWorkMin, r)
  if (first > 0) {
    const kind = takeBreak(s, first, r) ?? 'WORK'
    added += first
    onBreak?.(first, kind, 0)
  }
  let remaining = legMin
  let driven = 0
  while (remaining > 0) {
    const room = r.maxContinuousDrivingMin - s.drivingSinceBreak
    if (remaining <= room) { drive(s, remaining); break }
    if (room > 0) { drive(s, room); remaining -= room; driven += room }
    const len = s.splitFirstTaken ? r.splitSecondMin : r.fullBreakMin
    const kind = takeBreak(s, len, r) ?? 'WORK'
    added += len
    onBreak?.(len, kind, driven)
  }
  return added
}

export type ActivityKind = 'DRIVE' | 'WORK' | 'WAIT' | 'BREAK'

export interface Activity {
  kind:     ActivityKind
  minutes:  number
  /** Free label echoed in violations (step id). */
  ref?:     string
}

export type RegulationViolationCode =
  | 'CONTINUOUS_DRIVING'  // > 4 h 30 without a qualifying break
  | 'DAILY_DRIVING'       // > 9 h of driving
  | 'CONSECUTIVE_WORK'    // > 6 h of work without a break
  | 'WORK_BREAK_TOTAL'    // not enough total break for the day's work

export interface RegulationViolation {
  code:    RegulationViolationCode
  ref?:    string
  /** Amount over the limit (min). */
  overMin: number
  message: string
}

function fmt(min: number): string {
  const m = Math.round(min)
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/**
 * Checks an executed or edited timeline against the rules — used on plans that a user may have
 * edited by hand (drag & drop), where breaks are whatever PAUSE steps the plan contains. Waits
 * never count as breaks here: only explicit BREAK activities do.
 */
export function auditTimeline(activities: Activity[], r: RegulationRules = DEFAULT_REGULATION, initial?: ClockState): { violations: RegulationViolation[]; clock: ClockState } {
  const s: ClockState = initial ? { ...initial } : initialClock()
  const violations: RegulationViolation[] = []
  let continuousReported = false
  let workReported = false
  for (const a of activities) {
    if (a.minutes <= 0) continue
    switch (a.kind) {
      case 'BREAK': {
        const kind = takeBreak(s, a.minutes, r)
        if (kind === null) work(s, a.minutes)
        if (kind === 'FULL' || kind === 'SPLIT_SECOND') continuousReported = false
        if (kind !== null) workReported = false
        break
      }
      case 'DRIVE': {
        drive(s, a.minutes)
        if (!continuousReported && s.drivingSinceBreak > r.maxContinuousDrivingMin) {
          continuousReported = true
          violations.push({
            code: 'CONTINUOUS_DRIVING', ref: a.ref, overMin: s.drivingSinceBreak - r.maxContinuousDrivingMin,
            message: `Conduite continue de ${fmt(s.drivingSinceBreak)} sans pause réglementaire (maximum 4 h 30, puis 45 min de pause ou 15 + 30 min)`,
          })
        }
        break
      }
      case 'WORK':
      case 'WAIT':
        work(s, a.minutes)
        break
    }
    if (!workReported && a.kind !== 'BREAK' && s.workSinceBreak > r.maxWorkBeforeBreakMin) {
      workReported = true
      violations.push({
        code: 'CONSECUTIVE_WORK', ref: a.ref, overMin: s.workSinceBreak - r.maxWorkBeforeBreakMin,
        message: `${fmt(s.workSinceBreak)} de travail sans pause (maximum 6 h consécutives)`,
      })
    }
  }
  if (s.dailyDriving > r.maxDailyDrivingMin) {
    violations.push({
      code: 'DAILY_DRIVING', overMin: s.dailyDriving - r.maxDailyDrivingMin,
      message: `Conduite journalière de ${fmt(s.dailyDriving)} (maximum 9 h ; 10 h deux fois par semaine au plus)`,
    })
  }
  const required = requiredTotalBreak(s.workTotal, r)
  if (s.breakTotal < required) {
    violations.push({
      code: 'WORK_BREAK_TOTAL', overMin: required - s.breakTotal,
      message: `${fmt(s.workTotal)} de travail avec ${Math.round(s.breakTotal)} min de pause (minimum ${required} min)`,
    })
  }
  return { violations, clock: s }
}
