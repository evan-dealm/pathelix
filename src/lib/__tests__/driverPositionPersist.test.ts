import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateMany = vi.fn()
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({ driverPosition: { createMany: mockCreateMany } }),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { persistDriverPositions } from '../driverPositionPersist'

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateMany.mockResolvedValue({ count: 1 })
})

describe('persistDriverPositions', () => {
  it('does nothing for an empty batch', async () => {
    await persistDriverPositions('t1', [])
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('writes one row per reading with recordedAt as a Date', async () => {
    await persistDriverPositions('t1', [
      { driverId: 'd1', lat: 45.75, lng: 4.85, speedKmh: 42, timestamp: 1_700_000_000_000 },
    ])
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [{
        driverId: 'd1', latitude: 45.75, longitude: 4.85,
        speedKmh: 42, heading: null,
        recordedAt: new Date(1_700_000_000_000),
      }],
    })
  })

  it('defaults speedKmh/heading to null when omitted', async () => {
    await persistDriverPositions('t1', [
      { driverId: 'd1', lat: 45.75, lng: 4.85, timestamp: 1_700_000_000_000 },
    ])
    const data = mockCreateMany.mock.calls[0][0].data
    expect(data[0].speedKmh).toBeNull()
    expect(data[0].heading).toBeNull()
  })

  it('batches multiple readings into a single createMany call', async () => {
    await persistDriverPositions('t1', [
      { driverId: 'd1', lat: 1, lng: 1, timestamp: 1 },
      { driverId: 'd2', lat: 2, lng: 2, timestamp: 2 },
    ])
    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    expect(mockCreateMany.mock.calls[0][0].data).toHaveLength(2)
  })

  it('swallows DB errors — a webhook must still 200 even if persistence fails', async () => {
    mockCreateMany.mockRejectedValue(new Error('DB down'))
    await expect(
      persistDriverPositions('t1', [{ driverId: 'd1', lat: 1, lng: 1, timestamp: 1 }]),
    ).resolves.toBeUndefined()
  })
})
