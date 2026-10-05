import type { RedisOptions } from 'ioredis'

/**
 * Redis connection settings shared by every Redis user (cache client, BullMQ queues/workers,
 * SSE subscribers). REDIS_URL (redis:// or rediss://) wins; otherwise REDIS_HOST/PORT/
 * USERNAME/PASSWORD/DB/TLS. Before this, BullMQ was given `{ url }` — which ioredis ignores as an
 * option — or a bare host/port without auth, so several workers silently connected to an
 * unauthenticated localhost.
 */
export function redisBaseOptions(): RedisOptions {
  const url = process.env.REDIS_URL
  if (url) {
    const u = new URL(url)
    const db = parseInt(u.pathname.replace('/', '') || '0', 10)
    return {
      host:     u.hostname,
      port:     parseInt(u.port || '6379', 10),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      db:       Number.isFinite(db) ? db : 0,
      ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    }
  }
  return {
    host:     process.env.REDIS_HOST ?? 'localhost',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    db:       parseInt(process.env.REDIS_DB ?? '0', 10) || 0,
    ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
  }
}

export const REDIS_CONFIGURED = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST)

/** Reconnect forever with a capped backoff — never give up and leave a dead singleton behind. */
function reconnectForever(times: number): number {
  return Math.min(times * 500, 10_000)
}

/**
 * For producers inside the web process (adding jobs, reading job state): fail fast while Redis is
 * down — commands are rejected instead of queued, so the request can fall back (synchronous
 * VRP, inline PDF error…) rather than hang.
 */
export function queueConnectionOptions(): RedisOptions {
  return {
    ...redisBaseOptions(),
    lazyConnect:          true,
    enableReadyCheck:     false,
    enableOfflineQueue:   false,
    maxRetriesPerRequest: 1,
    connectTimeout:       3_000,
    commandTimeout:       3_000,
    retryStrategy:        reconnectForever,
  }
}

/** For BullMQ workers (requires maxRetriesPerRequest: null): wait for Redis to come back. */
export function workerConnectionOptions(): RedisOptions {
  return {
    ...redisBaseOptions(),
    lazyConnect:          true,
    enableReadyCheck:     false,
    maxRetriesPerRequest: null,
    connectTimeout:       10_000,
    retryStrategy:        reconnectForever,
  }
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/** Rejects with TimeoutError if `promise` hasn't settled after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms) }),
  ]).finally(() => clearTimeout(timer))
}
