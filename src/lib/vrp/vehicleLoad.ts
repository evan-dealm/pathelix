import type { Driver, Mission } from '@/lib/types'

/**
 * Weight and volume of what a truck carries, for the payload / GVW (PTAC) constraint.
 *
 * What is counted: bins loaded full (pickups: RETIRER, ECHANGER, CHARGER_IMMEDIAT, and the bin of
 * an ALLER_RETOUR on its way to the exutoire) — their empty weight plus their content. Empty bins
 * on their way to a POSER/ECHANGER are not counted: the heaviest moment of a skip truck's day is
 * the trip to the exutoire with full bins, which is what the limit protects.
 *
 * A weight that is not known is never invented: a mission without `weightKg` adds only its bin's
 * tare (when known), and a truck without payload/GVW figures has no weight limit.
 */

/** Bin pickups: a full bin goes on the truck. */
export function isPickup(type: string): boolean {
  return type === 'RETIRER' || type === 'ECHANGER' || type === 'CHARGER_IMMEDIAT'
}

/**
 * Weight used for planning a full bin: tare + content + uncertainty margin (upper bound, so an
 * estimate never lets an overloaded trip through). Undefined when nothing is known.
 */
export function planningWeightKg(m: Pick<Mission, 'weightKg' | 'weightUncertaintyKg' | 'binTareKg'>): number | undefined {
  const tare = typeof m.binTareKg === 'number' && m.binTareKg > 0 ? m.binTareKg : 0
  if (typeof m.weightKg !== 'number' || !Number.isFinite(m.weightKg)) return tare > 0 ? tare : undefined
  return tare + Math.max(0, m.weightKg) + Math.max(0, m.weightUncertaintyKg ?? 0)
}

/** Maximum load (kg) of the driver's truck: min(declared payload, GVW − tare). Infinity when unknown. */
export function maxLoadKg(d: Driver): number {
  const p = d.payload
  if (!p) return Infinity
  let m = Infinity
  if (typeof p.maxPayloadKg === 'number' && p.maxPayloadKg > 0) m = p.maxPayloadKg
  if (typeof p.gvwKg === 'number' && typeof p.tareKg === 'number' && p.gvwKg > p.tareKg) m = Math.min(m, p.gvwKg - p.tareKg)
  return m
}

/** Maximum volume (m³) of full bins on board — only when the truck declares a volume. */
export function maxVolumeM3(d: Driver): number {
  const v = d.capacityDimensions?.volume
  return typeof v === 'number' && v > 0 ? v : Infinity
}

export type LoadIssue = 'PAYLOAD' | 'VOLUME'

/** A bin that alone exceeds what this truck may carry (position-independent infeasibility). */
export function loadIssueAlone(m: Mission, d: Driver): LoadIssue | null {
  if (!isPickup(m.type) && m.type !== 'ALLER_RETOUR') return null
  const w = planningWeightKg(m)
  if (w !== undefined && w > maxLoadKg(d)) return 'PAYLOAD'
  if (m.binSizeM3 && m.binSizeM3 > maxVolumeM3(d)) return 'VOLUME'
  return null
}
