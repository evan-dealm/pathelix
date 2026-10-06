import { makeRegulationRules, type RegulationRules } from './driverClock'
import type { CostContext } from './types'

/** The tenant settings the optimiser reads (a subset of TenantSettings; all optional). */
export interface TenantPlanningSettings {
  maxWorkDayMin?:         number | null
  pauseAfterMin?:         number | null
  pauseDurationMin?:      number | null
  lunchBreakEnabled?:     boolean | null
  lunchBreakStart?:       string | null
  lunchBreakEnd?:         string | null
  lunchBreakDurationMin?: number | null
  breakDuringWait?:       boolean | null
}

function hhmm(v: string | null | undefined, fallback: number): number {
  if (!v) return fallback
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return fallback
  const h = Number(m[1]), mi = Number(m[2])
  return h <= 23 && mi <= 59 ? h * 60 + mi : fallback
}

/**
 * Optimiser options from the tenant settings: regulation (only ever stricter than CE 561/2006),
 * maximum work per day, lunch break. Settings shown in the UI that the optimiser did not read
 * were a lie — every one of them is honoured here.
 */
export function planningOptionsFromSettings(s: TenantPlanningSettings | null | undefined): {
  regulation: RegulationRules
  maxWorkMin: number
  costConfig: NonNullable<CostContext['costConfig']>
} {
  const regulation = makeRegulationRules({
    maxContinuousDrivingMin: s?.pauseAfterMin ?? undefined,
    fullBreakMin:            s?.pauseDurationMin ?? undefined,
    breakDuringWait:         s?.breakDuringWait ?? undefined,
  })
  const work = s?.maxWorkDayMin
  const maxWorkMin = typeof work === 'number' && work >= 60 && work <= 720 ? work : 600
  const start = hhmm(s?.lunchBreakStart, 720)
  const end   = hhmm(s?.lunchBreakEnd, 810)
  const dur   = s?.lunchBreakDurationMin
  return {
    regulation,
    maxWorkMin,
    costConfig: {
      lunchBreakEnabled:     s?.lunchBreakEnabled ?? true,
      lunchBreakStartMin:    start,
      lunchBreakEndMin:      end > start ? end : start + 90,
      lunchBreakDurationMin: typeof dur === 'number' && dur >= 0 && dur <= 120 ? dur : 30,
    },
  }
}
