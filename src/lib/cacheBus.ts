import { randomUUID } from 'crypto'
import { getRedisClient } from './redisClient'

import { createLogger } from './logger'

// Read here rather than imported: test doubles of redisClient often omit the constant.
const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST) && process.env.REDIS_DISABLED !== 'true'

const log = createLogger('cacheBus')

/**
 * Cross-instance cache invalidation. Several caches are kept per process for speed (permissions,
 * session versions, API keys, tenant suspension, feature flags, webhook endpoints, integrations,
 * the local layer of redisCache). Dropping an entry only on the instance that made the change
 * left the others serving it until their TTL (30 s – 5 min): a revoked API key or a removed
 * permission kept working there. `bust()` drops it here and tells every other instance through
 * one Redis channel; each process runs the handlers its caches registered with `onBust()`.
 * Without Redis (single instance) it is local only, as before.
 */
export type BustKind = 'perm' | 'sessionVersion' | 'apiKeys' | 'suspension' | 'tenantRevoked' | 'tenantRestored' | 'flags' | 'webhooks' | 'integrations' | 'cache'
type Handler = (_key: string) => void

const CHANNEL = 'pathelix:cache-bust'
const _g = globalThis as typeof globalThis & {
  __pathelixBustHandlers?: Map<BustKind, Set<Handler>>
  __pathelixBustSub?: Promise<void>
  __pathelixInstanceId?: string
}
const handlers = (_g.__pathelixBustHandlers ??= new Map())
const instanceId = (_g.__pathelixInstanceId ??= randomUUID())

function runLocal(kind: BustKind, key: string): void {
  for (const h of handlers.get(kind) ?? []) {
    try { h(key) } catch (err) { log.warn('Cache bust handler failed', { kind, err: String(err) }) }
  }
}

function ensureSubscriber(): void {
  if (!REDIS_AVAILABLE || _g.__pathelixBustSub) return
  _g.__pathelixBustSub = (async () => {
    try {
      const [{ default: Redis }, { redisBaseOptions }] = await Promise.all([import('ioredis'), import('./queue/connection')])
      const sub = new Redis({ ...redisBaseOptions(), lazyConnect: true, maxRetriesPerRequest: 1 })
      sub.on('error', err => log.warn('Cache bus subscriber error', { err: String(err) }))
      sub.on('message', (_ch: string, raw: string) => {
        try {
          const m = JSON.parse(raw) as { from: string; kind: BustKind; key: string }
          if (m.from !== instanceId) runLocal(m.kind, m.key)
        } catch { /* ignore malformed */ }
      })
      await sub.connect()
      await sub.subscribe(CHANNEL)
    } catch (err) {
      log.warn('Cache bus unavailable — invalidations stay local', { err: err instanceof Error ? err.message : String(err) })
      _g.__pathelixBustSub = undefined
    }
  })()
}

/** Registers how this process drops a cached entry of `kind` (called at module load). */
export function onBust(kind: BustKind, handler: Handler): void {
  if (!handlers.has(kind)) handlers.set(kind, new Set())
  handlers.get(kind)!.add(handler)
  ensureSubscriber()
}

/** Drops the entry here at once and on every other instance shortly after. Never throws. */
export function bust(kind: BustKind, key = ''): void {
  runLocal(kind, key)
  if (!REDIS_AVAILABLE) return
  void (async () => {
    try {
      const client = await getRedisClient()
      await client?.publish(CHANNEL, JSON.stringify({ from: instanceId, kind, key }))
    } catch (err) {
      log.warn('Cache bust publish failed', { kind, err: err instanceof Error ? err.message : String(err) })
    }
  })()
}
