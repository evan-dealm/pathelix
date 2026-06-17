const CACHE_MAX = 50_000

interface CacheEntry {
  cost: number
  routeHash: string
}

export class InsertionCache {
  private cache = new Map<string, CacheEntry>()
  private hits = 0
  private misses = 0

  private key(routeIdx: number, missionId: string, pos: number, routeH?: string): string {
    return routeH ? `${routeIdx}:${routeH}:${missionId}:${pos}` : `${routeIdx}:${missionId}:${pos}`
  }

  routeHash(missions: Array<{ id: string }>): string {

    let h = 2166136261
    for (const m of missions) {
      for (let i = 0; i < m.id.length; i++) {
        h ^= m.id.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
    }
    return (h >>> 0).toString(36)
  }

  get(routeIdx: number, routeH: string, missionId: string, pos: number): number | undefined {
    const k = this.key(routeIdx, missionId, pos, routeH)
    const entry = this.cache.get(k)
    if (entry && entry.routeHash === routeH) {
      this.hits++
      return entry.cost
    }
    this.misses++
    return undefined
  }

  set(routeIdx: number, routeH: string, missionId: string, pos: number, cost: number): void {
    const k = this.key(routeIdx, missionId, pos, routeH)
    this.cache.set(k, { cost, routeHash: routeH })

    if (this.cache.size > CACHE_MAX) {
      const first = this.cache.keys().next().value
      if (first !== undefined) this.cache.delete(first)
    }
  }

  invalidateRoute(_routeIdx: number): void {

  }

  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  stats(): { hits: number; misses: number; size: number; hitRate: string } {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : 'N/A',
    }
  }
}

export interface FeasibilitySignature {

  totalWorkMin: number

  missionCount: number

  slackMin: number

  binSlack: number
}

export function computeFeasibilitySignature(
  totalWorkMin: number,
  missionCount: number,
  maxWorkMin: number,
  binCapacity: number,
  binsUsed: number,
): FeasibilitySignature {
  return {
    totalWorkMin,
    missionCount,
    slackMin: maxWorkMin - totalWorkMin,
    binSlack: binCapacity - binsUsed,
  }
}

export function canInsertFast(
  sig: FeasibilitySignature,
  missionDurationMin: number,
  missionBins: number = 1,
): boolean {

  if (sig.slackMin < missionDurationMin + 30) return false
  if (sig.binSlack < missionBins) return false
  return true
}
