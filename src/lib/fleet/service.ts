import type { TenantDb } from '@/lib/tenantDb'
import { notify } from '@/lib/notifications'
import { emitBusinessEvent } from '@/lib/events/outbound'
import { planStatus, vehicleBlockers, type PlanStatus } from './maintenance'

export interface RecordMaintenanceInput {
  vehicleId: string
  type: string
  description: string
  costEur?: number | null
  mileageKm?: number | null
  doneAt: string
  doneBy: string
  notes: string
  /** Preventive plan fulfilled by this intervention. */
  planId?: string
  /** Defects repaired by it (they are closed). */
  defectIds?: string[]
  /** New explicit due date of the plan (insurance renewal, CT appointment given by the centre). */
  nextDueDate?: string
}

/**
 * Records an intervention and its consequences in one transaction: the plan restarts from it,
 * the truck's odometer moves forward, the repaired defects are closed — so the truck stops being
 * immobilised by them. The legacy vehicle fields (nextInspection, insuranceExpiry) are kept in
 * step, otherwise they would keep blocking a truck whose CT or insurance was just renewed.
 */
export async function recordMaintenance(db: TenantDb, userId: string, input: RecordMaintenanceInput) {
  return db.$transaction(async tx => {
    const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId }, select: { id: true, mileageKm: true } })
    if (!vehicle) return null
    const plan = input.planId ? await tx.maintenancePlan.findFirst({ where: { id: input.planId, vehicleId: vehicle.id } }) : null
    if (input.planId && !plan) return null
    const record = await tx.maintenanceRecord.create({
      data: {
        vehicleId: vehicle.id, type: input.type, description: input.description, costEur: input.costEur ?? null,
        mileageKm: input.mileageKm ?? null, doneAt: input.doneAt, doneBy: input.doneBy, notes: input.notes, planId: plan?.id ?? null,
      } as Parameters<typeof tx.maintenanceRecord.create>[0]['data'],
    })
    if (input.mileageKm && input.mileageKm > vehicle.mileageKm) {
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { mileageKm: input.mileageKm } })
    }
    if (plan) {
      const newer = !plan.lastDoneAt || input.doneAt >= plan.lastDoneAt
      const updated = await tx.maintenancePlan.update({
        where: { id: plan.id },
        data: {
          ...(newer ? { lastDoneAt: input.doneAt, ...(input.mileageKm ? { lastDoneKm: input.mileageKm } : {}) } : {}),
          // A renewal date given now replaces the old one; otherwise the interval takes over.
          dueDate: input.nextDueDate ?? (plan.everyMonths || plan.everyKm ? null : plan.dueDate),
        },
      })
      const next = planStatus(updated, Math.max(vehicle.mileageKm, input.mileageKm ?? 0), input.doneAt).nextDate
      if (plan.kind === 'CT' && next) await tx.vehicle.update({ where: { id: vehicle.id }, data: { nextInspection: next } })
      if (plan.kind === 'INSURANCE' && next) await tx.vehicle.update({ where: { id: vehicle.id }, data: { insuranceExpiry: next } })
    }
    if (input.defectIds?.length) {
      await tx.vehicleDefect.updateMany({
        where: { id: { in: input.defectIds }, vehicleId: vehicle.id, status: { in: ['OPEN', 'IN_REPAIR'] } },
        data: { status: 'FIXED', resolvedAt: new Date(), resolvedBy: userId, maintenanceRecordId: record.id, resolution: input.description.slice(0, 500) },
      })
    }
    return record
  })
}

/** A defect is recorded; a critical one immobilises the truck at once and alerts the office. */
export async function reportDefect(db: TenantDb, tenantId: string, input: {
  vehicleId: string; driverId?: string | null; reportedBy: string; severity: 'MINOR' | 'MAJOR' | 'CRITICAL'
  category: string; description: string; mileageKm?: number | null; photoDocumentId?: string | null
}) {
  const vehicle = await db.vehicle.findFirst({ where: { id: input.vehicleId }, select: { id: true, licensePlate: true, mileageKm: true } })
  if (!vehicle) return null
  const defect = await db.vehicleDefect.create({
    data: {
      vehicleId: vehicle.id, driverId: input.driverId ?? null, reportedBy: input.reportedBy, severity: input.severity,
      category: input.category, description: input.description, mileageKm: input.mileageKm ?? null, photoDocumentId: input.photoDocumentId ?? null,
    } as Parameters<typeof db.vehicleDefect.create>[0]['data'],
  })
  if (input.mileageKm && input.mileageKm > vehicle.mileageKm) await db.vehicle.update({ where: { id: vehicle.id }, data: { mileageKm: input.mileageKm } })
  if (input.severity !== 'MINOR') {
    void notify(tenantId, {
      kind: 'VEHICLE_DOWN',
      title: input.severity === 'CRITICAL' ? `${vehicle.licensePlate} immobilisé : ${input.description.slice(0, 80)}` : `${vehicle.licensePlate} : défaut signalé (${input.description.slice(0, 80)})`,
      body: input.severity === 'CRITICAL' ? 'Le camion n\'est plus proposé à l\'optimisation tant que le défaut n\'est pas réparé.' : 'À examiner à la prochaine immobilisation.',
      link: 'vehicles', entityType: 'vehicleDefect', entityId: defect.id,
    })
  }
  if (input.severity === 'CRITICAL') void emitBusinessEvent(tenantId, 'vehicle.immobilized', { vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, defectId: defect.id })
  return defect
}

export interface FleetVehicleStatus {
  id: string; licensePlate: string; brand: string; model: string; mileageKm: number; status: string
  blockers: string[]
  plans: Array<{ id: string; kind: string; label: string; everyKm: number | null; everyMonths: number | null; lastDoneAt: string | null; lastDoneKm: number | null; dueDate: string | null; active: boolean } & PlanStatus>
  defects: Array<{ id: string; severity: string; category: string; description: string; status: string; createdAt: Date; driverId: string | null }>
}

/** Every truck with its plans' status, its open defects and what immobilises it on `today`. */
export async function fleetOverview(db: TenantDb, today: string): Promise<FleetVehicleStatus[]> {
  const [vehicles, plans, defects] = await Promise.all([
    db.vehicle.findMany({ where: { archived: false }, orderBy: { licensePlate: 'asc' }, select: { id: true, licensePlate: true, brand: true, model: true, mileageKm: true, status: true, nextInspection: true, insuranceExpiry: true } }),
    db.maintenancePlan.findMany({ orderBy: { createdAt: 'asc' } }),
    db.vehicleDefect.findMany({ where: { status: { in: ['OPEN', 'IN_REPAIR'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, vehicleId: true, severity: true, category: true, description: true, status: true, createdAt: true, driverId: true } }),
  ])
  return vehicles.map(v => {
    const vp = plans.filter(p => p.vehicleId === v.id)
    const vd = defects.filter(d => d.vehicleId === v.id)
    return {
      id: v.id, licensePlate: v.licensePlate, brand: v.brand, model: v.model, mileageKm: v.mileageKm, status: v.status,
      blockers: vehicleBlockers(v, vp, vd, today),
      plans: vp.map(p => ({ id: p.id, kind: p.kind, label: p.label, everyKm: p.everyKm, everyMonths: p.everyMonths, lastDoneAt: p.lastDoneAt, lastDoneKm: p.lastDoneKm, dueDate: p.dueDate, active: p.active, ...planStatus(p, v.mileageKm, today) })),
      defects: vd.map(({ vehicleId: _v, ...d }) => d),
    }
  })
}
