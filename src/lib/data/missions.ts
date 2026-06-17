import type { Mission } from '@/lib/types'
import type { MissionInput } from '@/lib/schemas'
import { prismaRowToMission } from '@/lib/prismaMappers'
import { getMissionStore } from '@/app/api/missions/_store'
import prisma from '@/lib/db'

const useMock = process.env.USE_MOCK_DATA !== 'false'

function flattenTimeWindow(data: Partial<MissionInput>): Record<string, unknown> {
  const { timeWindow, ...rest } = data
  return {
    ...rest,
    ...(timeWindow !== undefined
      ? { timeWindowOpenMin: timeWindow.openMin, timeWindowCloseMin: timeWindow.closeMin }
      : {}),
  }
}

const DEFAULT_PAGE_SIZE = 2000
const MAX_PAGE_SIZE = 10_000

export interface GetAllMissionsOptions {

  date?: string

  take?: number

  skip?: number
}

export async function getAllMissions(
  tenantId: string,
  options: GetAllMissionsOptions = {},
): Promise<Mission[]> {
  const take = Math.min(options.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const skip = options.skip ?? 0

  if (useMock) {
    let filtered = getMissionStore().filter(m => !m.archived)
    if (options.date) filtered = filtered.filter(m => m.date === options.date)
    return filtered.slice(skip, skip + take)
  }

  const where: Record<string, unknown> = { tenantId, archived: false }
  if (options.date) where.date = options.date

  const rows = await prisma.mission.findMany({
    where:   where as NonNullable<Parameters<typeof prisma.mission.findMany>[0]>['where'],
    select:  MISSION_LIST_SELECT,
    orderBy: { date: 'asc' },
    take,
    skip,
  })
  return rows.map(r => prismaRowToMission(r as unknown as Record<string, unknown>))
}

const MISSION_SELECT = {
  id: true, type: true, date: true, address: true,
  latitude: true, longitude: true, estimatedDurationMin: true, maneuverTimeMin: true,
  clientName: true, outletName: true, wasteTypeLabel: true,
  binSize: true, binSizeM3: true, priority: true,
  timeWindowOpenMin: true, timeWindowCloseMin: true,
  linkedExutoireId: true, archived: true, dependsOnId: true,
  clientId: true, siteId: true, productId: true,
  equipmentType: true, accessNotes: true, voucherDelivered: true,
  notes: true, tags: true, requiredSkills: true, externalRef: true,
  needsGeocode: true,

  actualDurationMin: true, actualDistanceKm: true,
  completedAt: true, cancelledAt: true, cancelReason: true,
  driverComment: true, signatureUrl: true,
} as const

// List view: omits detail-only fields (actualDurationMin, signatureUrl, dependsOnId)
const MISSION_LIST_SELECT = {
  id: true, type: true, date: true, address: true,
  latitude: true, longitude: true, estimatedDurationMin: true, maneuverTimeMin: true,
  clientName: true, outletName: true, wasteTypeLabel: true,
  binSize: true, binSizeM3: true, priority: true,
  timeWindowOpenMin: true, timeWindowCloseMin: true,
  linkedExutoireId: true, archived: true,
  clientId: true, siteId: true, productId: true,
  equipmentType: true, accessNotes: true, voucherDelivered: true,
  notes: true, tags: true, requiredSkills: true, externalRef: true,
  needsGeocode: true,
  actualDistanceKm: true,
  completedAt: true, cancelledAt: true, cancelReason: true,
  driverComment: true,
} as const

export async function getMissionsByDate(tenantId: string, date: string): Promise<Mission[]> {
  if (useMock) {
    return getMissionStore().filter(m => !m.archived && m.date === date)
  }

  const rows = await prisma.mission.findMany({
    where:   { tenantId, date, archived: false },
    select:  MISSION_LIST_SELECT,
    orderBy: { priority: 'asc' },
  })
  return rows.map(r => prismaRowToMission(r as unknown as Record<string, unknown>))
}

export async function getMission(tenantId: string, id: string): Promise<Mission | null> {
  if (useMock) {
    return getMissionStore().find(m => m.id === id) ?? null
  }
  const row = await prisma.mission.findFirst({
    where:  { id, tenantId },
    select: MISSION_SELECT,
  })
  return row ? prismaRowToMission(row as unknown as Record<string, unknown>) : null
}

export async function createMission(tenantId: string, data: MissionInput): Promise<Mission> {
  if (useMock) {
    const mission: Mission = { id: crypto.randomUUID(), ...data }
    getMissionStore().push(mission)
    return mission
  }
  const flat = flattenTimeWindow(data)
  const row  = await prisma.mission.create({
    data: { tenantId, ...flat } as Parameters<typeof prisma.mission.create>[0]['data'],
  })
  return prismaRowToMission(row as unknown as Record<string, unknown>)
}

export async function updateMission(
  tenantId: string,
  id:       string,
  data:     Partial<MissionInput>,
): Promise<Mission | null> {
  if (useMock) {
    const store = getMissionStore()
    const idx   = store.findIndex(m => m.id === id)
    if (idx === -1) return null
    const { timeWindow, ...rest } = data
    store[idx] = { ...store[idx], ...rest, ...(timeWindow !== undefined ? { timeWindow } : {}) }
    return store[idx]
  }
  try {

    const row = await prisma.mission.update({
      where: { id, tenantId },
      data:  flattenTimeWindow(data) as Parameters<typeof prisma.mission.update>[0]['data'],
    })
    return prismaRowToMission(row as unknown as Record<string, unknown>)
  } catch (err) {

    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') return null
    throw err
  }
}

export async function deleteMission(tenantId: string, id: string): Promise<boolean> {
  if (useMock) {
    const store = getMissionStore()
    const idx   = store.findIndex(m => m.id === id)
    if (idx === -1) return false
    store[idx] = { ...store[idx], archived: true }
    return true
  }
  try {
    const result = await prisma.mission.updateMany({
      where: { id, tenantId },
      data:  { archived: true },
    })
    return result.count > 0
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') return false
    throw err
  }
}
