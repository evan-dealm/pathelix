import { describe, it, expect, vi, afterEach } from 'vitest'
import { redisBaseOptions, queueConnectionOptions, workerConnectionOptions, withTimeout, TimeoutError } from '../connection'

afterEach(() => vi.unstubAllEnvs())

describe('redisBaseOptions', () => {
  it('parses REDIS_URL including auth, db and TLS (ioredis ignores a `url` option, BullMQ got none of it)', () => {
    vi.stubEnv('REDIS_URL', 'rediss://app:s%40cret@redis.internal:6380/2')
    expect(redisBaseOptions()).toEqual({
      host: 'redis.internal', port: 6380, username: 'app', password: 's@cret', db: 2, tls: {},
    })
  })

  it('falls back to REDIS_HOST/PORT/PASSWORD', () => {
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('REDIS_HOST', 'cache')
    vi.stubEnv('REDIS_PORT', '6390')
    vi.stubEnv('REDIS_PASSWORD', 'pw')
    expect(redisBaseOptions()).toMatchObject({ host: 'cache', port: 6390, password: 'pw', db: 0 })
  })
})

describe('connection profiles', () => {
  it('never gives up reconnecting (a null retryStrategy left a dead queue singleton until restart)', () => {
    for (const opts of [queueConnectionOptions(), workerConnectionOptions()]) {
      const retry = opts.retryStrategy!
      expect(retry(1)).toBe(500)
      expect(retry(3)).toBe(1500)
      expect(retry(1000)).toBe(10_000)
    }
  })

  it('web-side producers fail fast instead of queueing commands while Redis is down', () => {
    const o = queueConnectionOptions()
    expect(o.enableOfflineQueue).toBe(false)
    expect(o.commandTimeout).toBeLessThanOrEqual(3_000)
  })

  it('workers use maxRetriesPerRequest: null as BullMQ requires', () => {
    expect(workerConnectionOptions().maxRetriesPerRequest).toBeNull()
  })
})

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, 'op')).resolves.toBe(42)
  })

  it('rejects with TimeoutError when it does not', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'hang')).rejects.toBeInstanceOf(TimeoutError)
  })
})
