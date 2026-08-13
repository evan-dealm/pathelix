import type { Driver } from '@/lib/types'
import { getMockDrivers } from '@/lib/mockData'

let _store: Driver[] | null = null

export function getDriverStore(): Driver[] {
  if (!_store) _store = getMockDrivers()
  return _store
}
