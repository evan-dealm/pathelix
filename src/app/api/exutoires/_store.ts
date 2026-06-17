import type { Exutoire } from '@/lib/types'
import { getMockExutoires } from '@/lib/mockData'

let _map: Map<string, Exutoire> | null = null

function ensureMap(): Map<string, Exutoire> {
  if (!_map) {
    _map = new Map<string, Exutoire>()
    for (const ex of getMockExutoires()) {
      _map.set(ex.id, ex)
    }
  }
  return _map
}

export function getExutoireStore(): Exutoire[] {
  return Array.from(ensureMap().values())
}

export function findExutoire(id: string): Exutoire | undefined {
  return ensureMap().get(id)
}

export function addExutoire(exutoire: Exutoire): void {
  ensureMap().set(exutoire.id, exutoire)
}

export function updateExutoire(id: string, data: Partial<Exutoire>): Exutoire | null {
  const map = ensureMap()
  const existing = map.get(id)
  if (!existing) return null
  const updated = { ...existing, ...data }
  map.set(id, updated)
  return updated
}

export function deleteExutoire(id: string): boolean {
  return ensureMap().delete(id)
}
