import { getTenantDb } from '@/lib/tenantDb'
import { isMissionStatus, type MissionStatus } from '@/lib/missionStatus'

export type StatusSnapshot = Record<string, Record<string, MissionStatus>>

/**
 * Field progress of every driver of a tenant for one day, read from the source of truth
 * (`Plan.statuses`, written by /api/driver-status/update). Shape: { driverId: { missionId: status } }.
 * One query per call — used for the dispatch live view (SSE + polling fallback).
 */
export async function loadStatusSnapshot(tenantId: string, date: string, driverId?: string): Promise<StatusSnapshot> {
  const plans = await getTenantDb(tenantId).plan.findMany({
    where:  { date, ...(driverId ? { driverId } : {}) },
    select: { driverId: true, statuses: true },
  })
  const out: StatusSnapshot = {}
  for (const p of plans) {
    const entries = p.statuses && typeof p.statuses === 'object' && !Array.isArray(p.statuses)
      ? Object.entries(p.statuses as Record<string, unknown>)
      : []
    const byMission: Record<string, MissionStatus> = {}
    for (const [missionId, entry] of entries) {
      const st = entry && typeof entry === 'object' ? (entry as { status?: unknown }).status : entry
      if (isMissionStatus(st)) byMission[missionId] = st
    }
    if (Object.keys(byMission).length > 0) out[p.driverId] = byMission
  }
  return out
}
