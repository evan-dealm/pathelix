import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedis = vi.hoisted(() => ({
  hgetall: vi.fn(),
  hset:    vi.fn(),
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(mockRedis)),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Must import after mocks
import {
  promIncrement,
  generatePrometheusMetrics,
  initPrometheusFromRedis,
  flushPrometheusToRedis,
} from '@/lib/prometheus'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Prometheus Redis persistence', () => {
  it('flushPrometheusToRedis writes current counters to Redis hash', async () => {
    mockRedis.hset.mockResolvedValue(1)
    promIncrement('test_counter_flush', 'Test counter', undefined, 5)

    await flushPrometheusToRedis()

    expect(mockRedis.hset).toHaveBeenCalledOnce()
    const [key, entries] = mockRedis.hset.mock.calls[0]
    expect(key).toBe('prom:counters')
    expect(typeof entries).toBe('object')
    expect(Object.keys(entries).some(k => k.includes('test_counter_flush'))).toBe(true)
  })

  it('initPrometheusFromRedis restores counter values from Redis', async () => {
    mockRedis.hgetall.mockResolvedValue({
      'test_restored_counter': '42',
    })

    await initPrometheusFromRedis()

    const output = generatePrometheusMetrics()
    expect(output).toContain('test_restored_counter')
    expect(output).toContain('42')
  })

  it('initPrometheusFromRedis skips non-finite values', async () => {
    mockRedis.hgetall.mockResolvedValue({
      'bad_counter': 'not-a-number',
    })

    await expect(initPrometheusFromRedis()).resolves.toBeUndefined()
  })

  it('flushPrometheusToRedis does nothing when Redis is unavailable', async () => {
    const { getRedisClient } = await import('@/lib/redisClient')
    vi.mocked(getRedisClient).mockResolvedValueOnce(null)

    await expect(flushPrometheusToRedis()).resolves.toBeUndefined()
    expect(mockRedis.hset).not.toHaveBeenCalled()
  })

  it('initPrometheusFromRedis does nothing when Redis is unavailable', async () => {
    const { getRedisClient } = await import('@/lib/redisClient')
    vi.mocked(getRedisClient).mockResolvedValueOnce(null)

    await expect(initPrometheusFromRedis()).resolves.toBeUndefined()
  })

  it('flushPrometheusToRedis tolerates Redis error gracefully', async () => {
    mockRedis.hset.mockRejectedValue(new Error('Redis READONLY'))
    promIncrement('test_error_tolerance', 'counter', undefined, 1)

    await expect(flushPrometheusToRedis()).resolves.toBeUndefined()
  })
})
