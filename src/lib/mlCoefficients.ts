import type { Mission } from '@/lib/types'
import { TtlCache } from '@/lib/cache'
import { createLogger } from '@/lib/logger'

const log = createLogger('mlCoefficients')

export interface MLCoefficients {
  durationCoeff: number
  maneuverCoeff: number
  travelCoeff:   number
  sampleCount:   number
}

interface ProfileRow {
  scope:         string
  scopeId:       string
  missionType:   string
  durationCoeff: number
  maneuverCoeff: number
  travelCoeff:   number
  sampleCount:   number
}

const MIN_SAMPLES = 5

const _cache = new TtlCache<string, ProfileRow[]>(5 * 60_000)

async function loadProfiles(tenantId: string): Promise<ProfileRow[]> {
  return _cache.getOrSet(`ml:${tenantId}`, async () => {

    const prisma = (await import('@/lib/db')).default
    const rows = await prisma.tenantMLProfile.findMany({
      where: { tenantId, sampleCount: { gte: MIN_SAMPLES } },
      select: {
        scope: true, scopeId: true, missionType: true,
        durationCoeff: true, maneuverCoeff: true, travelCoeff: true,
        sampleCount: true,
      },
    })
    return rows.map(r => ({
      ...r,
      missionType: r.missionType ?? '_ALL_',
    }))
  })
}

function findCoeff(
  profiles: ProfileRow[],
  driverId: string,
  siteId: string | undefined,
  missionType: string,
): MLCoefficients {

  const driverType = profiles.find(
    p => p.scope === 'driver' && p.scopeId === driverId && p.missionType === missionType,
  )
  if (driverType) return driverType

  if (siteId) {
    const siteType = profiles.find(
      p => p.scope === 'site' && p.scopeId === siteId && p.missionType === missionType,
    )
    if (siteType) return siteType
  }

  const driverGlobal = profiles.find(
    p => p.scope === 'driver' && p.scopeId === driverId && p.missionType === '_ALL_',
  )
  if (driverGlobal) return driverGlobal

  const typeOnly = profiles.find(
    p => p.scope === 'type' && p.scopeId === missionType && p.missionType === missionType,
  )
  if (typeOnly) return typeOnly

  const global = profiles.find(p => p.scope === 'global')
  if (global) return global

  return { durationCoeff: 1.0, maneuverCoeff: 1.0, travelCoeff: 1.0, sampleCount: 0 }
}

export async function applyMLCoefficients(
  tenantId: string,
  missions: Mission[],
  driverId?: string,
): Promise<Mission[]> {
  const profiles = await loadProfiles(tenantId)

  if (profiles.length === 0) return missions

  let corrected = 0

  const result = missions.map(m => {
    const coeff = findCoeff(profiles, driverId ?? '', m.siteId || undefined, m.type)

    if (coeff.sampleCount < MIN_SAMPLES) return m

    const newDuration  = Math.round(m.estimatedDurationMin * coeff.durationCoeff)
    const newManeuver  = Math.round((m.maneuverTimeMin ?? 0) * coeff.maneuverCoeff)

    const durationChanged = Math.abs(coeff.durationCoeff - 1.0) > 0.05
    const maneuverChanged = Math.abs(coeff.maneuverCoeff - 1.0) > 0.05

    if (!durationChanged && !maneuverChanged) return m

    corrected++
    return {
      ...m,
      estimatedDurationMin: durationChanged ? newDuration : m.estimatedDurationMin,
      maneuverTimeMin:      maneuverChanged ? newManeuver : m.maneuverTimeMin,
    }
  })

  if (corrected > 0) {
    log.info('ML coefficients applied', { tenantId, total: missions.length, corrected })
  }

  return result
}

export async function getTravelCoeff(tenantId: string): Promise<number> {
  const profiles = await loadProfiles(tenantId)
  const global = profiles.find(p => p.scope === 'global')
  if (!global || global.sampleCount < MIN_SAMPLES) return 1.0
  return global.travelCoeff
}

export function invalidateMLCache(tenantId: string): void {
  _cache.delete(`ml:${tenantId}`)
}
