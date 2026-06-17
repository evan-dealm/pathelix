import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/algorithm', () => ({
  haversineKm: vi.fn(() => 10),
  roadDistKm:  vi.fn(() => 12),
}))
vi.mock('@/lib/httpClient', () => ({
  fetchProtected: vi.fn(),
}))
vi.mock('@/lib/circuitBreaker', () => ({
  CircuitOpenError: class CircuitOpenError extends Error {},
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { haversineFallbackKm, calcRoute, calcTrimbleMatrix } from '../trimble'
import { haversineKm, roadDistKm } from '@/lib/algorithm'

const A = { lat: 45.9, lng: 6.1 }
const B = { lat: 46.0, lng: 6.2 }
const C = { lat: 46.1, lng: 6.3 }

beforeEach(() => vi.clearAllMocks())

describe('haversineFallbackKm', () => {
  it('delegates to haversineKm with correct args', () => {
    haversineFallbackKm(A, B)
    expect(haversineKm).toHaveBeenCalledWith(45.9, 6.1, 46.0, 6.2)
  })

  it('returns the value from haversineKm', () => {
    vi.mocked(haversineKm).mockReturnValueOnce(25.5)
    expect(haversineFallbackKm(A, B)).toBe(25.5)
  })
})

// TRIMBLE_API_URL and TRIMBLE_API_KEY are '' in test env → calcTrimbleRoute returns null immediately
describe('calcRoute (no Trimble credentials)', () => {
  it('returns haversine-based fallback', async () => {
    vi.mocked(haversineKm).mockReturnValueOnce(10)
    const result = await calcRoute({ origin: A, destination: B })
    expect(result.distanceKm).toBe(10)
    // estimateDuration(10, 50) = 10 * 1.3 * 60 / 50 = 15.6
    expect(result.durationMin).toBeCloseTo(15.6, 1)
  })

  it('sums legs over multiple waypoints', async () => {
    vi.mocked(haversineKm).mockReturnValueOnce(10).mockReturnValueOnce(5)
    const result = await calcRoute({ origin: A, destination: C, waypoints: [B] })
    expect(result.distanceKm).toBe(15)
  })

  it('returns zero duration for identical origin and destination', async () => {
    vi.mocked(haversineKm).mockReturnValueOnce(0)
    const result = await calcRoute({ origin: A, destination: A })
    expect(result.durationMin).toBe(0)
  })
})

describe('calcTrimbleMatrix (no Trimble credentials)', () => {
  it('returns empty matrix for 0 points', async () => {
    expect(await calcTrimbleMatrix([])).toEqual([])
  })

  it('returns [[0]] for a single point', async () => {
    expect(await calcTrimbleMatrix([A])).toEqual([[0]])
  })

  it('diagonal entries are 0', async () => {
    vi.mocked(roadDistKm).mockReturnValue(10)
    const m = await calcTrimbleMatrix([A, B])
    expect(m[0][0]).toBe(0)
    expect(m[1][1]).toBe(0)
  })

  it('uses roadDistKm + estimateDuration for off-diagonal', async () => {
    vi.mocked(roadDistKm).mockReturnValue(12)
    const m = await calcTrimbleMatrix([A, B])
    // estimateDuration(12) = 12 * 1.3 * 60 / 50 = 18.72
    expect(m[0][1]).toBeCloseTo(18.72, 1)
    expect(m[1][0]).toBeCloseTo(18.72, 1)
  })

  it('returns n×n matrix for n>2 points', async () => {
    vi.mocked(roadDistKm).mockReturnValue(5)
    const m = await calcTrimbleMatrix([A, B, C])
    expect(m).toHaveLength(3)
    expect(m.every(row => row.length === 3)).toBe(true)
  })
})
