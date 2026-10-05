import type { SessionPayload } from '@/lib/session'
import type { TenantDb } from '@/lib/tenantDb'

/**
 * Ownership rules for driver-facing routes. Tenant isolation alone is not enough here: a driver
 * session must only ever act on ITS OWN driver record and on missions of ITS OWN plan — not on a
 * colleague's photos, proofs or statuses within the same tenant.
 */

export const STAFF_ROLES = ['admin', 'dispatcher', 'superadmin'] as const

export function isStaff(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

/** The Driver id a driver session is bound to (`driverRef`, falling back to `sub`). */
export function sessionDriverId(session: Pick<SessionPayload, 'driverRef' | 'sub'>): string {
  return session.driverRef ?? session.sub
}

/**
 * True when the caller may act for `driverId`: staff of the driver's tenant, or that driver
 * itself. `driverTenantId` must come from the database, never from the request.
 */
export function canActForDriver(
  session: Pick<SessionPayload, 'role' | 'tenantId' | 'driverRef' | 'sub'>,
  driverId: string,
  driverTenantId: string,
): boolean {
  if (session.tenantId !== driverTenantId) return false
  if (isStaff(session.role)) return true
  return session.role === 'driver' && (session.driverRef === driverId || session.sub === driverId)
}

function planMissionIds(missions: unknown): Set<string> {
  let arr: unknown = missions
  if (typeof missions === 'string') {
    try { arr = JSON.parse(missions) } catch { return new Set() }
  }
  const ids = new Set<string>()
  if (Array.isArray(arr)) {
    for (const m of arr) {
      if (m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string') ids.add((m as { id: string }).id)
    }
  }
  return ids
}

/** True when `missionId` is part of the driver's plan for `date` (tenant-scoped client). */
export async function planContainsMission(db: TenantDb, driverId: string, date: string, missionId: string): Promise<boolean> {
  const plan = await db.plan.findFirst({ where: { driverId, date }, select: { missions: true } })
  return plan ? planMissionIds(plan.missions).has(missionId) : false
}

/**
 * True when `missionId` is assigned to `driverId` — looked up through the mission's own date, so
 * callers that don't carry a date (incidents, comments, proofs) can still check ownership.
 */
export async function driverOwnsMission(db: TenantDb, driverId: string, missionId: string): Promise<boolean> {
  const mission = await db.mission.findFirst({ where: { id: missionId }, select: { date: true } })
  if (!mission) return false
  return planContainsMission(db, driverId, mission.date, missionId)
}
