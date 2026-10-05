import { getRedisClient } from '@/lib/redisClient'

export interface RateBucket {
  count:   number
  resetAt: number
}

export interface RateLimiter {
  check(_key: string): Promise<boolean> | boolean
  headers(_key: string): { 'X-RateLimit-Limit': string; 'X-RateLimit-Remaining': string }
}

export interface RateLimiterOptions {

  redis?:     boolean

  prefix?:    string

  bucketCap?: number
}

const SLIDING_WINDOW_SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max    = tonumber(ARGV[3])
local reqid  = ARGV[4]
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count < max then
  redis.call('ZADD', key, now, reqid)
  redis.call('PEXPIRE', key, window)
  return {1, max - count - 1}
else
  return {0, 0}
end
`

function createInMemoryLimiter(
  max:       number,
  windowMs:  number,
  bucketCap: number,
): RateLimiter {
  const store     = new Map<string, RateBucket>()
  const remaining = new Map<string, number>()

  function evict(now: number): void {
    if (store.size >= bucketCap) {
      for (const [k, b] of store) {
        if (now >= b.resetAt) { store.delete(k); remaining.delete(k) }
      }
    }
  }

  return {
    check(key: string): boolean {
      const now = Date.now()
      evict(now)
      const bucket = store.get(key)
      if (!bucket || now >= bucket.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs })
        remaining.set(key, max - 1)
        return true
      }
      if (bucket.count >= max) { remaining.set(key, 0); return false }
      bucket.count++
      remaining.set(key, Math.max(0, max - bucket.count))
      return true
    },
    headers(key: string) {
      return {
        'X-RateLimit-Limit':     String(max),
        'X-RateLimit-Remaining': String(remaining.get(key) ?? max),
      }
    },
  }
}

function createRedisLimiter(
  max:       number,
  windowMs:  number,
  prefix:    string,
  bucketCap: number,
): RateLimiter {
  const fallback   = createInMemoryLimiter(max, windowMs, bucketCap)
  const _remaining = new Map<string, number>()

  return {
    async check(key: string): Promise<boolean> {
      const redis = await getRedisClient()
      if (!redis) return fallback.check(key) as boolean

      try {
        const redisKey = `${prefix}:${key}`
        const now      = Date.now()
        const reqId    = `${now}-${Math.random().toString(36).slice(2)}`

        const result = await redis.eval(
          SLIDING_WINDOW_SCRIPT, 1, redisKey,
          String(now), String(windowMs), String(max), reqId,
        ) as [number, number]

        const allowed = result[0] === 1
        _remaining.set(key, result[1] ?? 0)
        return allowed
      } catch {
        return fallback.check(key) as boolean
      }
    },
    headers(key: string) {
      return {
        'X-RateLimit-Limit':     String(max),
        'X-RateLimit-Remaining': String(_remaining.get(key) ?? max),
      }
    },
  }
}

export function createRateLimiter(
  max:      number,
  windowMs: number,
  options:  RateLimiterOptions = {},
): RateLimiter {
  const bucketCap = options.bucketCap ?? 10_000
  const prefix    = options.prefix    ?? 'rl'
  if (options.redis) return createRedisLimiter(max, windowMs, prefix, bucketCap)
  return createInMemoryLimiter(max, windowMs, bucketCap)
}

export function createTenantRateLimiter(
  max:      number,
  windowMs: number,
  route:    string,
): RateLimiter {
  return createRateLimiter(max, windowMs, {
    redis:  true,
    prefix: `rl:tenant:${route}`,
  })
}

export const PLAN_RATE_LIMITS = {
  optimize: { FREE: 2, PRO: 10, ENTERPRISE: 30 },
  api:      { FREE: 60, PRO: 300, ENTERPRISE: 1000 },
  import:   { FREE: 5, PRO: 20, ENTERPRISE: 100 },
} as const

export type PlanRateLimitRoute = keyof typeof PLAN_RATE_LIMITS

const _planCache = new Map<string, { plan: string; expiresAt: number }>()
const PLAN_CACHE_TTL_MS = 300_000

export async function getTenantPlanLimit(
  tenantId:  string,
  route:     PlanRateLimitRoute,
): Promise<number> {
  const limits = PLAN_RATE_LIMITS[route]

  const cached = _planCache.get(tenantId)
  if (cached && Date.now() < cached.expiresAt) {
    const plan = cached.plan as keyof typeof limits
    return limits[plan] ?? limits.FREE
  }

  try {
    const { getRedisClient } = await import('@/lib/redisClient')
    const redis = await getRedisClient()
    if (redis) {
      const redisPlan = await redis.get(`tenant:plan:${tenantId}`)
      if (redisPlan) {
        _planCache.set(tenantId, { plan: redisPlan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS })
        return limits[redisPlan as keyof typeof limits] ?? limits.FREE
      }
    }
  } catch {  }

  try {
    const { default: prisma } = await import('@/lib/db')
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } })
    const plan = tenant?.plan ?? 'FREE'
    _planCache.set(tenantId, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS })

    try {
      const { getRedisClient } = await import('@/lib/redisClient')
      const redis = await getRedisClient()
      if (redis) await redis.set(`tenant:plan:${tenantId}`, plan, 'EX', 300)
    } catch {  }

    return limits[plan as keyof typeof limits] ?? limits.FREE
  } catch {
    return limits.FREE
  }
}

/**
 * Client IP for rate limiting. Pathélix runs behind a reverse proxy (Caddy/Nginx) that *appends*
 * the address it saw to X-Forwarded-For, so the left-most entries are whatever the client chose
 * to send — trusting them let anyone rotate a fake IP per request and bypass every IP limiter
 * (login brute force included). The trustworthy entry is the one added by our own proxy:
 * counted from the right, `TRUSTED_PROXY_COUNT` hops (default 1).
 */
export function getClientIp(headers: Headers): string {
  const hops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_COUNT ?? '1', 10) || 1)
  const xff = (headers.get('x-forwarded-for') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (xff.length > 0) return xff[Math.max(0, xff.length - hops)]

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp && realIp.length > 0) return realIp

  return '127.0.0.1'
}
