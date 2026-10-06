import { NextResponse } from 'next/server'

const CHECK_TIMEOUT_MS = 3000

/** Rejects after `ms` — a probe must answer even when a dependency hangs instead of failing. */
function withTimeout<T>(p: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Readiness probe (load balancer / orchestrator). Only the database is critical: without it no
 * request can be served. Redis is reported but never fails readiness — rate limiting, queues and
 * caches fall back without it, and marking every instance unready on a Redis outage would turn a
 * degraded service into a full outage.
 */
export async function GET(): Promise<NextResponse> {
  const useMock = process.env.USE_MOCK_DATA !== 'false'

  if (useMock) {
    return NextResponse.json({ status: 'ok', mode: 'mock' })
  }

  const checks: Record<string, 'ok' | 'unavailable' | 'degraded'> = {}

  try {
    const { default: prisma } = await import('@/lib/db')
    await withTimeout(prisma.$queryRaw`SELECT 1`)
    checks.db = 'ok'
  } catch {
    checks.db = 'unavailable'
  }

  const hasRedis = Boolean(process.env.REDIS_HOST || process.env.REDIS_URL)
  if (hasRedis) {
    try {
      const { getRedisClient } = await import('@/lib/redisClient')
      const redis = await withTimeout(getRedisClient())
      if (!redis) throw new Error('no client')
      await withTimeout(redis.ping())
      checks.redis = 'ok'
    } catch {
      checks.redis = 'degraded'
    }
  }

  const ready = checks.db === 'ok'
  return NextResponse.json({ status: ready ? 'ready' : 'not_ready', checks }, { status: ready ? 200 : 503 })
}
