import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GeoPoint } from '../valhallaMatrix'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/algorithm', () => ({
  trafficFactor: vi.fn(() => 1.0),
}))

vi.mock('@/lib/redisClient', () => ({
  REDIS_AVAILABLE: false,
  getRedisClient: vi.fn(async () => null),
}))

const points: GeoPoint[] = [
  { id: 'p0', lat: 45.76, lng: 6.05 },
  { id: 'p1', lat: 45.77, lng: 6.06 },
  { id: 'p2', lat: 45.78, lng: 6.07 },
]

describe('buildValhallaMatrix — no Valhalla URL (haversine fallback)', () => {
  beforeEach(() => {
    vi.stubEnv('VALHALLA_URL', '')
    vi.stubEnv('VALHALLA_FALLBACK_URL', '')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('returns haversine matrix when VALHALLA_URL not set', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
    expect(matrix.size).toBe(3)
  })

  it('indexOf returns correct index for known point', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.indexOf('p0')).toBe(0)
    expect(matrix.indexOf('p2')).toBe(2)
    expect(matrix.indexOf('unknown')).toBe(-1)
  })

  it('distance returns 0 for same point', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.distance(0, 0)).toBe(0)
    expect(matrix.distance(1, 1)).toBe(0)
  })

  it('distance returns positive value between different points', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.distance(0, 1)).toBeGreaterThan(0)
    expect(matrix.distance(0, 2)).toBeGreaterThan(matrix.distance(0, 1))
  })

  it('duration returns 0 for same point', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.duration(0, 0)).toBe(0)
  })

  it('duration returns positive value between different points', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.duration(0, 1)).toBeGreaterThan(0)
  })

  it('returns haversine when fewer than 2 points', async () => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix([points[0]])
    expect(matrix.source).toBe('haversine')
  })

  it('distance returns 0 for out-of-bounds indices', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.distance(-1, 0)).toBe(0)
    expect(matrix.distance(0, 99)).toBe(0)
  })
})

describe('buildValhallaMatrix — Valhalla available (fetch mocked)', () => {
  beforeEach(() => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    vi.stubEnv('VALHALLA_TIMEOUT_MS', '5000')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses Valhalla when URL set and fetch succeeds', async () => {
    const n = points.length
    const mockData = {
      sources_to_targets: Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => ({
          distance: i === j ? 0 : 1.5,
          time:     i === j ? 0 : 120,
        })),
      ),
    }
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response)

    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('valhalla')
    expect(matrix.size).toBe(n)
    expect(matrix.distance(0, 1)).toBe(1.5)
    expect(matrix.duration(0, 1)).toBe(2) // 120s / 60 = 2min
  })

  it('falls back to haversine when Valhalla fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
  })

  it('falls back to haversine when Valhalla returns non-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as Response)
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
  })
})
