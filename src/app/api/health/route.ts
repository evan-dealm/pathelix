import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAllCircuitStates } from '@/lib/circuitBreaker'
import { metrics } from '@/lib/metrics'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

const START_TIME = Date.now()

export async function GET(req: NextRequest): Promise<NextResponse> {
  const useMock = process.env.USE_MOCK_DATA !== 'false'

  let dbStatus: 'ok' | 'mock' | 'error' = useMock ? 'mock' : 'ok'
  // Nessy secrets are per-tenant (Integration table), not a single global env var —
  // "configured" means at least one tenant has an enabled Nessy integration.
  let nessyOk = false

  if (!useMock) {
    try {
      await prisma.$queryRaw`SELECT 1`
      nessyOk = (await prisma.integration.count({ where: { type: 'nessy', enabled: true } })) > 0
    } catch {
      dbStatus = 'error'
    }
  }

  let redisStatus: 'ok' | 'unavailable' | 'unconfigured' = 'unconfigured'
  let queueDepth: number | null = null

  const hasRedis = Boolean(process.env.REDIS_HOST || process.env.REDIS_URL)

  if (hasRedis) {
    let redis: import('ioredis').Redis | null = null
    try {
      const { default: Redis } = await import('ioredis')
      const redisOpts = { lazyConnect: true, enableReadyCheck: false, maxRetriesPerRequest: 1, connectTimeout: 2000 }
      redis = process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, redisOpts)
        : new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            ...redisOpts,
          })
      await redis.ping()
      redisStatus = 'ok'

      try {
        const waiting = await redis.llen('bull:vrp-optimization:wait')
        const active  = await redis.llen('bull:vrp-optimization:active')
        queueDepth = waiting + active
      } catch {  }
    } catch {
      redisStatus = 'unavailable'
    } finally {

      try { await redis?.quit() } catch { redis?.disconnect() }
    }
  }

  let valhallaStatus: 'ok' | 'degraded' | 'unconfigured' = 'unconfigured'
  const valhallaUrl = process.env.VALHALLA_URL

  if (valhallaUrl) {
    try {
      const ctrl = new AbortController()
      const t    = setTimeout(() => ctrl.abort(), 2000)
      const vRes = await fetch(`${valhallaUrl}/status`, {
        signal:  ctrl.signal,
        headers: { 'User-Agent': 'Pathelix-Health/1.0' },
      })
      clearTimeout(t)
      valhallaStatus = vRes.ok ? 'ok' : 'degraded'
    } catch {
      valhallaStatus = 'degraded'
    }
  }

  let aiEngineStatus: 'ok' | 'degraded' | 'unconfigured' = 'unconfigured'
  const aiEngineUrl = process.env.AI_ENGINE_URL

  if (aiEngineUrl) {
    try {
      const ctrl = new AbortController()
      const t    = setTimeout(() => ctrl.abort(), 2000)
      const aRes = await fetch(`${aiEngineUrl}/health`, {
        signal:  ctrl.signal,
        headers: { 'User-Agent': 'Pathelix-Health/1.0' },
      })
      clearTimeout(t)
      aiEngineStatus = aRes.ok ? 'ok' : 'degraded'
    } catch {
      aiEngineStatus = 'degraded'
    }
  }

  const circuitBreakers = getAllCircuitStates()
  const hasOpenCircuit  = Object.values(circuitBreakers).some(s => s === 'OPEN')

  const snap = metrics.snapshot()

  const degraded =
    dbStatus === 'error' ||
    (hasRedis && redisStatus === 'unavailable') ||
    (valhallaUrl && valhallaStatus === 'degraded') ||
    (aiEngineUrl && aiEngineStatus === 'degraded') ||
    hasOpenCircuit

  const body = {
    status:    degraded ? 'degraded' : 'ok',
    version:   '1.0.0',
    env:       process.env.NODE_ENV ?? 'development',
    useMock,
    uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    checks: {
      db:             dbStatus,
      // Optional integration: an organisation that does not use Nessy is not a degraded service.
      nessySecret:    nessyOk ? 'ok' : 'unconfigured',
      redis:          redisStatus,
      valhalla:       valhallaStatus,
      aiEngine:       aiEngineStatus,
      circuitBreakers,
    },
    queue: {
      depth: queueDepth,
    },
    metrics: {
      counters:   snap.counters,
      histograms: Object.fromEntries(
        Object.entries(snap.histograms).map(([k, v]) => [k, {
          count: v.count,
          avg:   Math.round(v.avg),
          p50:   Math.round(v.p50),
          p95:   Math.round(v.p95),
          p99:   Math.round(v.p99),
        }]),
      ),
    },
  }

  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null

  if (!session) {

    return NextResponse.json(
      { status: degraded ? 'degraded' : 'ok', timestamp: new Date().toISOString() },
      { status: degraded ? 503 : 200 },
    )
  }

  return NextResponse.json(body, { status: degraded ? 503 : 200 })
}
