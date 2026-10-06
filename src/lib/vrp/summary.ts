import { calcTour } from '@/lib/algorithm'
import type { Driver, Exutoire, Mission, PlannedMission } from '@/lib/types'

export interface PlanSummary {
  assigned: number
  unassigned: number
  p1Unassigned: number
  driversUsed: number
  km: number
  hours: number
  longestTourH: number
  lateStops: number
  /** CE 561/2006 and working-time findings of the timeline audit. */
  regulatoryIssues: number
}

/**
 * Scores a set of routes with the timeline simulator and its regulatory audit (what the
 * dispatcher and the driver see), whatever produced them.
 */
export function summarizePlan(
  assignments: Record<string, PlannedMission[]>, unassigned: Mission[], drivers: Driver[], exutoires: Exutoire[],
  startTime: string, speedKmh: number,
): PlanSummary {
  const s: PlanSummary = { assigned: 0, unassigned: unassigned.length, p1Unassigned: unassigned.filter(m => m.priority === 1).length, driversUsed: 0, km: 0, hours: 0, longestTourH: 0, lateStops: 0, regulatoryIssues: 0 }
  for (const d of drivers) {
    const steps = assignments[d.id] ?? []
    if (!steps.some(m => !m.id.startsWith('_'))) continue
    s.driversUsed++
    s.assigned += steps.filter(m => !m.id.startsWith('_')).length
    const t = calcTour(steps, d.depotLat, d.depotLng, startTime, speedKmh, exutoires)
    s.km += t.totalRoadDistKm
    s.hours += t.totalDurationMin / 60
    s.longestTourH = Math.max(s.longestTourH, t.totalDurationMin / 60)
    s.lateStops += t.steps.filter(st => st.mission.timeWindow && !st.mission.id.startsWith('_') && st.arrivalMin > st.mission.timeWindow.closeMin).length
    s.regulatoryIssues += t.warnings.filter(w => /CE 561/.test(w.message)).length
  }
  s.km = Math.round(s.km); s.hours = Math.round(s.hours * 10) / 10; s.longestTourH = Math.round(s.longestTourH * 10) / 10
  return s
}
