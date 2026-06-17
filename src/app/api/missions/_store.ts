import type { Mission } from '@/lib/types'
import { getMockMissions } from '@/lib/mockData'

let _store: Mission[] | null = null

export function getMissionStore(): Mission[] {
  if (!_store) _store = getMockMissions()
  return _store
}

export function addMission(m: Mission): void {
  getMissionStore().push(m)
}
