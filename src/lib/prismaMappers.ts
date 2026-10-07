import type { Mission, Driver, Exutoire } from '@/lib/types'

function requireString(v: unknown, field: string): string {
  if (typeof v === 'string') return v
  throw new Error(`[Prisma mapper] Champ "${field}" attendu string, reçu ${typeof v}`)
}

function requireNumber(v: unknown, field: string): number {
  if (typeof v === 'number') return v
  throw new Error(`[Prisma mapper] Champ "${field}" attendu number, reçu ${typeof v}`)
}

function _optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function _optNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

function _optBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function requireJsonArray<T>(v: unknown, field: string): T[] {
  let arr: unknown[]

  if (Array.isArray(v)) {
    arr = v
  } else if (typeof v === 'string') {

    try {
      const parsed = JSON.parse(v)
      if (!Array.isArray(parsed)) {
        throw new Error(`[Prisma mapper] Champ "${field}" attendu array après JSON.parse, reçu ${typeof parsed}`)
      }
      arr = parsed
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`[Prisma mapper] Champ "${field}" JSON invalide`)
      }
      throw e
    }
  } else {
    throw new Error(`[Prisma mapper] Champ "${field}" attendu array (JSON ou natif), reçu ${typeof v}`)
  }
  return arr as T[]
}

export function prismaRowToMission(row: Record<string, unknown>): Mission {
  if (process.env.NODE_ENV === 'development') {
    if (typeof row.id !== 'string') throw new Error(`[prismaMapper] Mission.id expected string, got ${typeof row.id}`)
    if (typeof row.type !== 'string') throw new Error(`[prismaMapper] Mission.type expected string, got ${typeof row.type}`)
    if (typeof row.latitude !== 'number') throw new Error(`[prismaMapper] Mission.latitude expected number, got ${typeof row.latitude}`)
  }
  const r = row as Record<string, never>
  const openMin  = r.timeWindowOpenMin as number | null
  const closeMin = r.timeWindowCloseMin as number | null
  return {
    id:                   r.id as string,
    type:                 r.type as Mission['type'],
    date:                 r.date as string,
    address:              r.address as string,
    latitude:             r.latitude as number,
    longitude:            r.longitude as number,
    estimatedDurationMin: r.estimatedDurationMin as number,
    maneuverTimeMin:      (r.maneuverTimeMin as number) || 0,
    clientName:           (r.clientName as string) || undefined,
    outletName:           (r.outletName as string) || undefined,
    wasteTypeLabel:       (r.wasteTypeLabel as string) || undefined,
    binSize:              (r.binSize as string) || undefined,
    binSizeM3:            (r.binSizeM3 as number) ?? undefined,
    accessNotes:          (r.accessNotes as string) || undefined,
    priority:             [1, 2, 3].includes(r.priority as number) ? (r.priority as 1 | 2 | 3) : undefined,
    timeWindow:           openMin !== null && closeMin !== null ? { openMin, closeMin } : undefined,
    linkedExutoireId:     (r.linkedExutoireId as string) || undefined,
    archived:             (r.archived as boolean) ?? false,

    clientId:             (r.clientId as string) || undefined,
    siteId:               (r.siteId as string) || undefined,
    dependsOnId:          (r.dependsOnId as string) || undefined,
    equipmentType:        (r.equipmentType as string) || undefined,
    notes:                (r.notes as string) || undefined,
    tags:                 Array.isArray(r.tags) ? r.tags as string[] : undefined,
    voucherDelivered:     (r.voucherDelivered as boolean) ?? undefined,
    productId:            (r.productId as string) || undefined,
    requiredSkills:       Array.isArray(r.requiredSkills) ? r.requiredSkills as string[] : undefined,
    externalRef:          (r.externalRef as string) || undefined,
    needsGeocode:         (r.needsGeocode as boolean) ?? false,
    weightKg:             (r.weightKg as number | null) ?? undefined,
    weightSource:         (['WEIGHED', 'DECLARED', 'ESTIMATED'] as const).find(v => v === r.weightSource),
    // When the mission was done or cancelled: the office list and API clients need it (it was
    // selected from the database and then dropped here).
    ...(row.completedAt instanceof Date ? { completedAt: row.completedAt.toISOString() } : typeof row.completedAt === 'string' ? { completedAt: row.completedAt } : {}),
    ...(row.cancelledAt instanceof Date ? { cancelledAt: row.cancelledAt.toISOString() } : typeof row.cancelledAt === 'string' ? { cancelledAt: row.cancelledAt } : {}),
    weightUncertaintyKg:  (r.weightUncertaintyKg as number | null) ?? undefined,
    binTareKg:            (r.binTareKg as number | null) ?? undefined,
    materialId:           (r.materialId as string) || undefined,
    containerTypeId:      (r.containerTypeId as string) || undefined,
    placedContainerId:    (r.placedContainerId as string) || undefined,
    collectedContainerId: (r.collectedContainerId as string) || undefined,

    actualDurationMin:    (r.actualDurationMin as number) ?? undefined,
    actualDistanceKm:     (r.actualDistanceKm as number) ?? undefined,
    completedAt:          r.completedAt ? (r.completedAt as Date).toISOString() : undefined,
    cancelledAt:          r.cancelledAt ? (r.cancelledAt as Date).toISOString() : undefined,
    cancelReason:         (r.cancelReason as string) || undefined,
    driverComment:        (r.driverComment as string) || undefined,
    signatureUrl:         (r.signatureUrl as string) || undefined,
  }
}

export function prismaRowToDriver(row: Record<string, unknown>): Driver {
  const r = row as Record<string, never>
  const vc = r.vehicleCapacity as number | null

  const vehicles = r.vehicles as Array<Record<string, unknown>> | undefined
  const v = vehicles?.[0]
  return {
    id:              r.id as string,
    firstName:       r.firstName as string,
    lastName:        r.lastName as string,
    sector:          r.sector as string,
    depotName:       r.depotName as string,
    depotLat:        r.depotLat as number,
    depotLng:        r.depotLng as number,
    maxBinSizeM3:    (r.maxBinSizeM3 as number) ?? undefined,
    vehicleCapacity: vc !== null ? Math.round(vc) : (v?.maxBins !== null && v?.maxBins !== undefined ? Math.round(v.maxBins as number) : undefined),
    archived:        (r.archived as boolean) ?? false,
    vehicleId:       v ? (v.id as string | undefined) : undefined,
    payload:         v && (typeof v.tareKg === 'number' || typeof v.payloadKg === 'number') ? {
      gvwKg:        typeof v.weightTon === 'number' ? Math.round((v.weightTon as number) * 1000) : undefined,
      tareKg:       (v.tareKg as number | null) ?? undefined,
      maxPayloadKg: (v.payloadKg as number | null) ?? undefined,
    } : undefined,
    vehicleDimensions: v ? {
      weightTon: (v.weightTon as number) ?? 26,
      heightM:   (v.heightM as number)   ?? 4.0,
      widthM:    (v.widthM as number)    ?? 2.55,
      lengthM:   (v.lengthM as number)   ?? 12.0,
      axleCount: (v.axleCount as number) ?? 3,
      hazmat:    (v.hazmat as boolean)   ?? false,
    } : undefined,

    phone:           (r.phone as string) || undefined,
    notes:           (r.notes as string) || undefined,
    skills:          Array.isArray(r.skills) ? r.skills as string[] : undefined,
    weeklyHoursMax:  (r.weeklyHoursMax as number) ?? undefined,

    email:             (r.email as string) || undefined,
    employeeNumber:    (r.employeeNumber as string) || undefined,
    hiredAt:           r.hiredAt ? (r.hiredAt as Date).toISOString() : undefined,
    birthDate:         r.birthDate ? (r.birthDate as Date).toISOString() : undefined,
    licenseExpiry:     r.licenseExpiry ? (r.licenseExpiry as Date).toISOString() : undefined,
    licenseCategories: Array.isArray(r.licenseCategories) ? r.licenseCategories as string[] : undefined,
    emergencyContact:  (r.emergencyContact as string) || undefined,
    color:             (r.color as string) || undefined,
    startingExutoireId: (r.startingExutoireId as string) || null,
  }
}

export function prismaRowToExutoire(row: Record<string, unknown>): Exutoire {

  const closedDays         = requireJsonArray<number>(row.closedDays,         'closedDays')
  const acceptedWasteTypes = requireJsonArray<string>(row.acceptedWasteTypes, 'acceptedWasteTypes')

  return {
    id:                 requireString(row.id,      'id'),
    name:               requireString(row.name,    'name'),
    address:            requireString(row.address, 'address'),
    lat:                requireNumber(row.lat,     'lat'),
    lng:                requireNumber(row.lng,     'lng'),
    openingHoursOpen:   requireNumber(row.openingHoursOpen,  'openingHoursOpen'),
    openingHoursClose:  requireNumber(row.openingHoursClose, 'openingHoursClose'),
    closedDays,
    acceptedWasteTypes,
    serviceTimeMin:     requireNumber(row.serviceTimeMin, 'serviceTimeMin'),
    feePerTonneEur:     typeof row.feePerTonneEur === 'number' ? row.feePerTonneEur : null,
  }
}
