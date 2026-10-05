import { NextRequest }          from 'next/server'
import { createLogger }         from '@/lib/logger'
import { getTenantId }          from '@/lib/data/context'
import { metrics, METRIC }      from '@/lib/metrics'
import { REDIS_AVAILABLE }      from '@/lib/redisClient'
import { redisBaseOptions, withTimeout } from '@/lib/queue/connection'
import { channelName }          from '@/lib/driverStatusPubSub'
import { loadStatusSnapshot, type StatusSnapshot } from '@/lib/driverStatusSnapshot'

const log = createLogger('/api/sse/driver-status')

const MAX_CONNECTIONS_PER_TENANT = parseInt(process.env.SSE_MAX_CONNECTIONS_PER_TENANT ?? '200', 10) || 200
const POLL_MS       = 5_000
const KEEPALIVE_MS  = 25_000
const SUBSCRIBE_TIMEOUT_MS = 3_000

const _connectionsByTenant = new Map<string, number>()

function acquire(tenantId: string): boolean {
  const current = _connectionsByTenant.get(tenantId) ?? 0
  if (current >= MAX_CONNECTIONS_PER_TENANT) return false
  _connectionsByTenant.set(tenantId, current + 1)
  return true
}

function release(tenantId: string): void {
  const next = (_connectionsByTenant.get(tenantId) ?? 1) - 1
  if (next <= 0) _connectionsByTenant.delete(tenantId)
  else _connectionsByTenant.set(tenantId, next)
}

/**
 * Live field progress for the dispatch view. The payload is always the full snapshot read from
 * the database (Plan.statuses); Redis pub/sub is only used as a "something changed" signal so
 * every instance pushes updates immediately. Without Redis — or if it fails mid-stream — the
 * stream keeps working by polling the database every POLL_MS.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const tenantId = getTenantId(req)
  const date = req.nextUrl.searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response('Paramètre date requis (AAAA-MM-JJ)', { status: 400 })
  }

  if (!acquire(tenantId)) {
    log.warn('SSE connection limit reached', { tenantId, limit: MAX_CONNECTIONS_PER_TENANT })
    return new Response(JSON.stringify({ error: 'Trop de connexions temps réel pour ce compte' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    })
  }
  metrics.increment(METRIC.SSE_CONNECTIONS, { type: REDIS_AVAILABLE ? 'redis' : 'polling' })

  const encoder = new TextEncoder()
  let closed = false
  let lastJson = ''
  const timers: Array<ReturnType<typeof setInterval>> = []
  let subscriber: import('ioredis').Redis | null = null

  function cleanup(): void {
    if (closed) return
    closed = true
    timers.forEach(clearInterval)
    if (subscriber) {
      subscriber.removeAllListeners()
      subscriber.disconnect()
      subscriber = null
    }
    release(tenantId)
  }

  // Abort from the client side (tab closed, navigation) — the stream's cancel() is not always
  // called by every runtime, the request signal is.
  req.signal.addEventListener('abort', cleanup)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(chunk)) } catch { cleanup() }
      }

      const pushSnapshot = async (force = false) => {
        let snapshot: StatusSnapshot
        try {
          snapshot = await loadStatusSnapshot(tenantId, date)
        } catch (err) {
          log.warn('Snapshot read failed', { err: err instanceof Error ? err.message : String(err) })
          return
        }
        const json = JSON.stringify(snapshot)
        if (force || json !== lastJson) {
          lastJson = json
          send(`data: ${json}\n\n`)
        }
      }

      let polling = false
      const startPolling = () => {
        if (polling || closed) return
        polling = true
        timers.push(setInterval(() => void pushSnapshot(), POLL_MS))
      }

      timers.push(setInterval(() => send(': keep-alive\n\n'), KEEPALIVE_MS))
      await pushSnapshot(true)

      if (!REDIS_AVAILABLE) { startPolling(); return }

      try {
        const { default: Redis } = await import('ioredis')
        subscriber = new Redis({ ...redisBaseOptions(), lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: SUBSCRIBE_TIMEOUT_MS })
        // Handlers before connecting: an early error must fall back, not crash the process.
        subscriber.on('error', () => startPolling())
        subscriber.on('end', () => startPolling())
        subscriber.on('message', () => void pushSnapshot())
        await withTimeout(subscriber.subscribe(channelName(tenantId, date)), SUBSCRIBE_TIMEOUT_MS, 'SSE subscribe')
        if (closed) cleanup()
      } catch {
        log.warn('Redis subscribe unavailable — polling the database instead')
        if (subscriber) { subscriber.removeAllListeners(); subscriber.disconnect(); subscriber = null }
        startPolling()
      }
    },
    cancel() { cleanup() },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
