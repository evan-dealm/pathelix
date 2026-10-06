import type { TenantDb } from '@/lib/tenantDb'
import { syntheticStepKind } from '@/lib/containers/lifecycle'

/**
 * A weighing recorded from the field (driver's ticket on a dump step) becomes a Weighing row
 * attached to the mission it empties — what billing per tonne and the BSD use. A correction by
 * the driver updates the same row.
 */
export async function recordDriverWeighing(db: TenantDb, p: { driverId: string; stepId: string; netKg: number; at: Date; source?: 'DRIVER' | 'OCR' }): Promise<string | null> {
  // Dump steps are `_vider_<exutoireId>_<missionId>` (or _vider_pre_ / _vider_ar_); a weight may
  // also be typed on the mission itself.
  let missionId: string | null = null
  let exutoireId: string | null = null
  const kind = syntheticStepKind(p.stepId).kind
  if (kind === 'DUMP') {
    const parts = p.stepId.replace(/^_vider_(pre_|ar_)?/, '').split('_')
    exutoireId = parts[0] || null
    missionId = parts.slice(1).join('_') || null
  } else if (kind === null) {
    missionId = p.stepId
  }
  const mission = missionId
    ? await db.mission.findFirst({ where: { id: missionId }, select: { id: true, clientId: true, materialId: true, collectedContainerId: true } })
    : null
  const exutoire = exutoireId ? await db.exutoire.findFirst({ where: { id: exutoireId }, select: { id: true } }) : null
  const data = {
    netKg: p.netKg, weighedAt: p.at, source: p.source ?? 'DRIVER', status: p.source === 'OCR' ? 'PENDING_REVIEW' : 'VALIDATED',
    missionId: mission?.id ?? null, clientId: mission?.clientId ?? null, materialId: mission?.materialId ?? null,
    containerId: mission?.collectedContainerId ?? null, exutoireId: exutoire?.id ?? null,
  }
  const existing = await db.weighing.findFirst({ where: { stepId: p.stepId, driverId: p.driverId }, select: { id: true } })
  if (existing) {
    await db.weighing.update({ where: { id: existing.id }, data })
    return existing.id
  }
  const created = await db.weighing.create({ data: { ...data, stepId: p.stepId, driverId: p.driverId } as Parameters<typeof db.weighing.create>[0]['data'] })
  // The mission now carries a weighed weight (planning, estimates calibration, reports).
  if (mission) await db.mission.update({ where: { id: mission.id }, data: { weightKg: p.netKg, weightSource: 'WEIGHED', weightUncertaintyKg: 0 } })
  return created.id
}
