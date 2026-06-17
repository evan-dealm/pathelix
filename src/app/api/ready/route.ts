import { NextResponse } from 'next/server'

export async function GET(): Promise<NextResponse> {
  const useMock = process.env.USE_MOCK_DATA !== 'false'

  if (useMock) {
    return NextResponse.json({ status: 'ok', mode: 'mock' })
  }

  const results: Record<string, 'ok' | 'unavailable'> = {}

  try {
    const { default: prisma } = await import('@/lib/db')
    await prisma.$queryRaw`SELECT 1`
    results.db = 'ok'
  } catch {
    results.db = 'unavailable'
  }

  const hasRedis = Boolean(process.env.REDIS_HOST || process.env.REDIS_URL)
  if (hasRedis) {
    try {
      const { getRedisClient } = await import('@/lib/redisClient')
      const redis = await getRedisClient()
      if (redis) {
        await redis.ping()
        results.redis = 'ok'
      } else {
        results.redis = 'unavailable'
      }
    } catch {
      results.redis = 'unavailable'
    }
  }

  const allOk = Object.values(results).every(v => v === 'ok')
  const status = allOk ? 200 : 503

  return NextResponse.json({ status: allOk ? 'ready' : 'not_ready', checks: results }, { status })
}
