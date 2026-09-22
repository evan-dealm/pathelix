import type { Driver } from '@/lib/types'
import type { DriverInput } from '@/lib/schemas'
import { prismaRowToDriver } from '@/lib/prismaMappers'
import { getDriverStore } from '@/app/api/drivers/_store'
import { getTenantDb } from '@/lib/tenantDb'

const useMock = process.env.USE_MOCK_DATA !== 'false'

const DRIVER_SELECT = {
  id: true, firstName: true, lastName: true, sector: true,
  depotName: true, depotLat: true, depotLng: true,
  maxBinSizeM3: true, vehicleCapacity: true, notes: true,
  skills: true, weeklyHoursMax: true, phone: true, archived: true,
  startingExutoireId: true,

  email: true, employeeNumber: true, hiredAt: true, birthDate: true,
  licenseExpiry: true, licenseCategories: true, emergencyContact: true, color: true,

  // Only the fields prismaRowToDriver actually reads off v = vehicles?.[0] — the unfiltered
  // select previously returned every Vehicle column (licensePlate, insuranceExpiry, etc.) on
  // every driver list/get call.
  vehicles: {
    where: { archived: false },
    take: 1,
    select: { maxBins: true, weightTon: true, heightM: true, widthM: true, lengthM: true, axleCount: true, hazmat: true },
  },

  // startingExutoireId (scalar, above) is what the mapper reads — this joined object was never
  // consumed, just a wasted join on every driver list/get call.
} as const

export async function getAllDrivers(tenantId: string): Promise<Driver[]> {
  if (useMock) {
    return getDriverStore().filter(d => !d.archived)
  }
  const rows = await getTenantDb(tenantId).driver.findMany({
    where:   { archived: false },
    select:  DRIVER_SELECT,
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(r => prismaRowToDriver(r as unknown as Record<string, unknown>))
}

export async function getDriver(tenantId: string, id: string): Promise<Driver | null> {
  if (useMock) {
    return getDriverStore().find(d => d.id === id) ?? null
  }
  const row = await getTenantDb(tenantId).driver.findFirst({
    where:  { id },
    select: DRIVER_SELECT,
  })
  return row ? prismaRowToDriver(row as unknown as Record<string, unknown>) : null
}

export async function createDriver(tenantId: string, data: DriverInput): Promise<Driver> {
  if (useMock) {
    const driver: Driver = { id: crypto.randomUUID(), ...data }
    getDriverStore().push(driver)
    return driver
  }
  const db  = getTenantDb(tenantId)
  const row = await db.driver.create({
    data: { ...data } as Parameters<typeof db.driver.create>[0]['data'],
  })
  return prismaRowToDriver(row as unknown as Record<string, unknown>)
}

export async function updateDriver(
  tenantId: string,
  id:       string,
  data:     Partial<DriverInput>,
): Promise<Driver | null> {
  if (useMock) {
    const store = getDriverStore()
    const idx   = store.findIndex(d => d.id === id)
    if (idx === -1) return null
    store[idx] = { ...store[idx], ...data }
    return store[idx]
  }
  try {
    const db  = getTenantDb(tenantId)
    const row = await db.driver.update({
      where: { id },
      data:  data as Parameters<typeof db.driver.update>[0]['data'],
    })
    return prismaRowToDriver(row as unknown as Record<string, unknown>)
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') return null
    throw err
  }
}

export async function deleteDriver(tenantId: string, id: string): Promise<boolean> {
  if (useMock) {
    const store = getDriverStore()
    const idx   = store.findIndex(d => d.id === id)
    if (idx === -1) return false
    store[idx] = { ...store[idx], archived: true }
    return true
  }
  try {
    const updated = await getTenantDb(tenantId).driver.updateMany({
      where: { id },
      data:  { archived: true },
    })
    return updated.count > 0
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') return false
    throw err
  }
}
