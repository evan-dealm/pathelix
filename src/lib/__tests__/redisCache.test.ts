import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedis = vi.hoisted(() => ({
  get:  vi.fn(),
  set:  vi.fn(),
  del:  vi.fn(),
  scan: vi.fn(),
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { getRedisClient } from '@/lib/redisClient'
import { redisCache } from '@/lib/redisCache'

let _uid = 0
function uid(): string { return `t-${++_uid}-${Math.random().toString(36).slice(2, 5)}` }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('redisCache — no Redis (local TtlCache only)', () => {
  beforeEach(() => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
  })

  it('returns null for unknown key', async () => {
    expect(await redisCache.get('drivers', uid())).toBeNull()
  })

  it('set then get returns the stored value', async () => {
    const t = uid()
    await redisCache.set('drivers', t, { name: 'Jean' }, 60_000)
    expect(await redisCache.get('drivers', t)).toEqual({ name: 'Jean' })
  })

  it('qualifier produces a separate cache slot', async () => {
    const t = uid()
    await redisCache.set('missions', t, 'base', 60_000)
    await redisCache.set('missions', t, 'qualified', 60_000, 'q1')
    expect(await redisCache.get('missions', t)).toBe('base')
    expect(await redisCache.get('missions', t, 'q1')).toBe('qualified')
  })

  it('invalidate removes the local entry', async () => {
    const t = uid()
    await redisCache.set('missions', t, [1, 2], 60_000)
    await redisCache.invalidate('missions', t)
    expect(await redisCache.get('missions', t)).toBeNull()
  })

  it('invalidateAll removes all qualifier keys for the same namespace+tenant', async () => {
    const t = uid()
    await redisCache.set('plans', t, { a: 1 }, 60_000, 'q1')
    await redisCache.set('plans', t, { b: 2 }, 60_000, 'q2')
    await redisCache.invalidateAll('plans', t)
    expect(await redisCache.get('plans', t, 'q1')).toBeNull()
    expect(await redisCache.get('plans', t, 'q2')).toBeNull()
  })

  it('getOrSet calls factory and returns result', async () => {
    const factory = vi.fn().mockResolvedValue({ score: 99 })
    const result  = await redisCache.getOrSet('drivers', uid(), factory, 60_000)
    expect(result).toEqual({ score: 99 })
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('getOrSet returns cached value on second call (factory called once)', async () => {
    const factory = vi.fn().mockResolvedValue({ cached: true })
    const t = uid()
    await redisCache.getOrSet('missions', t, factory, 60_000)
    const result = await redisCache.getOrSet('missions', t, factory, 60_000)
    expect(result).toEqual({ cached: true })
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('getOrSet propagates factory error without leaking inflight entry', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('factory fail'))
    const t = uid()
    await expect(redisCache.getOrSet('drivers', t, factory, 60_000)).rejects.toThrow('factory fail')
    // Second call should invoke factory again (no stale inflight entry)
    factory.mockResolvedValueOnce('recovered')
    const result = await redisCache.getOrSet('drivers', t, factory, 60_000)
    expect(result).toBe('recovered')
  })
})

describe('redisCache — with Redis', () => {
  beforeEach(() => {
    vi.mocked(getRedisClient).mockResolvedValue(mockRedis as any)
    mockRedis.get.mockResolvedValue(null)
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.del.mockResolvedValue(1)
    mockRedis.scan.mockResolvedValue(['0', []])
  })

  it('get parses JSON from Redis', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ fromRedis: true }))
    const result = await redisCache.get<{ fromRedis: boolean }>('drivers', uid())
    expect(result).toEqual({ fromRedis: true })
  })

  it('get returns null when Redis returns null (no local cache)', async () => {
    mockRedis.get.mockResolvedValue(null)
    expect(await redisCache.get('missions', uid())).toBeNull()
  })

  it('set writes JSON to Redis with PX TTL', async () => {
    const t = uid()
    await redisCache.set('missions', t, [{ id: 1 }], 5_000)
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining(t),
      JSON.stringify([{ id: 1 }]),
      'PX', 5_000,
    )
  })

  it('invalidate calls Redis del', async () => {
    await redisCache.invalidate('drivers', uid())
    expect(mockRedis.del).toHaveBeenCalled()
  })

  it('invalidateAll scans and deletes matching keys', async () => {
    const t = uid()
    mockRedis.scan
      .mockResolvedValueOnce(['42', [`cache:drivers:${t}:q1`, `cache:drivers:${t}:q2`]])
      .mockResolvedValueOnce(['0', []])
    await redisCache.invalidateAll('drivers', t)
    expect(mockRedis.del).toHaveBeenCalledWith(
      `cache:drivers:${t}:q1`, `cache:drivers:${t}:q2`,
    )
  })

  it('Redis GET failure falls back to local cache without throwing', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis error'))
    await expect(redisCache.get('drivers', uid())).resolves.toBeNull()
  })

  it('Redis SET failure does not throw', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis SET error'))
    await expect(
      redisCache.set('drivers', uid(), { ok: true }, 1_000),
    ).resolves.not.toThrow()
  })

  it('getOrSet reads from Redis and skips factory', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ fromCache: true }))
    const factory = vi.fn()
    const result  = await redisCache.getOrSet('drivers', uid(), factory, 5_000)
    expect(result).toEqual({ fromCache: true })
    expect(factory).not.toHaveBeenCalled()
  })

  it('getOrSet calls factory on Redis miss and writes to Redis', async () => {
    mockRedis.get.mockResolvedValue(null)
    const factory = vi.fn().mockResolvedValue({ computed: 42 })
    const t = uid()
    const result  = await redisCache.getOrSet('missions', t, factory, 5_000)
    expect(result).toEqual({ computed: 42 })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(mockRedis.set).toHaveBeenCalled()
  })
})
