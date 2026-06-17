/**
 * Tests for driverStatusPubSub:
 * - publishStatusUpdate updates shared _statusStore
 * - Redis publish uses {[driverId]: {[missionId]: status}} format (SSE-compatible)
 * - getInMemoryStatuses returns rich data from the private store
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.fn(() => Promise.resolve(0))

vi.mock('@/lib/redisClient', () => ({
  REDIS_AVAILABLE: true,
  getRedisClient: vi.fn(async () => ({
    publish: mockPublish,
  })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { publishStatusUpdate, getInMemoryStatuses } from '@/lib/driverStatusPubSub'
import { _statusStore } from '@/lib/statusStore'

beforeEach(() => {
  vi.clearAllMocks()
  _statusStore.clear()
})

describe('publishStatusUpdate', () => {
  it('updates sharedStatusStore with mission status', async () => {
    await publishStatusUpdate({
      tenantId:  'tenant-1',
      driverId:  'd-1',
      missionId: 'm-1',
      date:      '2026-05-15',
      status:    'done',
      timestamp: '2026-05-15T10:00:00.000Z',
    })

    const key = `${encodeURIComponent('tenant-1')}|${encodeURIComponent('d-1')}|2026-05-15`
    expect(_statusStore.get(key)).toEqual({ 'm-1': 'done' })
  })

  it('publishes in {[driverId]: {[missionId]: status}} format for SSE compatibility', async () => {
    await publishStatusUpdate({
      tenantId:  'tenant-1',
      driverId:  'd-1',
      missionId: 'm-1',
      date:      '2026-05-15',
      status:    'en_route',
      timestamp: '2026-05-15T09:00:00.000Z',
    })

    expect(mockPublish).toHaveBeenCalledOnce()
    const [channel, payload] = mockPublish.mock.calls[0] as unknown as [string, string]
    expect(channel).toBe('driver-status:tenant-1:2026-05-15')

    const parsed = JSON.parse(payload)
    // Must be {driverId: {missionId: status}} — NOT a DriverStatusEvent
    expect(parsed['d-1']).toBeDefined()
    expect(parsed['d-1']['m-1']).toBe('en_route')
    expect(parsed.tenantId).toBeUndefined()
    expect(parsed.timestamp).toBeUndefined()
  })

  it('accumulates multiple missions for same driver before publishing', async () => {
    await publishStatusUpdate({ tenantId: 'tenant-1', driverId: 'd-1', missionId: 'm-1', date: '2026-05-15', status: 'done', timestamp: '2026-05-15T10:00:00Z' })
    await publishStatusUpdate({ tenantId: 'tenant-1', driverId: 'd-1', missionId: 'm-2', date: '2026-05-15', status: 'en_route', timestamp: '2026-05-15T10:05:00Z' })

    const [, secondPayload] = mockPublish.mock.calls[1] as unknown as [string, string]
    const parsed = JSON.parse(secondPayload)
    // Second publish includes both missions (accumulated state)
    expect(parsed['d-1']['m-1']).toBe('done')
    expect(parsed['d-1']['m-2']).toBe('en_route')
  })
})

describe('getInMemoryStatuses', () => {
  it('returns rich status objects with timestamp and GPS', async () => {
    await publishStatusUpdate({
      tenantId:  'tenant-1',
      driverId:  'd-1',
      missionId: 'm-1',
      date:      '2026-05-15',
      status:    'arrived',
      timestamp: '2026-05-15T11:00:00.000Z',
      latitude:  45.75,
      longitude: 4.85,
    })

    const result = getInMemoryStatuses('tenant-1', '2026-05-15', 'd-1')
    expect(result['d-1']).toBeDefined()
    expect(result['d-1']['m-1'].status).toBe('arrived')
    expect(result['d-1']['m-1'].latitude).toBe(45.75)
    expect(result['d-1']['m-1'].timestamp).toBe('2026-05-15T11:00:00.000Z')
  })

  it('filters by driverId when specified', async () => {
    await publishStatusUpdate({ tenantId: 'tenant-1', driverId: 'd-1', missionId: 'm-1', date: '2026-05-15', status: 'done', timestamp: '2026-05-15T10:00:00Z' })
    await publishStatusUpdate({ tenantId: 'tenant-1', driverId: 'd-2', missionId: 'm-2', date: '2026-05-15', status: 'todo', timestamp: '2026-05-15T10:00:00Z' })

    const result = getInMemoryStatuses('tenant-1', '2026-05-15', 'd-1')
    expect(result['d-1']).toBeDefined()
    expect(result['d-2']).toBeUndefined()
  })

  it('does not leak cross-tenant statuses', async () => {
    await publishStatusUpdate({ tenantId: 'tenant-A', driverId: 'd-1', missionId: 'm-1', date: '2026-05-15', status: 'done', timestamp: '2026-05-15T10:00:00Z' })

    const result = getInMemoryStatuses('tenant-B', '2026-05-15')
    expect(Object.keys(result)).toHaveLength(0)
  })
})
