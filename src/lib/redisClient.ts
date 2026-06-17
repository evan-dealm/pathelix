import { createLogger } from '@/lib/logger'

const log = createLogger('redisClient')

export function getRedisConfig() {
  const url = process.env.REDIS_URL
  if (url) return url
  return {
    host:     process.env.REDIS_HOST     ?? 'localhost',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
    password: process.env.REDIS_PASSWORD ?? undefined,
    username: process.env.REDIS_USERNAME ?? undefined,
    db:       parseInt(process.env.REDIS_DB ?? '0', 10) || 0,
  }
}

export const REDIS_AVAILABLE = Boolean(
  process.env.REDIS_URL || process.env.REDIS_HOST,
) && process.env.REDIS_DISABLED !== 'true'

let _client: import('ioredis').Redis | null = null
let _connecting = false
let _failed     = false
let _retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRetry(attemptNum: number): void {
  if (_retryTimer) return
  const delay = Math.min(5_000 * Math.pow(2, attemptNum), 60_000)
  log.info(`Redis retry scheduled in ${delay}ms (attempt ${attemptNum + 1})`)
  _retryTimer = setTimeout(() => {
    _retryTimer = null
    _failed = false

    getRedisClient().catch(() => {

    })
  }, delay)
}

let _retryAttempt = 0

export async function getRedisClient(): Promise<import('ioredis').Redis | null> {
  if (!REDIS_AVAILABLE) return null
  if (_failed)          return null
  if (_client)          return _client
  if (_connecting)      return null

  _connecting = true
  try {
    const { default: Redis } = await import('ioredis')
    const extraOpts = {
      lazyConnect:          true,
      enableReadyCheck:     false,
      maxRetriesPerRequest: 1,
      connectTimeout:       3_000,
      commandTimeout:       2_000,
      retryStrategy(times: number): number | null {
        if (times > 3) {
          log.warn('Redis indisponible après 3 tentatives — retry avec backoff')
          _failed = true
          _client = null
          scheduleRetry(_retryAttempt++)
          return null
        }
        return Math.min(times * 500, 2_000)
      },
    }
    _client = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, extraOpts)
      : new Redis({
          host:     process.env.REDIS_HOST     ?? 'localhost',
          port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
          password: process.env.REDIS_PASSWORD ?? undefined,
          username: process.env.REDIS_USERNAME ?? undefined,
          db:       parseInt(process.env.REDIS_DB ?? '0', 10),
          ...extraOpts,
        })

    _client.on('error', (err: Error) => {

      if (!_failed) log.warn('Erreur Redis', { err: err.message })
    })

    await _client.ping()
    log.info('Connexion Redis établie')
    _retryAttempt = 0
    return _client
  } catch (err) {
    log.warn('Redis connexion échouée — mode dégradé', {
      err: err instanceof Error ? err.message : String(err),
    })
    _failed = true
    _client = null
    scheduleRetry(_retryAttempt++)
    return null
  } finally {
    _connecting = false
  }
}

export function resetRedisClient(): void {
  _client?.disconnect()
  _client    = null
  _failed    = false
  _connecting = false
  _retryAttempt = 0
  if (_retryTimer) {
    clearTimeout(_retryTimer)
    _retryTimer = null
  }
}
