import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedisClient = vi.hoisted(() => ({
  eval: vi.fn(),
  get:  vi.fn(),
  set:  vi.fn(),
}))

const mockPrisma = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(),
  REDIS_AVAILABLE: true,
}))
vi.mock('@/lib/db', () => ({ default: mockPrisma }))

import { getRedisClient } from '@/lib/redisClient'
import { createRateLimiter, createTenantRateLimiter, getTenantPlanLimit, PLAN_RATE_LIMITS } from '@/lib/rateLimit'

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------- Redis-backed limiter ----------

describe('createRateLimiter — redis: true', () => {
  it('falls back to in-memory when getRedisClient returns null', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
    const rl = createRateLimiter(3, 60_000, { redis: true })
    expect(await rl.check('key-a')).toBe(true)
    expect(await rl.check('key-a')).toBe(true)
    expect(await rl.check('key-a')).toBe(true)
    expect(await rl.check('key-a')).toBe(false)
  })

  it('uses Redis eval when client is available and returns allowed', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockRedisClient as any)
    mockRedisClient.eval.mockResolvedValue([1, 4])
    const rl = createRateLimiter(5, 60_000, { redis: true })
    const ok = await rl.check('key-b')
    expect(ok).toBe(true)
    expect(mockRedisClient.eval).toHaveBeenCalled()
  })

  it('returns false when Redis eval returns [0, 0] (rate limited)', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockRedisClient as any)
    mockRedisClient.eval.mockResolvedValue([0, 0])
    const rl = createRateLimiter(5, 60_000, { redis: true })
    expect(await rl.check('key-c')).toBe(false)
  })

  it('falls back to in-memory when Redis eval throws', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockRedisClient as any)
    mockRedisClient.eval.mockRejectedValue(new Error('Redis error'))
    const rl = createRateLimiter(3, 60_000, { redis: true })
    expect(await rl.check('key-d')).toBe(true)
  })

  it('headers return remaining from Redis eval result', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockRedisClient as any)
    mockRedisClient.eval.mockResolvedValue([1, 2])
    const rl = createRateLimiter(5, 60_000, { redis: true })
    await rl.check('key-e')
    const h = rl.headers('key-e')
    expect(h['X-RateLimit-Limit']).toBe('5')
    expect(h['X-RateLimit-Remaining']).toBe('2')
  })
})

describe('createTenantRateLimiter', () => {
  it('creates a Redis-backed limiter that works correctly', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
    const rl = createTenantRateLimiter(10, 60_000, 'api/missions')
    expect(await rl.check('tenant-x')).toBe(true)
  })
})

// ---------- getTenantPlanLimit ----------

describe('getTenantPlanLimit', () => {
  let tenantN = 0
  function freshTenant() { return `tp-tenant-${++tenantN}` }

  it('returns FREE limit when tenant not found in Prisma', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const limit = await getTenantPlanLimit(freshTenant(), 'optimize')
    expect(limit).toBe(PLAN_RATE_LIMITS.optimize.FREE)
  })

  it('returns PRO limit when Prisma tenant has PRO plan', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'PRO' })
    const limit = await getTenantPlanLimit(freshTenant(), 'optimize')
    expect(limit).toBe(PLAN_RATE_LIMITS.optimize.PRO)
  })

  it('returns ENTERPRISE limit when Prisma tenant has ENTERPRISE plan', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' })
    const limit = await getTenantPlanLimit(freshTenant(), 'api')
    expect(limit).toBe(PLAN_RATE_LIMITS.api.ENTERPRISE)
  })

  it('returns limit from Redis when Redis has the plan cached', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(mockRedisClient as any)
    mockRedisClient.get.mockResolvedValue('PRO')
    mockRedisClient.set.mockResolvedValue('OK')
    const limit = await getTenantPlanLimit(freshTenant(), 'import')
    expect(limit).toBe(PLAN_RATE_LIMITS.import.PRO)
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to FREE on Prisma error', async () => {
    vi.mocked(getRedisClient).mockResolvedValue(null)
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB fail'))
    const limit = await getTenantPlanLimit(freshTenant(), 'optimize')
    expect(limit).toBe(PLAN_RATE_LIMITS.optimize.FREE)
  })
})
