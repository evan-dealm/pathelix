import { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getTenantId } from '@/lib/data/context'
import { metrics, METRIC } from '@/lib/metrics'
import { REDIS_AVAILABLE } from '@/lib/redisClient'
import { getStatusHub } from '@/lib/driverStatusHub'

const log = createLogger('/api/sse/driver-status')

const MAX_CONNECTIONS_PER_TENANT =
  parseInt(process.env.SSE_MAX_CONNECTIONS_PER_TENANT ?? '200', 10) || 200
const KEEPALIVE_MS = 25_000

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
 * the database (Plan.statuses); Redis pub/sub is only a "something changed" signal. Screens of
 * the same organisation and day share one snapshot read per change and the process holds a
 * single Redis subscriber (src/lib/driverStatusHub.ts). Without Redis — or while it is down —
 * the hub polls the database for them.
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
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  metrics.increment(METRIC.SSE_CONNECTIONS, { type: REDIS_AVAILABLE ? 'redis' : 'polling' })

  const encoder = new TextEncoder()
  let closed = false
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  function cleanup(): void {
    if (closed) return
    closed = true
    if (keepAlive) clearInterval(keepAlive)
    unsubscribe?.()
    unsubscribe = null
    release(tenantId)
  }

  // Abort from the client side (tab closed, navigation) — the stream's cancel() is not always
  // called by every runtime, the request signal is.
  req.signal.addEventListener('abort', cleanup)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      keepAlive = setInterval(() => send(': keep-alive\n\n'), KEEPALIVE_MS)
      try {
        const off = await getStatusHub().subscribe(tenantId, date, json =>
          send(`data: ${json}\n\n`),
        )
        // The client may have gone while the first snapshot was being read.
        if (closed) off()
        else unsubscribe = off
      } catch (err) {
        log.warn('Live view subscription failed', {
          err: err instanceof Error ? err.message : String(err),
        })
        cleanup()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
