import type { Mission, Driver } from '@/lib/types'

export function isHfvrpCompatible(mission: Mission, driver: Driver): boolean {
  if (!driver.maxBinSizeM3) return true
  if (!mission.binSizeM3) return true
  return mission.binSizeM3 <= driver.maxBinSizeM3
}

export function areAllHfvrpCompatible(missions: Mission[], driver: Driver): boolean {
  if (!driver.maxBinSizeM3) return true
  return missions.every(m => !m.binSizeM3 || m.binSizeM3 <= driver.maxBinSizeM3!)
}
