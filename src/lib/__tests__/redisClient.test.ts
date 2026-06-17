import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ── getRedisConfig ────────────────────────────────────────────────────────────

describe('getRedisConfig', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('returns REDIS_URL string when set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('REDIS_HOST', '')
    const { getRedisConfig } = await import('@/lib/redisClient')
    expect(getRedisConfig()).toBe('redis://localhost:6379')
  })

  it('returns config object when only REDIS_HOST set', async () => {
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('REDIS_HOST', 'myhost')
    vi.stubEnv('REDIS_PORT', '6380')
    vi.stubEnv('REDIS_PASSWORD', 'secret')
    vi.stubEnv('REDIS_DB', '1')
    const { getRedisConfig } = await import('@/lib/redisClient')
    const cfg = getRedisConfig() as Record<string, unknown>
    expect(cfg.host).toBe('myhost')
    expect(cfg.port).toBe(6380)
    expect(cfg.password).toBe('secret')
    expect(cfg.db).toBe(1)
  })

  it('uses defaults when REDIS_HOST not set (undefined)', async () => {
    vi.resetModules()
    vi.stubEnv('REDIS_URL', '')
    // Don't stub REDIS_HOST — let it be undefined so ?? 'localhost' applies
    const { getRedisConfig } = await import('@/lib/redisClient')
    const cfg = getRedisConfig() as Record<string, unknown>
    expect(cfg.host).toBe('localhost')
    expect(cfg.port).toBe(6379)
    expect(cfg.db).toBe(0)
  })
})

// ── getRedisClient — REDIS_AVAILABLE false ───────────────────────────────────

describe('getRedisClient — Redis not configured', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('REDIS_HOST', '')
    vi.stubEnv('REDIS_DISABLED', '')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('returns null when REDIS_URL and REDIS_HOST not set', async () => {
    const { getRedisClient } = await import('@/lib/redisClient')
    const client = await getRedisClient()
    expect(client).toBeNull()
  })

  it('returns null when REDIS_DISABLED=true', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('REDIS_DISABLED', 'true')
    const { getRedisClient } = await import('@/lib/redisClient')
    const client = await getRedisClient()
    expect(client).toBeNull()
  })
})

// ── getRedisClient — connection failure ──────────────────────────────────────

describe('getRedisClient — connection fails (degraded mode)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('REDIS_DISABLED', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns null when ioredis ping throws', async () => {
    vi.doMock('ioredis', () => {
      const mock = vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        disconnect: vi.fn(),
      }))
      return { default: mock }
    })
    const { getRedisClient } = await import('@/lib/redisClient')
    const client = await getRedisClient()
    expect(client).toBeNull()
  })
})

// ── getRedisClient — connection success ──────────────────────────────────────

describe('getRedisClient — connection succeeds', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('REDIS_DISABLED', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns client when ioredis ping succeeds', async () => {
    const mockClient = { on: vi.fn(), ping: vi.fn().mockResolvedValue('PONG'), disconnect: vi.fn() }
    vi.doMock('ioredis', () => ({ default: vi.fn().mockImplementation(() => mockClient) }))
    const { getRedisClient } = await import('@/lib/redisClient')
    const client = await getRedisClient()
    expect(client).toBe(mockClient)
    expect(mockClient.ping).toHaveBeenCalled()
  })

  it('returns cached client on second call', async () => {
    const mockClient = { on: vi.fn(), ping: vi.fn().mockResolvedValue('PONG'), disconnect: vi.fn() }
    const MockRedis = vi.fn().mockImplementation(() => mockClient)
    vi.doMock('ioredis', () => ({ default: MockRedis }))
    const { getRedisClient } = await import('@/lib/redisClient')
    await getRedisClient()
    await getRedisClient()
    expect(MockRedis).toHaveBeenCalledTimes(1)
  })
})

// ── resetRedisClient ─────────────────────────────────────────────────────────

describe('resetRedisClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('REDIS_DISABLED', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('allows reconnection after reset', async () => {
    const mockClient = { on: vi.fn(), ping: vi.fn().mockResolvedValue('PONG'), disconnect: vi.fn() }
    const MockRedis = vi.fn().mockImplementation(() => mockClient)
    vi.doMock('ioredis', () => ({ default: MockRedis }))
    const { getRedisClient, resetRedisClient } = await import('@/lib/redisClient')
    await getRedisClient()
    resetRedisClient()
    await getRedisClient()
    expect(MockRedis).toHaveBeenCalledTimes(2)
  })
})
