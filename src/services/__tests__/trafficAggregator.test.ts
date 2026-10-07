import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/traffic/trafficTarBuilder', () => ({
  buildTrafficTar: vi.fn(() => null),
  writeTrafficTar: vi.fn(),
}))

type Row = { latitude: number; longitude: number; speedKmh: number | null; recordedAt: Date }
const mockFindPositions = vi.fn(async (_args: unknown) => [] as Row[])

vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { driverPosition: { findMany: (args: unknown) => mockFindPositions(args) } },
}))

import {
  collectGpsSpeeds,
  collectDatexEvents,
  startTrafficAggregation,
  stopTrafficAggregation,
} from '../trafficAggregator'

beforeEach(() => {
  vi.clearAllMocks()
  stopTrafficAggregation()
})

describe('collectGpsSpeeds', () => {
  it('returns empty array when no positions', async () => {
    mockFindPositions.mockResolvedValueOnce([])
    expect(await collectGpsSpeeds()).toEqual([])
  })

  // The worker used to read a memory store only the web process filled: it never saw a speed.
  it('reads the stored positions: only the last 5 minutes, only moving trucks, one per truck', async () => {
    const before = Date.now()
    await collectGpsSpeeds()
    const args = mockFindPositions.mock.calls[0][0] as {
      where: { recordedAt: { gte: Date }; speedKmh: { gt: number } }
      distinct: string[]
      orderBy: { recordedAt: string }
    }
    expect(args.where.speedKmh).toEqual({ gt: 2 })
    // The cut-off is taken a few ms after `before`, so the window seen from here is ≤ 5 min.
    expect(before - args.where.recordedAt.gte.getTime()).toBeLessThanOrEqual(300_000)
    expect(before - args.where.recordedAt.gte.getTime()).toBeGreaterThan(295_000)
    expect(args.distinct).toEqual(['driverId'])
    expect(args.orderBy).toEqual({ recordedAt: 'desc' })
  })

  it('returns anonymous observations: coordinates, speed and time, no driver or tenant', async () => {
    const recordedAt = new Date(Date.now() - 5000)
    mockFindPositions.mockResolvedValueOnce([
      { latitude: 45.9, longitude: 6.1, speedKmh: 50, recordedAt },
    ])
    const result = await collectGpsSpeeds()
    expect(result).toEqual([
      { lat: 45.9, lng: 6.1, speedKmh: 50, timestamp: recordedAt.getTime(), source: 'gps' },
    ])
  })

  it('returns empty array when the database is unavailable', async () => {
    mockFindPositions.mockRejectedValueOnce(new Error('unavailable'))
    expect(await collectGpsSpeeds()).toEqual([])
  })
})

describe('collectDatexEvents', () => {
  it('returns empty array when DATEX_II_URL not set (default test env)', async () => {
    expect(await collectDatexEvents()).toEqual([])
  })
})

describe('startTrafficAggregation / stopTrafficAggregation', () => {
  it('does not throw when VALHALLA_URL is not set', () => {
    expect(() => startTrafficAggregation()).not.toThrow()
  })

  it('stopTrafficAggregation does not throw when aggregation is not running', () => {
    expect(() => stopTrafficAggregation()).not.toThrow()
  })

  it('calling stop twice does not throw', () => {
    stopTrafficAggregation()
    expect(() => stopTrafficAggregation()).not.toThrow()
  })
})
