import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GeoPoint } from '../valhallaMatrix'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/algorithm', () => ({
  trafficFactor: vi.fn(() => 1.0),
}))

// In-memory Redis so the cache round-trip itself is exercised.
const redisStore = vi.hoisted(() => new Map<string, string>())
const redisState = vi.hoisted(() => ({ available: false }))
vi.mock('@/lib/redisClient', () => ({
  get REDIS_AVAILABLE() { return redisState.available },
  getRedisClient: vi.fn(async () => redisState.available ? {
    get: async (k: string) => redisStore.get(k) ?? null,
    set: async (k: string, v: string) => { redisStore.set(k, v); return 'OK' },
  } : null),
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
  beforeEach(async () => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    vi.stubEnv('VALHALLA_TIMEOUT_MS', '5000')
    ;(await import('../valhallaMatrix'))._resetValhallaBreaker()
    redisStore.clear()
    redisState.available = false
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

  // Regression: found via manual QA on a 100-driver/40-mission tenant — every real VRP run
  // silently used pure haversine distances, no matter how healthy Valhalla was. Root cause:
  // the chunk size sent sources.length * targets.length = 6400 pairs per request, and
  // Valhalla's costmatrix action rejects anything over its max_matrix_locations (2500 by
  // default) with a 400 — so every single chunk failed, on every run with >80 combined
  // points. This asserts the actual wire request never exceeds that budget, for a fleet size
  // (120 points) well past where the old 80-point chunk size broke.
  it('never sends a sources*targets product above Valhallas default max_matrix_locations (2500)', async () => {
    const manyPoints: GeoPoint[] = Array.from({ length: 120 }, (_, i) => ({
      id: `p${i}`, lat: 45.7 + i * 0.001, lng: 6.0 + i * 0.001,
    }))

    const seenChunkSizes: number[] = []
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      seenChunkSizes.push(body.sources.length * body.targets.length)
      const n = body.sources.length, m = body.targets.length
      return {
        ok: true,
        json: async () => ({
          sources_to_targets: Array.from({ length: n }, () =>
            Array.from({ length: m }, () => ({ distance: 1, time: 60 }))),
        }),
      } as Response
    })

    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(manyPoints)

    expect(matrix.source).toBe('valhalla-chunked')
    expect(seenChunkSizes.length).toBeGreaterThan(0)
    for (const size of seenChunkSizes) {
      expect(size).toBeLessThanOrEqual(2500)
    }
  })

  // Distances depend only on the pair of points: a deterministic fake Valhalla.
  function pairDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
    return Math.round((a.lat * 1000 + b.lon * 7) * 10) / 10
  }
  function fakeValhalla() {
    return vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return {
        ok: true,
        json: async () => ({
          sources_to_targets: body.sources.map((src: { lat: number; lon: number }) =>
            body.targets.map((tgt: { lat: number; lon: number }) => ({ distance: pairDistance(src, tgt), time: 60 }))),
        }),
      } as Response
    })
  }

  it('serves a cached matrix correctly when the same points come back in another order', async () => {
    redisState.available = true
    fakeValhalla()
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    await buildValhallaMatrix(points) // fills the cache
    await new Promise(r => setTimeout(r, 0))
    const fetchSpy = vi.mocked(global.fetch)
    fetchSpy.mockClear()

    const reordered = [points[2], points[0], points[1]]
    const m = await buildValhallaMatrix(reordered)
    expect(fetchSpy).not.toHaveBeenCalled() // cache hit
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const a = { lat: reordered[i].lat, lon: reordered[i].lng }
        const b = { lat: reordered[j].lat, lon: reordered[j].lng }
        expect(m.distance(i, j)).toBeCloseTo(pairDistance(a, b), 1)
      }
    }
  })

  it('never caches a matrix partly filled with straight-line distances', async () => {
    redisState.available = true
    const many: GeoPoint[] = Array.from({ length: 60 }, (_, i) => ({ id: `q${i}`, lat: 45 + i * 0.01, lng: 6 }))
    let call = 0
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      call++
      if (call === 1) return { ok: false, status: 503, text: async () => '' } as Response
      return { ok: true, json: async () => ({ sources_to_targets: [] }) } as Response
    })
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const m = await buildValhallaMatrix(many)
    await new Promise(r => setTimeout(r, 0))
    expect(m.degraded).toBe(true)
    expect(redisStore.size).toBe(0)
  })

  it('skips Valhalla for a while after a failure (no 15 s wait per run while it is down)', async () => {
    const spy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'))
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    expect((await buildValhallaMatrix(points)).source).toBe('haversine')
    spy.mockClear()
    expect((await buildValhallaMatrix(points)).source).toBe('haversine')
    expect(spy).not.toHaveBeenCalled()
  })

  it('cache keys include every vehicle dimension (axles, hazmat) but not the point order', async () => {
    const { matrixCacheKey } = await import('../valhallaMatrix')
    const dims = { weightTon: 26, heightM: 4, widthM: 2.55, lengthM: 12, axleCount: 3, hazmat: false }
    expect(matrixCacheKey(points, dims)).toBe(matrixCacheKey([...points].reverse(), dims))
    expect(matrixCacheKey(points, dims)).not.toBe(matrixCacheKey(points, { ...dims, axleCount: 4 }))
    expect(matrixCacheKey(points, dims)).not.toBe(matrixCacheKey(points, { ...dims, hazmat: true }))
  })
})
