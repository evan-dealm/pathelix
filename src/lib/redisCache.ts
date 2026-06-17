import { getRedisClient }    from '@/lib/redisClient'
import { TtlCache }          from '@/lib/cache'
import { createLogger }      from '@/lib/logger'

const log = createLogger('redisCache')

export const CACHE_TTL = {
  drivers:     30_000,
  missions:    15_000,
  exutoires:   60_000,
  plans:       10_000,
} as const

export type CacheNamespace = keyof typeof CACHE_TTL

const _localCache = new TtlCache<string, unknown>(50_000)

const _inflight = new Map<string, Promise<unknown>>()

function cacheKey(namespace: string, tenantId: string, qualifier?: string): string {
  return qualifier
    ? `cache:${namespace}:${tenantId}:${qualifier}`
    : `cache:${namespace}:${tenantId}`
}

export const redisCache = {

  async get<T>(
    namespace: CacheNamespace | string,
    tenantId:  string,
    qualifier?: string,
  ): Promise<T | null> {
    const key   = cacheKey(namespace, tenantId, qualifier)
    const redis = await getRedisClient()

    if (redis) {
      try {
        const raw = await redis.get(key)
        if (raw === null) return null
        return JSON.parse(raw) as T
      } catch (err) {
        log.warn('Cache GET failed', { key, err: err instanceof Error ? err.message : String(err) })

      }
    }

    return (_localCache.get(key) as T | undefined) ?? null
  },

  async set<T>(
    namespace: CacheNamespace | string,
    tenantId:  string,
    value:     T,
    ttlMs?:    number,
    qualifier?: string,
  ): Promise<void> {
    const key       = cacheKey(namespace, tenantId, qualifier)
    const ttl       = ttlMs ?? CACHE_TTL[namespace as CacheNamespace] ?? 30_000
    const redis     = await getRedisClient()

    _localCache.set(key, value, ttl)

    if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), 'PX', ttl)
      } catch (err) {
        log.warn('Cache SET failed', { key, err: err instanceof Error ? err.message : String(err) })
      }
    }
  },

  async invalidate(
    namespace:  CacheNamespace | string,
    tenantId:   string,
    qualifier?: string,
  ): Promise<void> {
    const key   = cacheKey(namespace, tenantId, qualifier)
    const redis = await getRedisClient()

    _localCache.delete(key)

    if (redis) {
      try { await redis.del(key) }
      catch (err) { log.warn('redisCache.invalidate failed', { key, err: err instanceof Error ? err.message : String(err) }) }
    }
  },

  async invalidateAll(namespace: CacheNamespace | string, tenantId: string): Promise<void> {
    const pattern = `cache:${namespace}:${tenantId}*`

    _localCache.invalidate(k => k.startsWith(`cache:${namespace}:${tenantId}`))

    const redis = await getRedisClient()
    if (!redis) return

    try {

      let cursor = '0'
      do {
        const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000)
        cursor = nextCursor
        if (batch.length > 0) await redis.del(...batch)
      } while (cursor !== '0')
    } catch (err) {
      log.warn('Cache invalidateAll failed', { namespace, tenantId, err: err instanceof Error ? err.message : String(err) })
    }
  },

  async getOrSet<T>(
    namespace:  CacheNamespace | string,
    tenantId:   string,
    factory:    () => Promise<T>,
    ttlMs?:     number,
    qualifier?: string,
  ): Promise<T> {
    const key = cacheKey(namespace, tenantId, qualifier)

    const localEntry = _localCache.get(key)
    if (localEntry !== undefined) return localEntry as T

    const redis = await getRedisClient()
    if (redis) {
      try {
        const raw = await redis.get(key)
        if (raw !== null) {
          const parsed = JSON.parse(raw) as T

          _localCache.set(key, parsed, ttlMs ?? CACHE_TTL[namespace as CacheNamespace] ?? 30_000)
          return parsed
        }
      } catch {

      }
    }

    const inflight = _inflight.get(key)
    if (inflight) return inflight as Promise<T>

    const promise = factory().then(async (value) => {

      const ttl = ttlMs ?? CACHE_TTL[namespace as CacheNamespace] ?? 30_000
      _localCache.set(key, value, ttl)

      if (redis) {
        redis.set(key, JSON.stringify(value), 'PX', ttl).catch(() => {})
      }
      _inflight.delete(key)
      return value
    }).catch((err) => {
      _inflight.delete(key)
      throw err
    })

    _inflight.set(key, promise)
    return promise as Promise<T>
  },
}
