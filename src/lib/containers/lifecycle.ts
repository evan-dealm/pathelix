/**
 * Rules of a bin's life. Movements follow the field: a mission's steps move its bins (pose →
 * at the customer, retrait → on the truck, exutoire → emptied, end of the tour → back at the
 * depot); people only change what the field cannot tell (maintenance, lost, full, to collect…).
 * Pure functions — the database side is in service.ts.
 */

export const CONTAINER_STATUSES = [
  'AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'AT_CUSTOMER', 'FULL', 'TO_COLLECT',
  'AT_EXUTOIRE', 'MAINTENANCE', 'IMMOBILIZED', 'LOST', 'ARCHIVED',
] as const
export type ContainerStatus = typeof CONTAINER_STATUSES[number]

export const STATUS_LABEL: Record<ContainerStatus, string> = {
  AVAILABLE:   'Disponible',
  RESERVED:    'Réservée',
  IN_TRANSIT:  'En transport',
  AT_CUSTOMER: 'Chez client',
  FULL:        'Pleine',
  TO_COLLECT:  'À retirer',
  AT_EXUTOIRE: 'À l\'exutoire',
  MAINTENANCE: 'Maintenance',
  IMMOBILIZED: 'Immobilisée',
  LOST:        'Perdue',
  ARCHIVED:    'Archivée',
}

/** A bin that is physically at a customer's site (counts for "days on site"). */
export function isAtCustomer(s: ContainerStatus): boolean {
  return s === 'AT_CUSTOMER' || s === 'FULL' || s === 'TO_COLLECT'
}

/** Out of service: never offered for a pose. */
export function isOutOfService(s: ContainerStatus): boolean {
  return s === 'MAINTENANCE' || s === 'IMMOBILIZED' || s === 'LOST' || s === 'ARCHIVED'
}

/**
 * Status changes a person may make by hand. Movements (IN_TRANSIT, AT_CUSTOMER from the depot,
 * RESERVED) come from missions; a manual relocation ("this bin is actually at client X") goes
 * through relocate() and is logged as a correction.
 */
const MANUAL: Record<ContainerStatus, readonly ContainerStatus[]> = {
  AVAILABLE:   ['MAINTENANCE', 'IMMOBILIZED', 'LOST', 'ARCHIVED'],
  RESERVED:    ['AVAILABLE', 'MAINTENANCE', 'IMMOBILIZED', 'LOST'],
  IN_TRANSIT:  ['AVAILABLE', 'LOST'],
  AT_CUSTOMER: ['FULL', 'TO_COLLECT', 'IMMOBILIZED', 'LOST'],
  FULL:        ['AT_CUSTOMER', 'TO_COLLECT', 'IMMOBILIZED', 'LOST'],
  TO_COLLECT:  ['AT_CUSTOMER', 'FULL', 'IMMOBILIZED', 'LOST'],
  AT_EXUTOIRE: ['AVAILABLE', 'LOST'],
  MAINTENANCE: ['AVAILABLE', 'IMMOBILIZED', 'ARCHIVED'],
  IMMOBILIZED: ['AVAILABLE', 'MAINTENANCE', 'ARCHIVED', 'AT_CUSTOMER'],
  LOST:        ['AVAILABLE', 'ARCHIVED'],
  ARCHIVED:    ['AVAILABLE'],
}

export function canSetManually(from: ContainerStatus, to: ContainerStatus): boolean {
  return MANUAL[from].includes(to)
}

export function allowedManualTargets(from: ContainerStatus): readonly ContainerStatus[] {
  return MANUAL[from]
}

/** What a mission step does to its bins. */
export interface MissionForContainers {
  id:                    string
  type:                  string
  placedContainerId?:    string | null
  collectedContainerId?: string | null
  clientId?:             string | null
  siteId?:               string | null
  latitude:              number
  longitude:             number
  materialId?:           string | null
}

export type ContainerEventType = 'CREATED' | 'RESERVED' | 'LOADED' | 'PLACED' | 'PICKED_UP' | 'EMPTIED' | 'RETURNED' | 'STATUS' | 'RELOCATED' | 'SCANNED' | 'NOTE' | 'RELEASED'

export interface ContainerEffect {
  containerId: string
  to:          ContainerStatus
  event:       ContainerEventType
  /** Fields to set on the container (null clears). */
  patch: {
    clientId?:       string | null
    siteId?:         string | null
    latitude?:       number | null
    longitude?:      number | null
    locationLabel?:  string
    driverId?:       string | null
    missionId?:      string | null
    materialId?:     string | null
    placedAt?:       Date | null
    lastRotationAt?: Date
  }
}

function place(id: string, m: MissionForContainers): ContainerEffect {
  return {
    containerId: id, to: 'AT_CUSTOMER', event: 'PLACED',
    patch: { clientId: m.clientId ?? null, siteId: m.siteId ?? null, latitude: m.latitude, longitude: m.longitude, locationLabel: '', driverId: null, missionId: null, placedAt: new Date() },
  }
}

function pickUp(id: string, m: MissionForContainers, driverId: string): ContainerEffect {
  return {
    containerId: id, to: 'IN_TRANSIT', event: 'PICKED_UP',
    patch: { clientId: null, siteId: null, locationLabel: 'Camion', driverId, missionId: m.id, materialId: m.materialId ?? null, placedAt: null },
  }
}

/** Effects of a mission step being started (the truck leaves with the bin to put down). */
export function effectsOnDeparture(m: MissionForContainers, driverId: string): ContainerEffect[] {
  if ((m.type === 'POSER' || m.type === 'ECHANGER') && m.placedContainerId) {
    return [{ containerId: m.placedContainerId, to: 'IN_TRANSIT', event: 'LOADED', patch: { driverId, missionId: m.id, locationLabel: 'Camion', clientId: null, siteId: null } }]
  }
  return []
}

/** Effects of a mission step completed by the driver. */
export function effectsOnDone(m: MissionForContainers, driverId: string): ContainerEffect[] {
  const out: ContainerEffect[] = []
  switch (m.type) {
    case 'POSER':
      if (m.placedContainerId) out.push(place(m.placedContainerId, m))
      break
    case 'RETIRER':
    case 'CHARGER_IMMEDIAT':
    case 'ALLER_RETOUR':
      if (m.collectedContainerId) out.push(pickUp(m.collectedContainerId, m, driverId))
      break
    case 'ECHANGER':
      if (m.collectedContainerId) out.push(pickUp(m.collectedContainerId, m, driverId))
      if (m.placedContainerId) out.push(place(m.placedContainerId, m))
      break
    case 'DEPLACER': {
      const id = m.placedContainerId ?? m.collectedContainerId
      if (id) out.push({ ...place(id, m), event: 'RELOCATED' })
      break
    }
  }
  return out
}

/** Synthetic plan step ids produced by the optimiser (see formatSolution.ts). */
export function syntheticStepKind(stepId: string): { kind: 'DUMP' | 'REPOSE' | 'BREAK' | null; missionId?: string } {
  if (stepId.startsWith('_vider_ar_')) return { kind: 'DUMP', missionId: stepId.split('_').slice(4).join('_') || undefined }
  if (stepId.startsWith('_vider_') || stepId.startsWith('_ex_')) return { kind: 'DUMP' }
  if (stepId.startsWith('_pose_ar_')) return { kind: 'REPOSE', missionId: stepId.slice('_pose_ar_'.length) }
  if (stepId.startsWith('_pause_')) return { kind: 'BREAK' }
  return { kind: null }
}

/** Days a bin has been on site (whole days since it was put down). */
export function daysOnSite(placedAt: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!placedAt) return null
  const t = typeof placedAt === 'string' ? new Date(placedAt) : placedAt
  if (Number.isNaN(t.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - t.getTime()) / 86_400_000))
}
