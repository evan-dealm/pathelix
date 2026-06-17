import type { Mission } from '@/lib/types'

export function buildWarmStartFromReference(
  missions: Mission[],
  referencePlan: Array<{ missionId: string; siteId?: string; clientId?: string; type: string; driverId: string }>,
): {

  existingPlans: Record<string, string[]>

  newMissions: Mission[]
} {
  const existingPlans: Record<string, string[]> = {}
  const matched = new Set<string>()

  const bySiteType = new Map<string, Mission[]>()
  const byClientType = new Map<string, Mission[]>()

  for (const m of missions) {
    if (m.siteId) {
      const key = `${m.siteId}:${m.type}`
      if (!bySiteType.has(key)) bySiteType.set(key, [])
      bySiteType.get(key)!.push(m)
    }
    if (m.clientId) {
      const key = `${m.clientId}:${m.type}`
      if (!byClientType.has(key)) byClientType.set(key, [])
      byClientType.get(key)!.push(m)
    }
  }

  for (const arr of bySiteType.values()) arr.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const arr of byClientType.values()) arr.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  for (const ref of referencePlan) {
    if (!ref.driverId) continue
    let matchedMission: Mission | undefined

    if (ref.siteId) {
      const candidates = bySiteType.get(`${ref.siteId}:${ref.type}`)
      if (candidates) {
        matchedMission = candidates.find(m => !matched.has(m.id))
      }
    }

    if (!matchedMission && ref.clientId) {
      const candidates = byClientType.get(`${ref.clientId}:${ref.type}`)
      if (candidates) {
        matchedMission = candidates.find(m => !matched.has(m.id))
      }
    }

    if (matchedMission) {
      matched.add(matchedMission.id)
      if (!existingPlans[ref.driverId]) existingPlans[ref.driverId] = []
      existingPlans[ref.driverId].push(matchedMission.id)
    }
  }

  const newMissions = missions.filter(m => !matched.has(m.id))

  return { existingPlans, newMissions }
}
