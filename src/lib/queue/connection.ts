export const redisConnection = {
  host:     process.env.REDIS_HOST ?? 'localhost',
  port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  username: process.env.REDIS_USERNAME || undefined,
  db:       parseInt(process.env.REDIS_DB ?? '0', 10),
  ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),

  maxRetriesPerRequest: null as unknown as null,
  enableReadyCheck:     false,

  lazyConnect:         true,
  connectTimeout:      3_000,
  commandTimeout:      2_000,
  retryStrategy(times: number): number | null {
    if (times > 2) return null
    return times * 200
  },
}

export const REDIS_URL = process.env.REDIS_URL ?? undefined

export const workerRedisConnection = {
  host:     process.env.REDIS_HOST ?? 'localhost',
  port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  username: process.env.REDIS_USERNAME || undefined,
  db:       parseInt(process.env.REDIS_DB ?? '0', 10),
  ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),

  maxRetriesPerRequest: null as unknown as null,
  enableReadyCheck:     false,

  lazyConnect:    true,
  connectTimeout: 10_000,

  retryStrategy(times: number): number | null {
    if (times > 10) return null
    return Math.min(times * 500, 5_000)
  },
}
