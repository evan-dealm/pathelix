import type { TenantDb } from '@/lib/tenantDb'
import type { ScanMission, ScannedContainer } from './scan'

/** What the driver app needs per mission to check a scanned bin, even offline. */
export interface DriverMissionContainers {
  mission:    ScanMission
  expected?:  { typeName: string; capacityM3: number }
  placed?:    ScannedContainer & { token: string }
  collected?: ScannedContainer & { token: string }
  /** Bins recorded at this mission's site (candidates for a pickup). */
  onSite:     Array<ScannedContainer & { token: string }>
}

const CONTAINER_SELECT = {
  id: true, number: true, qrToken: true, typeId: true, status: true, siteId: true, clientId: true, missionId: true, driverId: true,
  type: { select: { name: true, capacityM3: true } },
} as const

type Row = { id: string; number: string; qrToken: string; typeId: string; status: string; siteId: string | null; clientId: string | null; missionId: string | null; driverId: string | null; type: { name: string; capacityM3: number } }

function toScanned(r: Row): ScannedContainer & { token: string } {
  return {
    id: r.id, number: r.number, token: r.qrToken, typeId: r.typeId, typeName: r.type.name, capacityM3: r.type.capacityM3,
    status: r.status, siteId: r.siteId, clientId: r.clientId, missionId: r.missionId, driverId: r.driverId,
  }
}

/**
 * Container context of the real missions of a driver's plan, read from the missions themselves
 * (the plan JSON is a snapshot taken at optimisation time; reservations made later live on the
 * mission rows).
 */
export async function driverContainerInfo(db: TenantDb, missionIds: string[]): Promise<Record<string, DriverMissionContainers>> {
  if (missionIds.length === 0) return {}
  const missions = await db.mission.findMany({
    where: { id: { in: missionIds } },
    select: {
      id: true, type: true, containerTypeId: true, binSizeM3: true, placedContainerId: true, collectedContainerId: true,
      siteId: true, clientId: true, containerType: { select: { name: true, capacityM3: true } },
    },
  })
  const siteIds = [...new Set(missions.map(m => m.siteId).filter((x): x is string => !!x))]
  const linked = [...new Set(missions.flatMap(m => [m.placedContainerId, m.collectedContainerId]).filter((x): x is string => !!x))]
  const containers = await db.container.findMany({
    where: { OR: [{ id: { in: linked } }, { siteId: { in: siteIds }, status: { in: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'] } }] },
    select: CONTAINER_SELECT,
  }) as Row[]
  const byId = new Map(containers.map(c => [c.id, c]))
  const out: Record<string, DriverMissionContainers> = {}
  for (const m of missions) {
    out[m.id] = {
      mission: { id: m.id, type: m.type, containerTypeId: m.containerTypeId, binSizeM3: m.binSizeM3, placedContainerId: m.placedContainerId, collectedContainerId: m.collectedContainerId, siteId: m.siteId, clientId: m.clientId },
      expected: m.containerType ? { typeName: m.containerType.name, capacityM3: m.containerType.capacityM3 } : undefined,
      placed: m.placedContainerId && byId.get(m.placedContainerId) ? toScanned(byId.get(m.placedContainerId)!) : undefined,
      collected: m.collectedContainerId && byId.get(m.collectedContainerId) ? toScanned(byId.get(m.collectedContainerId)!) : undefined,
      onSite: m.siteId ? containers.filter(c => c.siteId === m.siteId && c.status !== 'ARCHIVED').map(toScanned) : [],
    }
  }
  return out
}
