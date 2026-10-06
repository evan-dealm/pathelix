import type { PlannedMission } from '@/lib/types'
import { auditTimeline, type Activity, type ClockState } from './driverClock'
import { planningWeightKg } from './vehicleLoad'

/**
 * Helpers for re-optimising a day that has already started (POST /api/optimize/live,
 * POST /api/optimize/resequence).
 *
 * A step is LOCKED as soon as the driver has acted on it (en route, on site, started, done…):
 * it must never be moved to another driver or re-ordered, and it must stay in the driver's plan
 * — the driver app reads its progress from the plan, and the history/ML metrics rely on it.
 */

export type StatusEntry = { status?: string }

export function isLocked(entry: unknown): boolean {
  const st = entry && typeof entry === 'object' ? (entry as StatusEntry).status : undefined
  return typeof st === 'string' && st !== 'todo'
}

export function parsePlanMissions(missions: unknown): PlannedMission[] {
  if (Array.isArray(missions)) return missions as PlannedMission[]
  if (typeof missions === 'string') {
    try { const v = JSON.parse(missions); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  return []
}

/** The steps of an existing plan the driver already acted on, in their original order. */
export function lockedSteps(planMissions: PlannedMission[], statuses: Record<string, unknown>): PlannedMission[] {
  return [...planMissions]
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    .filter(m => isLocked(statuses[m.id]))
}

/**
 * Final plan = locked steps first (what is done/in progress stays where it is), then the newly
 * optimised remainder; sequenceOrder renumbered from 0. A step id present in both is kept once.
 */
export function mergeLockedAndOptimized(locked: PlannedMission[], optimized: PlannedMission[]): PlannedMission[] {
  const lockedIds = new Set(locked.map(m => m.id))
  const rest = [...optimized]
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    .filter(m => !lockedIds.has(m.id))
  return [...locked, ...rest].map((m, i) => ({ ...m, sequenceOrder: i }))
}

/** Minutes since midnight now, in the tenant's time zone (the server clock is UTC in production). */
export function nowMinutesInTimeZone(timeZone: string, now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
    return h * 60 + m
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes()
  }
}

export function minutesToHHMM(min: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(min)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

type TimedStatus = {
  status?: string
  en_routeAt?: string
  arrivedAt?: string
  startedAt?: string
  doingAt?: string
  doneAt?: string
  weightKg?: number
}

/** Minutes since midnight of an ISO timestamp in the tenant's time zone. */
function isoToMinutes(iso: string | undefined, timeZone: string): number | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return nowMinutesInTimeZone(timeZone, d)
}

/**
 * Regulatory counters and load of a driver whose day has started, rebuilt from the field statuses
 * of the steps already acted on — so a re-optimisation never restarts the 4 h 30 driving counter
 * at zero in the middle of the afternoon.
 *
 * Conservative where the field data is silent: time between two recorded events that is not a
 * PAUSE step counts as driving (travel) or work (on site), never as a break.
 */
export function liveStartState(
  locked: PlannedMission[],
  statuses: Record<string, unknown>,
  dayStartMin: number,
  nowMin: number,
  timeZone: string,
  lunchEndMin = 810,
): { clock: ClockState; lunchTaken: boolean; load: { kg: number; m3: number; bins: number } } {
  const acts: Activity[] = []
  let prevEnd = dayStartMin
  let lunchTaken = nowMin > lunchEndMin
  let bins = 0, kg = 0, m3 = 0
  for (const step of locked) {
    const raw = statuses[step.id]
    const st = (raw && typeof raw === 'object' ? raw : {}) as TimedStatus
    const arrived = isoToMinutes(st.arrivedAt ?? st.startedAt ?? st.doingAt, timeZone)
    const done = isoToMinutes(st.doneAt, timeZone)
    const isDone = st.status === 'done' || done !== undefined
    if (step.type === 'PAUSE') {
      const start = arrived ?? prevEnd
      const end = done ?? (isDone ? start + step.estimatedDurationMin : nowMin)
      acts.push({ kind: 'BREAK', minutes: Math.max(0, end - start) })
      if (step.breakKind === 'LUNCH') lunchTaken = true
      prevEnd = Math.max(prevEnd, end)
      continue
    }
    const arrival = arrived ?? (isDone ? done : undefined)
    if (arrival !== undefined) {
      acts.push({ kind: 'DRIVE', minutes: Math.max(0, arrival - prevEnd) })
      const end = done ?? (isDone ? arrival : nowMin)
      acts.push({ kind: 'WORK', minutes: Math.max(0, end - arrival) })
      prevEnd = Math.max(prevEnd, end)
    } else if (st.status === 'en_route') {
      acts.push({ kind: 'DRIVE', minutes: Math.max(0, nowMin - prevEnd) })
      prevEnd = nowMin
    }
    if (isDone) {
      if (step.type === 'VIDER') { bins = 0; kg = 0; m3 = 0 }
      else if (step.type === 'RETIRER' || step.type === 'ECHANGER' || step.type === 'CHARGER_IMMEDIAT') {
        bins++
        kg += planningWeightKg(step) ?? 0
        m3 += step.binSizeM3 ?? 0
      }
    }
  }
  // Since the last recorded event: the driver was working (conservative), not resting.
  if (nowMin > prevEnd) acts.push({ kind: 'WORK', minutes: nowMin - prevEnd })
  const { clock } = auditTimeline(acts)
  return { clock, lunchTaken, load: { kg, m3, bins } }
}
