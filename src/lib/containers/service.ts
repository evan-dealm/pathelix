import type { TenantDb } from '@/lib/tenantDb'
import { ApiError } from '@/lib/api/route'
import {
  canSetManually, effectsOnDeparture, effectsOnDone, isOutOfService, syntheticStepKind,
  STATUS_LABEL, type ContainerEffect, type ContainerEventType, type ContainerStatus, type MissionForContainers,
} from './lifecycle'

/** The models this module writes — satisfied by a tenant-scoped client and by its transactions. */
export type ContainerDb = Pick<TenantDb, 'container' | 'containerEvent' | 'mission' | 'driver'>

interface Who {
  driverId?: string | null
  userId?:   string | null
  latitude?: number
  longitude?: number
  at?:       Date
  notes?:    string
}

const MISSION_FIELDS = {
  id: true, type: true, placedContainerId: true, collectedContainerId: true, clientId: true, siteId: true,
  latitude: true, longitude: true, materialId: true,
} as const

/** Applies effects (status + fields) and logs one event per bin moved. Unknown/archived bins are skipped. */
export async function applyEffects(db: ContainerDb, effects: ContainerEffect[], who: Who, missionId?: string): Promise<ContainerEffect[]> {
  const applied: ContainerEffect[] = []
  const at = who.at ?? new Date()
  for (const e of effects) {
    const c = await db.container.findFirst({ where: { id: e.containerId }, select: { id: true, status: true } })
    if (!c || c.status === 'ARCHIVED') continue
    const patch = { ...e.patch }
    if (patch.placedAt) patch.placedAt = at
    await db.container.update({
      where: { id: c.id },
      data: { status: e.to, ...patch, lastMovementAt: at },
    })
    await db.containerEvent.create({
      data: {
        containerId: c.id, type: e.event, fromStatus: c.status, toStatus: e.to,
        missionId: missionId ?? null, clientId: patch.clientId ?? null, siteId: patch.siteId ?? null,
        driverId: who.driverId ?? null, userId: who.userId ?? null,
        latitude: who.latitude ?? patch.latitude ?? null, longitude: who.longitude ?? patch.longitude ?? null,
        notes: who.notes ?? '', at,
      } as Parameters<typeof db.containerEvent.create>[0]['data'],
    })
    applied.push(e)
  }
  return applied
}

/**
 * Field status of a plan step → bin movements. Called in the same transaction as the status write,
 * so a bin never says "at the customer" for a pose that was not recorded (or the reverse).
 */
export async function onStepStatus(db: ContainerDb, p: {
  driverId:    string
  stepId:      string
  status:      string
  planStepIds: string[]
  doneStepIds: Set<string>
  at:          Date
  latitude?:   number
  longitude?:  number
}): Promise<ContainerEffect[]> {
  const who: Who = { driverId: p.driverId, latitude: p.latitude, longitude: p.longitude, at: p.at }
  const moved: ContainerEffect[] = []
  const synth = syntheticStepKind(p.stepId)

  if (p.status === 'en_route' && synth.kind === null) {
    const m = await db.mission.findFirst({ where: { id: p.stepId }, select: MISSION_FIELDS })
    if (m) moved.push(...await applyEffects(db, effectsOnDeparture(m as MissionForContainers, p.driverId), who, m.id))
    return moved
  }
  if (p.status !== 'done') return moved

  if (synth.kind === 'DUMP') {
    // Everything this driver carries is emptied: one rotation more for each bin.
    const onTruck = await db.container.findMany({ where: { driverId: p.driverId, status: 'IN_TRANSIT' }, select: { id: true } })
    await applyEffects(db, onTruck.map(c => ({
      containerId: c.id, to: 'IN_TRANSIT' as const, event: 'EMPTIED' as const,
      patch: { materialId: null, lastRotationAt: p.at },
    })), who)
  } else if (synth.kind === 'REPOSE' && synth.missionId) {
    const m = await db.mission.findFirst({ where: { id: synth.missionId }, select: MISSION_FIELDS })
    if (m?.collectedContainerId) {
      moved.push(...await applyEffects(db, [{
        containerId: m.collectedContainerId, to: 'AT_CUSTOMER', event: 'PLACED',
        patch: { clientId: m.clientId, siteId: m.siteId, latitude: m.latitude, longitude: m.longitude, locationLabel: '', driverId: null, missionId: null, placedAt: p.at },
      }], who, m.id))
    }
  } else if (synth.kind === null) {
    const m = await db.mission.findFirst({ where: { id: p.stepId }, select: MISSION_FIELDS })
    if (m) moved.push(...await applyEffects(db, effectsOnDone(m as MissionForContainers, p.driverId), who, m.id))
  }

  // Last step of the tour done: what is still on the truck goes back to the depot.
  const remaining = p.planStepIds.filter(id => syntheticStepKind(id).kind !== 'BREAK' && !p.doneStepIds.has(id))
  if (remaining.length === 0) {
    const driver = await db.driver.findFirst({ where: { id: p.driverId }, select: { depotName: true, depotLat: true, depotLng: true } })
    const onTruck = await db.container.findMany({ where: { driverId: p.driverId, status: 'IN_TRANSIT' }, select: { id: true } })
    await applyEffects(db, onTruck.map(c => ({
      containerId: c.id, to: 'AVAILABLE' as const, event: 'RETURNED' as const,
      patch: { driverId: null, missionId: null, clientId: null, siteId: null, locationLabel: driver?.depotName ?? 'Dépôt', latitude: driver?.depotLat ?? null, longitude: driver?.depotLng ?? null },
    })), who)
  }
  return moved
}

/** Manual status change, only along the allowed transitions (lifecycle.ts). */
export async function setStatus(db: ContainerDb, id: string, to: ContainerStatus, userId: string, notes = ''): Promise<void> {
  const c = await db.container.findFirst({ where: { id }, select: { id: true, status: true } })
  if (!c) throw new ApiError(404, 'Contenant introuvable', 'NOT_FOUND')
  const from = c.status as ContainerStatus
  if (from === to) return
  if (!canSetManually(from, to)) {
    throw new ApiError(422, `Passage « ${STATUS_LABEL[from]} » → « ${STATUS_LABEL[to]} » impossible à la main : il découle des missions`, 'TRANSITION')
  }
  const patch: ContainerEffect['patch'] = {}
  if (to === 'AVAILABLE') Object.assign(patch, { driverId: null, missionId: null, clientId: null, siteId: null, placedAt: null })
  await applyEffects(db, [{ containerId: id, to, event: 'STATUS' as ContainerEventType, patch }], { userId, notes })
}

/**
 * Corrects where a bin is (initial inventory, a bin found elsewhere): at a customer's site, or at
 * the depot. Logged as RELOCATED with who did it.
 */
export async function relocate(db: ContainerDb, id: string, to: { clientId?: string | null; siteId?: string | null; latitude?: number | null; longitude?: number | null; locationLabel?: string; placedAt?: Date | null }, userId: string, notes = ''): Promise<void> {
  const c = await db.container.findFirst({ where: { id }, select: { id: true, status: true } })
  if (!c) throw new ApiError(404, 'Contenant introuvable', 'NOT_FOUND')
  if (isOutOfService(c.status as ContainerStatus) && c.status !== 'LOST') {
    throw new ApiError(422, 'Remettre d\'abord le contenant en service', 'TRANSITION')
  }
  const atCustomer = !!(to.siteId || to.clientId)
  await applyEffects(db, [{
    containerId: id, to: atCustomer ? 'AT_CUSTOMER' : 'AVAILABLE', event: 'RELOCATED',
    patch: {
      clientId: to.clientId ?? null, siteId: to.siteId ?? null, latitude: to.latitude ?? null, longitude: to.longitude ?? null,
      locationLabel: to.locationLabel ?? (atCustomer ? '' : 'Dépôt'), driverId: null, missionId: null,
      placedAt: atCustomer ? (to.placedAt ?? new Date()) : null,
    },
  }], { userId, notes, at: new Date() })
  // applyEffects overwrote placedAt with "now"; keep the date given for an existing pose.
  if (atCustomer && to.placedAt) await db.container.update({ where: { id }, data: { placedAt: to.placedAt } })
}

/**
 * Reserves a bin for a pose (POSER/ECHANGER) and records it on the mission; a previous reservation
 * of that mission is released. Refuses bins that are not available or of the wrong size.
 */
export async function reserveForMission(db: ContainerDb, missionId: string, containerId: string | null, userId: string): Promise<void> {
  const m = await db.mission.findFirst({ where: { id: missionId }, select: { id: true, type: true, placedContainerId: true, containerTypeId: true, binSizeM3: true } })
  if (!m) throw new ApiError(404, 'Mission introuvable', 'NOT_FOUND')
  if (m.type !== 'POSER' && m.type !== 'ECHANGER') throw new ApiError(422, 'Seules les poses et les échanges réservent une benne', 'INVALID')
  if (m.placedContainerId && m.placedContainerId !== containerId) {
    const prev = await db.container.findFirst({ where: { id: m.placedContainerId }, select: { id: true, status: true, missionId: true } })
    if (prev && prev.status === 'RESERVED' && prev.missionId === m.id) {
      await applyEffects(db, [{ containerId: prev.id, to: 'AVAILABLE', event: 'RELEASED', patch: { missionId: null } }], { userId }, m.id)
    }
  }
  if (!containerId) {
    await db.mission.update({ where: { id: m.id }, data: { placedContainerId: null } })
    return
  }
  const c = await db.container.findFirst({ where: { id: containerId }, select: { id: true, status: true, missionId: true, typeId: true, number: true, type: { select: { capacityM3: true } } } })
  if (!c) throw new ApiError(404, 'Contenant introuvable', 'NOT_FOUND')
  if (c.status !== 'AVAILABLE' && !(c.status === 'RESERVED' && c.missionId === m.id)) {
    throw new ApiError(422, `La benne ${c.number} n'est pas disponible (${STATUS_LABEL[c.status as ContainerStatus]})`, 'UNAVAILABLE')
  }
  if (m.containerTypeId && m.containerTypeId !== c.typeId) throw new ApiError(422, `La benne ${c.number} n'est pas du type demandé`, 'WRONG_TYPE')
  if (m.binSizeM3 && Math.abs(c.type.capacityM3 - m.binSizeM3) > 0.01) throw new ApiError(422, `La benne ${c.number} fait ${c.type.capacityM3} m³, la mission demande ${m.binSizeM3} m³`, 'WRONG_SIZE')
  await db.mission.update({ where: { id: m.id }, data: { placedContainerId: c.id, containerTypeId: c.typeId } })
  if (c.status !== 'RESERVED') {
    await applyEffects(db, [{ containerId: c.id, to: 'RESERVED', event: 'RESERVED', patch: { missionId: m.id } }], { userId }, m.id)
  }
}

/** A cancelled/archived pose frees the bin it had reserved (nothing to do when none). */
export async function releaseMissionReservation(db: ContainerDb, missionId: string, userId = 'system'): Promise<void> {
  const reserved = await db.container.findMany({ where: { missionId, status: 'RESERVED' }, select: { id: true } })
  if (reserved.length === 0) return
  await applyEffects(db, reserved.map(c => ({ containerId: c.id, to: 'AVAILABLE' as const, event: 'RELEASED' as const, patch: { missionId: null } })), { userId, notes: 'Mission annulée' }, missionId)
}
