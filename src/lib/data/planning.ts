import type { Driver, Mission } from '@/lib/types'
import { getTenantDb } from '@/lib/tenantDb'
import { prismaRowToDriver } from '@/lib/prismaMappers'
import { getAllDrivers } from './drivers'
import { vehicleBlockers } from '@/lib/fleet/maintenance'

const useMock = process.env.USE_MOCK_DATA !== 'false'

export type ExclusionReason = 'DRIVER_UNAVAILABLE' | 'VEHICLE_UNAVAILABLE'

export interface ExcludedDriver {
  driverId: string
  name: string
  reason: ExclusionReason
  detail: string
}

const VEHICLE_SELECT = {
  id: true,
  status: true,
  archived: true,
  maxBins: true,
  weightTon: true,
  heightM: true,
  widthM: true,
  lengthM: true,
  axleCount: true,
  hazmat: true,
  tareKg: true,
  payloadKg: true,
  licensePlate: true,
  mileageKm: true,
  nextInspection: true,
  insuranceExpiry: true,
} as const

/**
 * Drivers that can actually work on `date`: not archived, not on leave (DriverUnavailability),
 * with a valid licence, and with a truck that is not immobilised (status "active", no
 * VehicleUnavailability that day, no overdue CT / tachograph / insurance, no open critical
 * defect — see lib/fleet/maintenance). A driver without any truck on record is kept — the tenant may not track vehicles. The
 * truck used is the first available one: its gabarit and weight limits feed the optimiser.
 */
export async function getPlanningDrivers(
  tenantId: string,
  date: string,
): Promise<{ drivers: Driver[]; excluded: ExcludedDriver[] }> {
  if (useMock)
    return { drivers: (await getAllDrivers(tenantId)).filter(d => !d.archived), excluded: [] }

  const db = getTenantDb(tenantId)
  const [rows, leaves, vehicleDowns, plans, defects] = await Promise.all([
    db.driver.findMany({
      where: { archived: false },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        sector: true,
        depotName: true,
        depotLat: true,
        depotLng: true,
        maxBinSizeM3: true,
        vehicleCapacity: true,
        notes: true,
        skills: true,
        weeklyHoursMax: true,
        phone: true,
        archived: true,
        startingExutoireId: true,
        email: true,
        employeeNumber: true,
        hiredAt: true,
        birthDate: true,
        licenseExpiry: true,
        licenseCategories: true,
        emergencyContact: true,
        color: true,
        vehicles: {
          where: { archived: false },
          select: VEHICLE_SELECT,
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    db.driverUnavailability.findMany({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      select: { driverId: true, reason: true },
    }),
    db.vehicleUnavailability.findMany({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      select: { vehicleId: true, reason: true },
    }),
    db.maintenancePlan.findMany({
      where: { active: true, kind: { in: ['CT', 'TACHOGRAPH', 'INSURANCE'] } },
      select: {
        vehicleId: true,
        kind: true,
        label: true,
        everyKm: true,
        everyMonths: true,
        lastDoneAt: true,
        lastDoneKm: true,
        dueDate: true,
        warnDays: true,
        warnKm: true,
        active: true,
      },
    }),
    db.vehicleDefect.findMany({
      where: { severity: 'CRITICAL', status: { in: ['OPEN', 'IN_REPAIR'] } },
      select: { vehicleId: true, severity: true, status: true, description: true },
    }),
  ])

  const onLeave = new Map(leaves.map(l => [l.driverId, l.reason]))
  const downVehicles = new Map(vehicleDowns.map(v => [v.vehicleId, v.reason]))
  const plansOf = (id: string) => plans.filter(p => p.vehicleId === id)
  const defectsOf = (id: string) => defects.filter(d => d.vehicleId === id)
  for (const v of rows.flatMap(r => r.vehicles)) {
    const why = vehicleBlockers(v, plansOf(v.id), defectsOf(v.id), date)
    if (why.length && !downVehicles.has(v.id)) downVehicles.set(v.id, why.join(' ; '))
  }
  const drivers: Driver[] = []
  const excluded: ExcludedDriver[] = []

  for (const r of rows) {
    const name = `${r.firstName} ${r.lastName}`.trim()
    const leave = onLeave.get(r.id)
    if (leave !== undefined) {
      excluded.push({
        driverId: r.id,
        name,
        reason: 'DRIVER_UNAVAILABLE',
        detail: leave || 'indisponible',
      })
      continue
    }
    const licence = r.licenseExpiry ? r.licenseExpiry.toISOString().slice(0, 10) : null
    if (licence && licence < date) {
      excluded.push({
        driverId: r.id,
        name,
        reason: 'DRIVER_UNAVAILABLE',
        detail: `permis expiré le ${licence.split('-').reverse().join('/')}`,
      })
      continue
    }
    const vehicles = r.vehicles
    const usable = vehicles.filter(v => v.status === 'active' && !downVehicles.has(v.id))
    if (vehicles.length > 0 && usable.length === 0) {
      const v = vehicles[0]
      const why = downVehicles.get(v.id) ?? (v.status === 'maintenance' ? 'maintenance' : v.status)
      excluded.push({
        driverId: r.id,
        name,
        reason: 'VEHICLE_UNAVAILABLE',
        detail: `${v.licensePlate} : ${why}`,
      })
      continue
    }
    drivers.push(
      prismaRowToDriver({ ...r, vehicles: usable.slice(0, 1) } as unknown as Record<
        string,
        unknown
      >),
    )
  }
  return { drivers, excluded }
}

/** Message shown with an optimisation result for each driver left out. */
export function exclusionMessage(e: ExcludedDriver): string {
  // `detail` carries stored reason codes (conge, breakdown…): the dispatcher reads words.
  const detail = e.detail.replace(
    /\b(conge|maladie|formation|autre|maintenance|inspection|breakdown|other|decommissioned)\b/g,
    code => REASON_LABEL[code] ?? code,
  )
  return e.reason === 'DRIVER_UNAVAILABLE'
    ? `${e.name} n'est pas planifié : indisponible (${detail})`
    : `${e.name} n'est pas planifié : camion immobilisé (${detail})`
}

const REASON_LABEL: Record<string, string> = {
  conge: 'congé',
  maladie: 'maladie',
  formation: 'formation',
  autre: 'autre motif',
  maintenance: 'en maintenance',
  inspection: 'contrôle technique',
  breakdown: 'panne',
  other: 'autre motif',
  decommissioned: 'retiré du parc',
}

interface MaterialRow {
  id: string
  name: string
  densityKgM3: number | null
  fillFactor: number
  uncertaintyPct: number
}

/**
 * Weight estimate for missions whose content weight is unknown: density × bin volume × fill
 * ratio of their material (by materialId, else by waste label), with its uncertainty. Missions
 * with a weighed/declared weight, no volume or no known density are left as they are — the
 * optimiser then has no weight for them, rather than a made-up one.
 */
export function estimateWeights(missions: Mission[], materials: MaterialRow[]): Mission[] {
  if (materials.length === 0) return missions
  const byId = new Map(materials.map(m => [m.id, m]))
  const byName = new Map(materials.map(m => [m.name.trim().toLowerCase(), m]))
  return missions.map(m => {
    if (m.weightKg !== undefined || !m.binSizeM3) return m
    const mat =
      (m.materialId && byId.get(m.materialId)) ||
      (m.wasteTypeLabel && byName.get(m.wasteTypeLabel.trim().toLowerCase()))
    if (!mat || mat.densityKgM3 === null || mat.densityKgM3 <= 0) return m
    const kg = mat.densityKgM3 * m.binSizeM3 * Math.min(1, Math.max(0, mat.fillFactor))
    return {
      ...m,
      weightKg: Math.round(kg),
      weightSource: 'ESTIMATED' as const,
      weightUncertaintyKg: Math.round(kg * Math.max(0, mat.uncertaintyPct)),
    }
  })
}

export async function withEstimatedWeights(
  tenantId: string,
  missions: Mission[],
): Promise<Mission[]> {
  if (useMock || missions.length === 0) return missions
  const materials = await getTenantDb(tenantId).material.findMany({
    where: { archived: false },
    select: { id: true, name: true, densityKgM3: true, fillFactor: true, uncertaintyPct: true },
  })
  return estimateWeights(missions, materials)
}
