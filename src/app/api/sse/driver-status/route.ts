import { NextRequest }               from 'next/server'
import { _statusStore, getAllStatusesForDate } from '@/lib/statusStore'
import { createLogger }              from '@/lib/logger'
import { getTenantId }               from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { REDIS_AVAILABLE } from '@/lib/redisClient'

const log = createLogger('/api/sse/driver-status')

const MAX_CONNECTIONS_PER_TENANT = parseInt(
  process.env.SSE_MAX_CONNECTIONS_PER_TENANT ?? '50', 10,
) || 50

const _connectionsByTenant = new Map<string, number>()

function incrementConnections(tenantId: string): boolean {
  const current = _connectionsByTenant.get(tenantId) ?? 0
  if (current >= MAX_CONNECTIONS_PER_TENANT) return false
  _connectionsByTenant.set(tenantId, current + 1)
  return true
}

function decrementConnections(tenantId: string): void {
  const current = _connectionsByTenant.get(tenantId) ?? 0
  const next    = Math.max(0, current - 1)
  if (next === 0) _connectionsByTenant.delete(tenantId)
  else            _connectionsByTenant.set(tenantId, next)
}

async function getSnapshot(tenantId: string, date: string): Promise<Record<string, Record<string, string>>> {
  try {
    return await getAllStatusesForDate(tenantId, date)
  } catch {
    const result: Record<string, Record<string, string>> = {}
    const encodedTenant = encodeURIComponent(tenantId)
    for (const [key, statuses] of _statusStore.entries()) {
      const [kTenant, kDriver, kDate] = key.split('|')
      if (kDate === date && kTenant === encodedTenant && kDriver) {
        result[decodeURIComponent(kDriver)] = statuses
      }
    }
    return result
  }
}

function snapshotEqual(
  a: Record<string, Record<string, string>>,
  b: Record<string, Record<string, string>>,
): boolean {
  const keysA = Object.keys(a).sort()
  const keysB = Object.keys(b).sort()
  if (keysA.join(',') !== keysB.join(',')) return false
  for (const k of keysA) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false
  }
  return true
}

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl
  const date     = searchParams.get('date')
  const tenantId = getTenantId(req)

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response('Paramètre date requis (YYYY-MM-DD)', { status: 400 })
  }

  const safeDate: string = date

  if (!incrementConnections(tenantId)) {
    log.warn('SSE connection limit reached', { tenantId, limit: MAX_CONNECTIONS_PER_TENANT })
    return new Response(
      JSON.stringify({ error: 'Trop de connexions SSE actives pour ce tenant' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }

  metrics.increment(METRIC.SSE_CONNECTIONS, { type: REDIS_AVAILABLE ? 'redis' : 'polling' })

  const encoder = new TextEncoder()

  function sseMessage(data: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
  }

  let redisSubscriber: import('ioredis').Redis | null = null

  if (REDIS_AVAILABLE) {
    try {
      const { default: Redis } = await import('ioredis')
      const redisOpts = { lazyConnect: true, enableReadyCheck: false, maxRetriesPerRequest: null }
      redisSubscriber = process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, redisOpts)
        : new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            ...redisOpts,
          })
    } catch {
      log.warn('Redis subscriber init failed — fallback polling')
      redisSubscriber = null
    }
  }

  let intervalId:   ReturnType<typeof setInterval> | null = null
  let redisCleanup: (() => void) | null                   = null
  let lastSnapshot: Record<string, Record<string, string>> = {}

  const stream = new ReadableStream({
    async start(controller) {

      try {
        const snapshot = await getSnapshot(tenantId, safeDate)
        lastSnapshot   = snapshot
        controller.enqueue(sseMessage(snapshot))
      } catch { return }

      if (redisSubscriber) {

        const channel = `driver-status:${tenantId}:${safeDate}`
        try {
          await redisSubscriber.subscribe(channel)
          redisSubscriber.on('message', (ch: string, message: string) => {
            if (ch !== channel) return
            try {
              const data = JSON.parse(message) as Record<string, Record<string, string>>
              lastSnapshot = data
              controller.enqueue(sseMessage(data))
            } catch {  }
          })
          redisSubscriber.on('error', () => {
            redisSubscriber?.quit().catch(() => {})
            redisSubscriber = null
            startPolling(controller)
          })
          redisCleanup = () => {
            redisSubscriber?.unsubscribe(channel).catch(() => {})
            redisSubscriber?.quit().catch(() => {})
          }
        } catch {
          log.warn('Redis subscribe failed — fallback polling')
          startPolling(controller)
        }
      } else {
        startPolling(controller)
      }

      intervalId = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keep-alive\n\n')) }
        catch { clearInterval(intervalId!) }
      }, 30_000)
    },

    cancel() {
      if (intervalId) clearInterval(intervalId)
      redisCleanup?.()
      decrementConnections(tenantId)
      log.debug('SSE client disconnected', { tenantId, date: safeDate })
    },
  })

  function startPolling(controller: ReadableStreamDefaultController): void {
    const poll = setInterval(() => {
      getSnapshot(tenantId, safeDate).then(snapshot => {
        if (!snapshotEqual(snapshot, lastSnapshot)) {
          lastSnapshot = snapshot
          controller.enqueue(sseMessage(snapshot))
        }
      }).catch(() => {
        clearInterval(poll)
      })
    }, 2_000)

    const prev = redisCleanup
    redisCleanup = () => { prev?.(); clearInterval(poll) }
  }

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
