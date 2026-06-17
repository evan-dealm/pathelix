import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/traffic/trafficTarBuilder', () => ({
  buildTrafficTar:  vi.fn(() => null),
  writeTrafficTar:  vi.fn(),
}))

const mockGetAllCurrentPositions = vi.fn(() => [] as { lat: number; lng: number; speedKmh: number; updatedAt: number }[])

vi.mock('@/lib/obdStore', () => ({
  getAllCurrentPositions: mockGetAllCurrentPositions,
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
    mockGetAllCurrentPositions.mockReturnValueOnce([])
    expect(await collectGpsSpeeds()).toEqual([])
  })

  it('filters positions older than 5 minutes', async () => {
    mockGetAllCurrentPositions.mockReturnValueOnce([
      { lat: 45.9, lng: 6.1, speedKmh: 50, updatedAt: Date.now() - 400_000 },
    ])
    expect(await collectGpsSpeeds()).toHaveLength(0)
  })

  it('filters positions with speed ≤ 2 km/h', async () => {
    mockGetAllCurrentPositions.mockReturnValueOnce([
      { lat: 45.9, lng: 6.1, speedKmh: 2, updatedAt: Date.now() - 1000 },
    ])
    expect(await collectGpsSpeeds()).toHaveLength(0)
  })

  it('returns valid recent fast observations', async () => {
    mockGetAllCurrentPositions.mockReturnValueOnce([
      { lat: 45.9, lng: 6.1, speedKmh: 50, updatedAt: Date.now() - 5000 },
    ])
    const result = await collectGpsSpeeds()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ lat: 45.9, lng: 6.1, speedKmh: 50, source: 'gps' })
  })

  it('accepts positions at exactly 3 km/h', async () => {
    mockGetAllCurrentPositions.mockReturnValueOnce([
      { lat: 45.9, lng: 6.1, speedKmh: 3, updatedAt: Date.now() - 1000 },
    ])
    expect(await collectGpsSpeeds()).toHaveLength(1)
  })

  it('returns empty array when obdStore throws', async () => {
    mockGetAllCurrentPositions.mockImplementationOnce(() => { throw new Error('unavailable') })
    expect(await collectGpsSpeeds()).toEqual([])
  })

  it('filters multiple positions correctly', async () => {
    const now = Date.now()
    mockGetAllCurrentPositions.mockReturnValueOnce([
      { lat: 45.9, lng: 6.1, speedKmh: 50, updatedAt: now - 5000 },   // valid
      { lat: 46.0, lng: 6.2, speedKmh: 1,  updatedAt: now - 5000 },   // too slow
      { lat: 46.1, lng: 6.3, speedKmh: 60, updatedAt: now - 400_000 }, // too old
    ])
    expect(await collectGpsSpeeds()).toHaveLength(1)
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
