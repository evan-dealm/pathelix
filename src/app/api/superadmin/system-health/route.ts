import { NextRequest, NextResponse } from 'next/server'
import { getRedisClient } from '@/lib/redisClient'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/superadmin/system-health')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }
  try {
    const redis = await getRedisClient()

    const mem = process.memoryUsage()
    const memory = {
      heapUsedMb:  Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb:       Math.round(mem.rss / 1024 / 1024),
      externalMb:  Math.round(mem.external / 1024 / 1024),
      usagePercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    }

    let redisStatus: Record<string, unknown> = { status: 'unavailable' }
    if (redis) {
      try {
        const info = await redis.info('memory')
        const usedMatch = info.match(/used_memory_human:(\S+)/)
        const peakMatch = info.match(/used_memory_peak_human:(\S+)/)
        const clientsInfo = await redis.info('clients')
        const connectedMatch = clientsInfo.match(/connected_clients:(\d+)/)

        const keyCount = await redis.dbsize()

        redisStatus = {
          status: 'connected',
          memoryUsed: usedMatch?.[1] ?? 'unknown',
          memoryPeak: peakMatch?.[1] ?? 'unknown',
          connectedClients: connectedMatch ? parseInt(connectedMatch[1], 10) : 0,
          totalKeys: keyCount,
        }
      } catch {
        redisStatus = { status: 'error' }
      }
    }

    let queueStatus: Record<string, unknown> = { status: 'unavailable' }
    if (redis) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          redis.llen('bull:vrp-optimization:wait'),
          redis.llen('bull:vrp-optimization:active'),
          redis.zcard('bull:vrp-optimization:completed'),
          redis.zcard('bull:vrp-optimization:failed'),
          redis.zcard('bull:vrp-optimization:delayed'),
        ])
        queueStatus = {
          status: 'connected',
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + completed + failed + delayed,
        }
      } catch {
        queueStatus = { status: 'error' }
      }
    }

    let routingStatus: Record<string, unknown> = { status: 'not_configured', engine: 'none' }
    const valhallaUrl = process.env.VALHALLA_URL
    const valhallaFallback = process.env.VALHALLA_FALLBACK_URL
    const osrmUrl = process.env.OSRM_URL

    if (valhallaUrl) {
      try {
        const start = Date.now()
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(`${valhallaUrl}/status`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Pathelix/1.0' },
        })
        clearTimeout(timeout)
        routingStatus = {
          status: res.ok ? 'ok' : 'degraded',
          engine: 'valhalla',
          url: valhallaUrl,
          responseTimeMs: Date.now() - start,
          httpStatus: res.status,
          fallbackUrl: valhallaFallback || null,
        }
      } catch (err) {
        routingStatus = {
          status: 'error',
          engine: 'valhalla',
          url: valhallaUrl,
          error: err instanceof Error ? err.message : 'unknown',
          fallbackUrl: valhallaFallback || null,
        }
      }
    } else if (osrmUrl) {
      try {
        const start = Date.now()
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(`${osrmUrl}/nearest/v1/driving/6.0,45.5`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Pathelix/1.0' },
        })
        clearTimeout(timeout)
        routingStatus = {
          status: res.ok ? 'ok' : 'degraded',
          engine: 'osrm',
          url: osrmUrl,
          responseTimeMs: Date.now() - start,
          httpStatus: res.status,
        }
      } catch (err) {
        routingStatus = {
          status: 'error',
          engine: 'osrm',
          url: osrmUrl,
          error: err instanceof Error ? err.message : 'unknown',
        }
      }
    } else {
      routingStatus = { status: 'haversine_only', engine: 'haversine', note: 'Aucun serveur de routage configuré — distances en vol d\'oiseau' }
    }

    let dbStatus: Record<string, unknown> = { status: 'unknown' }
    try {
      const prisma = (await import('@/lib/db')).default
      const start = Date.now()
      await prisma.$queryRaw`SELECT 1`
      dbStatus = {
        status: 'ok',
        responseTimeMs: Date.now() - start,
      }
    } catch (err) {
      dbStatus = {
        status: 'error',
        error: err instanceof Error ? err.message : 'unknown',
      }
    }

    const uptimeSec = Math.round(process.uptime())
    const uptimeFormatted = uptimeSec >= 86400
      ? `${Math.floor(uptimeSec / 86400)}j ${Math.floor((uptimeSec % 86400) / 3600)}h`
      : uptimeSec >= 3600
        ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
        : `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      uptime: { seconds: uptimeSec, formatted: uptimeFormatted },
      memory,
      redis: redisStatus,
      queue: queueStatus,
      routing: routingStatus,
      database: dbStatus,
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    })
  } catch (err) {
    log.error('System health check failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
