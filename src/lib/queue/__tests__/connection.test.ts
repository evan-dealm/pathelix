import { describe, it, expect } from 'vitest'
import { redisConnection, workerRedisConnection, REDIS_URL } from '../connection'

describe('redisConnection', () => {
  it('uses localhost defaults when env not set', () => {
    expect(redisConnection.host).toBe(process.env.REDIS_HOST ?? 'localhost')
    expect(redisConnection.port).toBe(parseInt(process.env.REDIS_PORT ?? '6379', 10))
    expect(redisConnection.lazyConnect).toBe(true)
    expect(redisConnection.maxRetriesPerRequest).toBeNull()
    expect(redisConnection.enableReadyCheck).toBe(false)
  })

  it('retryStrategy returns null after >2 retries', () => {
    expect(redisConnection.retryStrategy(3)).toBeNull()
    expect(redisConnection.retryStrategy(10)).toBeNull()
  })

  it('retryStrategy returns delay for first 2 retries', () => {
    expect(redisConnection.retryStrategy(1)).toBe(200)
    expect(redisConnection.retryStrategy(2)).toBe(400)
  })
})

describe('workerRedisConnection', () => {
  it('has longer timeouts than redisConnection', () => {
    expect(workerRedisConnection.connectTimeout).toBeGreaterThan(redisConnection.connectTimeout!)
    expect(workerRedisConnection.lazyConnect).toBe(true)
  })

  it('retryStrategy returns null after >10 retries', () => {
    expect(workerRedisConnection.retryStrategy(11)).toBeNull()
  })

  it('retryStrategy caps delay at 5000ms', () => {
    expect(workerRedisConnection.retryStrategy(10)).toBe(5000)
    expect(workerRedisConnection.retryStrategy(1)).toBe(500)
  })
})

describe('REDIS_URL', () => {
  it('is undefined when REDIS_URL env not set', () => {
    // In test env without REDIS_URL, value should be undefined
    expect(REDIS_URL).toBe(process.env.REDIS_URL ?? undefined)
  })
})
