import type { Exutoire } from '@/lib/types'
import type { ExutoireInput } from '@/lib/schemas'
import { prismaRowToExutoire } from '@/lib/prismaMappers'
import {
  getExutoireStore,
  findExutoire,
  addExutoire,
  updateExutoire as mockUpdate,
  deleteExutoire as mockDelete,
} from '@/app/api/exutoires/_store'
import { getTenantDb } from '@/lib/tenantDb'

const useMock = process.env.USE_MOCK_DATA !== 'false'

const EXUTOIRE_LIST_SELECT = {
  id: true, name: true, address: true, lat: true, lng: true,
  openingHoursOpen: true, openingHoursClose: true,
  closedDays: true, acceptedWasteTypes: true,
  serviceTimeMin: true,
} as const

export async function getAllExutoires(tenantId: string): Promise<Exutoire[]> {
  if (useMock) {
    return getExutoireStore()
  }
  const rows = await getTenantDb(tenantId).exutoire.findMany({
    select:  EXUTOIRE_LIST_SELECT,
    orderBy: { name: 'asc' },
  })
  return rows.map(r => prismaRowToExutoire(r as unknown as Record<string, unknown>))
}

export async function getExutoire(tenantId: string, id: string): Promise<Exutoire | null> {
  if (useMock) {
    return findExutoire(id) ?? null
  }
  const row = await getTenantDb(tenantId).exutoire.findFirst({ where: { id } })
  return row ? prismaRowToExutoire(row as unknown as Record<string, unknown>) : null
}

export async function createExutoire(tenantId: string, data: ExutoireInput): Promise<Exutoire> {
  if (useMock) {
    const exutoire: Exutoire = { id: crypto.randomUUID(), ...data }
    addExutoire(exutoire)
    return exutoire
  }
  const db  = getTenantDb(tenantId)
  const row = await db.exutoire.create({
    data: {
      ...data,
    } as Parameters<typeof db.exutoire.create>[0]['data'],
  })
  return prismaRowToExutoire(row as unknown as Record<string, unknown>)
}

export async function updateExutoire(
  tenantId: string,
  id:       string,
  data:     Partial<ExutoireInput>,
): Promise<Exutoire | null> {
  if (useMock) {
    return mockUpdate(id, data)
  }
  try {

    const db  = getTenantDb(tenantId)
    const row = await db.exutoire.update({
      where: { id },
      data:  data as Parameters<typeof db.exutoire.update>[0]['data'],
    })
    return prismaRowToExutoire(row as unknown as Record<string, unknown>)
  } catch (err) {

    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') return null
    throw err
  }
}

export async function deleteExutoire(tenantId: string, id: string): Promise<boolean> {
  if (useMock) {
    return mockDelete(id)
  }
  try {

    return await getTenantDb(tenantId).$transaction(async (tx) => {

      const existing = await tx.exutoire.findFirst({ where: { id } })
      if (!existing) return false

      await Promise.all([
        tx.siteProduct.updateMany({ where: { defaultExutoireId: id }, data: { defaultExutoireId: null } }),
        tx.mission.updateMany({ where: { linkedExutoireId: id }, data: { linkedExutoireId: null } }),
      ])

      await tx.exutoire.delete({ where: { id } })
      return true
    })
  } catch (err) {

    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') return false
    throw err
  }
}
