import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(async () => null),
  REDIS_AVAILABLE: false,
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const points = [
  { id: 'p0', lat: 45.76, lng: 6.05 },
  { id: 'p1', lat: 45.77, lng: 6.06 },
  { id: 'p2', lat: 45.78, lng: 6.07 },
]

describe('buildOsrmMatrix — no OSRM URL (haversine fallback)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    // Ensure OSRM_URL is NOT set so module uses haversine
    vi.stubEnv('OSRM_URL', '')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('returns haversine matrix when OSRM_URL not set', async () => {
    vi.resetModules()
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.source).toBe('haversine')
    expect(matrix.size).toBe(3)
  })

  it('returns haversine when fewer than 2 points', async () => {
    vi.resetModules()
    vi.stubEnv('OSRM_URL', 'http://osrm:5000')
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix([points[0]])
    expect(matrix.source).toBe('haversine')
    expect(matrix.size).toBe(1)
  })

  it('indexOf returns correct index', async () => {
    vi.resetModules()
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.indexOf('p0')).toBe(0)
    expect(matrix.indexOf('p2')).toBe(2)
    expect(matrix.indexOf('unknown')).toBe(-1)
  })

  it('distance returns 0 for same index', async () => {
    vi.resetModules()
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.distance(0, 0)).toBe(0)
    expect(matrix.distance(1, 1)).toBe(0)
  })

  it('distance returns positive value between different points', async () => {
    vi.resetModules()
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.distance(0, 1)).toBeGreaterThan(0)
  })

  it('duration returns 0 for same index', async () => {
    vi.resetModules()
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.duration(1, 1)).toBe(0)
  })

  it('duration returns positive between different points', async () => {
    vi.resetModules()
    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.duration(0, 2)).toBeGreaterThan(0)
  })
})

describe('buildOsrmMatrix — OSRM URL set (fetch mocked)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses OSRM when URL is set and fetch succeeds', async () => {
    vi.stubEnv('OSRM_URL', 'http://osrm:5000')
    vi.resetModules()

    const n = points.length
    const mockData = {
      code: 'Ok',
      distances: Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : 1500))
      ),
      durations: Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : 120))
      ),
    }
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response)

    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.source).toBe('osrm')
    expect(matrix.size).toBe(n)
    expect(matrix.distance(0, 1)).toBe(1.5) // 1500m → 1.5km rounded
    expect(matrix.duration(0, 1)).toBe(2)   // 120s → 2min
    expect(matrix.distance(0, 0)).toBe(0)
  })

  it('falls back to haversine when OSRM fetch fails', async () => {
    vi.stubEnv('OSRM_URL', 'http://osrm:5000')
    vi.resetModules()

    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.source).toBe('haversine')
  })

  it('falls back to haversine when OSRM returns non-200', async () => {
    vi.stubEnv('OSRM_URL', 'http://osrm:5000')
    vi.resetModules()

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as Response)

    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.source).toBe('haversine')
  })

  it('falls back to haversine when OSRM response code is not Ok', async () => {
    vi.stubEnv('OSRM_URL', 'http://osrm:5000')
    vi.resetModules()

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'Error', message: 'No route found' }),
    } as Response)

    const { buildOsrmMatrix } = await import('../osrmMatrix')
    const matrix = await buildOsrmMatrix(points)
    expect(matrix.source).toBe('haversine')
  })
})
