/**
 * Fleet maintenance rules: when a plan is due, and when a truck must not be planned at all.
 *
 * A truck is immobilised (never proposed to the optimiser) when:
 * - a regulatory deadline has passed — technical inspection (CT), tachograph calibration,
 *   insurance: driving it would be illegal;
 * - a CRITICAL defect reported on it is still open;
 * - (already before) status not "active" or a downtime covers the day.
 * Everything else (service, tyres, extinguisher…) only warns: the office decides.
 */

export const PLAN_KINDS = ['SERVICE', 'CT', 'TACHOGRAPH', 'INSURANCE', 'TIRES', 'EXTINGUISHER', 'LIFTING', 'CUSTOM'] as const
export type PlanKind = typeof PLAN_KINDS[number]
/** Overdue = illegal to drive. */
export const BLOCKING_KINDS: ReadonlySet<string> = new Set(['CT', 'TACHOGRAPH', 'INSURANCE'])

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  SERVICE: 'Entretien', CT: 'Contrôle technique', TACHOGRAPH: 'Chronotachygraphe', INSURANCE: 'Assurance',
  TIRES: 'Pneumatiques', EXTINGUISHER: 'Extincteur', LIFTING: 'Bras / grue (VGP)', CUSTOM: 'Autre',
}

/** Usual intervals for a heavy truck (France) — suggestions when a plan is created. */
export const PLAN_DEFAULTS: Partial<Record<PlanKind, { everyMonths?: number; everyKm?: number }>> = {
  SERVICE: { everyKm: 60_000, everyMonths: 12 },
  CT: { everyMonths: 12 },
  TACHOGRAPH: { everyMonths: 24 },
  EXTINGUISHER: { everyMonths: 12 },
  LIFTING: { everyMonths: 6 },
}

export const DEFECT_CATEGORIES = ['BRAKES', 'LIGHTS', 'TYRES', 'HYDRAULICS', 'LEAK', 'BODY', 'ENGINE', 'OTHER'] as const
export const DEFECT_CATEGORY_LABEL: Record<typeof DEFECT_CATEGORIES[number], string> = {
  BRAKES: 'Freins', LIGHTS: 'Éclairage', TYRES: 'Pneus', HYDRAULICS: 'Hydraulique / bras', LEAK: 'Fuite', BODY: 'Carrosserie', ENGINE: 'Moteur', OTHER: 'Autre',
}

export interface PlanLike {
  kind: string; label: string; everyKm: number | null; everyMonths: number | null
  lastDoneAt: string | null; lastDoneKm: number | null; dueDate: string | null
  warnDays: number; warnKm: number; active: boolean
}

export type DueState = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN'

export interface PlanStatus {
  state: DueState
  nextDate: string | null
  nextKm: number | null
  /** Days until the date deadline (negative once passed). */
  daysLeft: number | null
  kmLeft: number | null
  blocking: boolean
  message: string
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const frDate = (iso: string) => iso.split('-').reverse().join('/')

/** Where a plan stands on `today` for a truck showing `mileageKm`. */
export function planStatus(plan: PlanLike, mileageKm: number, today: string): PlanStatus {
  const nextDate = plan.dueDate ?? (plan.everyMonths && plan.lastDoneAt ? addMonths(plan.lastDoneAt, plan.everyMonths) : null)
  const nextKm = plan.everyKm && plan.lastDoneKm !== null ? plan.lastDoneKm + plan.everyKm : null
  const daysLeft = nextDate ? daysBetween(today, nextDate) : null
  const kmLeft = nextKm !== null && mileageKm > 0 ? nextKm - mileageKm : null
  const blocking = BLOCKING_KINDS.has(plan.kind)

  if (!plan.active) return { state: 'OK', nextDate, nextKm, daysLeft, kmLeft, blocking: false, message: 'Suivi désactivé' }
  if (nextDate === null && nextKm === null) {
    return { state: 'UNKNOWN', nextDate, nextKm, daysLeft, kmLeft, blocking: false, message: 'Dernière intervention inconnue : renseignez-la' }
  }
  const overdue = (daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft < 0)
  const soon = (daysLeft !== null && daysLeft <= plan.warnDays) || (kmLeft !== null && kmLeft <= plan.warnKm)
  const parts: string[] = []
  if (nextDate) parts.push(daysLeft! < 0 ? `échéance dépassée depuis le ${frDate(nextDate)}` : `à faire avant le ${frDate(nextDate)}`)
  if (nextKm !== null) parts.push(kmLeft !== null && kmLeft < 0 ? `dépassement de ${(-kmLeft).toLocaleString('fr-FR')} km` : `à ${nextKm.toLocaleString('fr-FR')} km`)
  const state: DueState = overdue ? 'OVERDUE' : soon ? 'DUE_SOON' : 'OK'
  return { state, nextDate, nextKm, daysLeft, kmLeft, blocking: blocking && overdue, message: `${plan.label} : ${parts.join(', ')}` }
}

export interface VehicleLike { licensePlate: string; mileageKm: number; nextInspection: string | null; insuranceExpiry: string | null }
export interface DefectLike { severity: string; status: string; description: string }

/**
 * Reasons a truck cannot be planned on `date` (empty = usable). The legacy vehicle fields
 * (nextInspection, insuranceExpiry) count as well, so tenants who only filled those are covered.
 */
export function vehicleBlockers(v: VehicleLike, plans: PlanLike[], defects: DefectLike[], date: string): string[] {
  const reasons: string[] = []
  if (v.insuranceExpiry && v.insuranceExpiry < date) reasons.push(`assurance expirée le ${frDate(v.insuranceExpiry)}`)
  if (v.nextInspection && v.nextInspection < date) reasons.push(`contrôle technique échu le ${frDate(v.nextInspection)}`)
  for (const p of plans) {
    const s = planStatus(p, v.mileageKm, date)
    if (s.blocking) reasons.push(s.message)
  }
  for (const d of defects) {
    if (d.severity === 'CRITICAL' && (d.status === 'OPEN' || d.status === 'IN_REPAIR')) reasons.push(`défaut bloquant : ${d.description.slice(0, 80)}`)
  }
  return [...new Set(reasons)]
}
