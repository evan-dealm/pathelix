import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/env', () => ({ validateEnv: vi.fn() }))

const mockDeleteMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    auditLog: { deleteMany: mockDeleteMany },
  },
}))

// Prevent main() from connecting to Redis or calling process.exit
vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(async () => null),
}))
vi.mock('bullmq', () => ({
  Worker: vi.fn(() => ({ on: vi.fn() })),
  Queue:  vi.fn(() => ({ add: vi.fn() })),
}))
vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)

import { purgeExpiredAuditLogs } from '../auditRetentionWorker'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('purgeExpiredAuditLogs', () => {
  it('deletes audit logs older than AUDIT_RETENTION_DAYS (default 365)', async () => {
    mockDeleteMany.mockResolvedValue({ count: 42 })

    const result = await purgeExpiredAuditLogs()

    expect(mockDeleteMany).toHaveBeenCalledOnce()
    const call = mockDeleteMany.mock.calls[0][0]
    expect(call.where.createdAt.lt).toBeInstanceOf(Date)

    // Cutoff should be ~365 days ago
    const cutoff = call.where.createdAt.lt as Date
    const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(364)
    expect(diffDays).toBeLessThan(366)

    expect(result.deleted).toBe(42)
    expect(typeof result.cutoff).toBe('string')
  })

  it('respects AUDIT_RETENTION_DAYS env override (30 days)', async () => {
    vi.stubEnv('AUDIT_RETENTION_DAYS', '30')
    vi.resetModules()
    const { purgeExpiredAuditLogs: purge } = await import('../auditRetentionWorker')

    mockDeleteMany.mockResolvedValue({ count: 5 })
    await purge()

    const cutoff = mockDeleteMany.mock.calls[0][0].where.createdAt.lt as Date
    const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(29)
    expect(diffDays).toBeLessThan(31)
  })

  it('returns deleted count 0 when nothing to purge', async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 })
    const result = await purgeExpiredAuditLogs()
    expect(result.deleted).toBe(0)
  })

  it('propagates DB error (does not swallow)', async () => {
    mockDeleteMany.mockRejectedValue(new Error('DB connection lost'))
    await expect(purgeExpiredAuditLogs()).rejects.toThrow('DB connection lost')
  })
})
