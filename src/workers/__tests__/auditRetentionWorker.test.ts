import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/env', () => ({ validateEnv: vi.fn() }))

const mockExec = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ default: { $executeRawUnsafe: mockExec, $disconnect: vi.fn() } }))
vi.mock('bullmq', () => ({
  Worker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  Queue:  vi.fn(() => ({ add: vi.fn(), on: vi.fn(), close: vi.fn() })),
}))

import {
  purgeExpiredAuditLogs, purgeExpiredIdempotencyKeys, purgeExpiredDriverPositions, purgeExpiredAiJobs,
} from '../auditRetentionWorker'

beforeEach(() => mockExec.mockReset())

const daysBetween = (d: Date) => (Date.now() - d.getTime()) / 86_400_000

describe('retention purges', () => {
  it('deletes audit logs older than 365 days, in bounded batches until nothing is left', async () => {
    mockExec.mockResolvedValueOnce(5000).mockResolvedValueOnce(5000).mockResolvedValueOnce(12)
    const result = await purgeExpiredAuditLogs()
    expect(result.deleted).toBe(10_012)
    expect(mockExec).toHaveBeenCalledTimes(3)
    const [sql, cutoff] = mockExec.mock.calls[0] as [string, Date]
    expect(sql).toContain('DELETE FROM "AuditLog"')
    expect(sql).toContain('LIMIT 5000')
    expect(daysBetween(cutoff)).toBeGreaterThan(364)
    expect(daysBetween(cutoff)).toBeLessThan(366)
  })

  it('keeps 30 days of GPS positions by default (the table had no retention at all)', async () => {
    mockExec.mockResolvedValueOnce(3)
    const result = await purgeExpiredDriverPositions()
    expect(result.deleted).toBe(3)
    const [sql, cutoff] = mockExec.mock.calls[0] as [string, Date]
    expect(sql).toContain('"DriverPosition" WHERE "recordedAt" <')
    expect(Math.round(daysBetween(cutoff))).toBe(30)
  })

  it('keeps idempotency keys 48h', async () => {
    mockExec.mockResolvedValueOnce(0)
    await purgeExpiredIdempotencyKeys()
    const [, cutoff] = mockExec.mock.calls[0] as [string, Date]
    expect(Math.round((Date.now() - cutoff.getTime()) / 3_600_000)).toBe(48)
  })

  it('removes AI jobs past their own expiry', async () => {
    mockExec.mockResolvedValueOnce(1)
    await purgeExpiredAiJobs()
    expect(mockExec.mock.calls[0][0]).toContain('"AiJob" WHERE "expiresAt" <')
  })

  it('propagates DB errors (the job is marked failed, never silently "done")', async () => {
    mockExec.mockRejectedValueOnce(new Error('DB down'))
    await expect(purgeExpiredAuditLogs()).rejects.toThrow('DB down')
  })
})
