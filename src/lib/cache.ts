interface CacheEntry<V> {
  value:     V
  expiresAt: number
}

export class TtlCache<K, V> {
  private readonly store    = new Map<K, CacheEntry<V>>()
  private readonly defaultTtlMs: number
  private readonly _inflight = new Map<K, Promise<V>>()

  constructor(defaultTtlMs: number) {
    this.defaultTtlMs = defaultTtlMs
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: K, value: V, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  delete(key: K): boolean {
    return this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  size(): number {
    const now = Date.now()
    let count = 0
    for (const entry of this.store.values()) {
      if (entry.expiresAt > now) count++
    }
    return count
  }

  invalidate(predicate: (_key: K) => boolean): void {
    for (const key of this.store.keys()) {
      if (predicate(key)) this.store.delete(key)
    }
  }

  purge(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key)
        removed++
      }
    }
    return removed
  }

  async getOrSet(key: K, factory: () => Promise<V>, ttlMs?: number): Promise<V> {

    const entry = this.store.get(key)
    if (entry && Date.now() <= entry.expiresAt) return entry.value

    const inflight = this._inflight.get(key)
    if (inflight) return inflight

    const promise = factory().then(value => {
      this.set(key, value, ttlMs)
      this._inflight.delete(key)
      return value
    }).catch(err => {
      this._inflight.delete(key)
      throw err
    })

    this._inflight.set(key, promise)
    return promise
  }
}
