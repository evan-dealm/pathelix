import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.hoisted(() => vi.fn(async () => 1))
const mockGetClient = vi.hoisted(() => vi.fn(async () => ({ publish: mockPublish })))

vi.mock('@/lib/redisClient', () => ({ REDIS_AVAILABLE: true, getRedisClient: mockGetClient }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { publishStatusUpdate, channelName } from '@/lib/driverStatusPubSub'

const EVENT = { tenantId: 't-1', driverId: 'd-1', missionId: 'm-1', date: '2026-05-15', status: 'done', timestamp: '2026-05-15T10:00:00Z' }

beforeEach(() => { mockPublish.mockClear(); mockGetClient.mockClear() })

describe('publishStatusUpdate', () => {
  it('signals the change on the tenant/day channel (subscribers re-read the database)', async () => {
    await publishStatusUpdate(EVENT)
    expect(mockPublish).toHaveBeenCalledWith('driver-status:t-1:2026-05-15', JSON.stringify({ driverId: 'd-1', missionId: 'm-1', status: 'done' }))
  })

  it('never throws when Redis is unavailable or failing', async () => {
    mockGetClient.mockResolvedValueOnce(null as never)
    await expect(publishStatusUpdate(EVENT)).resolves.toBeUndefined()
    mockPublish.mockRejectedValueOnce(new Error('down'))
    await expect(publishStatusUpdate(EVENT)).resolves.toBeUndefined()
  })

  it('keeps channels tenant-scoped', () => {
    expect(channelName('a', '2026-01-01')).not.toBe(channelName('b', '2026-01-01'))
  })
})
