import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

// Tests for buildExternalRoutingMatrix using module reload per describe block
// so we can set ROUTING_API_TYPE / KEY / URL at load time.

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ----- no credentials (default env) -----
describe('buildExternalRoutingMatrix — no credentials', () => {
  it('returns null when ROUTING_API_TYPE is empty', async () => {
    const { buildExternalRoutingMatrix } = await import('../externalRoutingApi')
    const result = await buildExternalRoutingMatrix([
      { id: 'A', lat: 45.9, lng: 6.1 },
      { id: 'B', lat: 46.0, lng: 6.2 },
    ])
    expect(result).toBeNull()
  })

  it('returns null for fewer than 2 points', async () => {
    const { buildExternalRoutingMatrix } = await import('../externalRoutingApi')
    const result = await buildExternalRoutingMatrix([{ id: 'A', lat: 45.9, lng: 6.1 }])
    expect(result).toBeNull()
  })
})

// ----- generic API -----
describe('buildExternalRoutingMatrix — generic API', () => {
  let buildExternalRoutingMatrix: (
    points: Array<{ id: string; lat: number; lng: number }>,
    timeoutMs?: number,
  ) => Promise<unknown>
  let mockFetch: ReturnType<typeof vi.fn>

  const POINTS = [
    { id: 'A', lat: 45.9, lng: 6.1 },
    { id: 'B', lat: 46.0, lng: 6.2 },
  ]

  beforeAll(async () => {
    vi.stubEnv('ROUTING_API_TYPE', 'generic')
    vi.stubEnv('ROUTING_API_KEY', 'test-key')
    vi.stubEnv('ROUTING_API_URL', 'http://osrm.example.com')
    vi.resetModules()

    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.doMock('../distanceCache', () => ({ cachedDist: vi.fn(() => 5) }))

    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('../externalRoutingApi')
    buildExternalRoutingMatrix = mod.buildExternalRoutingMatrix
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  beforeEach(() => mockFetch.mockReset())

  it('returns OsrmMatrix on valid response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 'Ok',
        distances: [[0, 5000], [5000, 0]],
        durations: [[0, 300], [300, 0]],
      }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result).not.toBeNull()
    expect(result.size).toBe(2)
    expect(result.distance(0, 0)).toBe(0)
    expect(result.duration(0, 0)).toBe(0)
    expect(result.distance(0, 1)).toBeGreaterThan(0)
    expect(result.duration(0, 1)).toBeGreaterThan(0)
  })

  it('distance falls back to cachedDist for invalid/missing entries', async () => {
    // Return -1 distance values → fallback to cachedDist
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 'Ok',
        distances: [[0, -1], [-1, 0]],
        durations: [[0, -1], [-1, 0]],
      }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result).not.toBeNull()
    // cachedDist mock returns 5, so distance(0,1) = 5
    expect(result.distance(0, 1)).toBe(5)
    // duration -1 → returns 0
    expect(result.duration(0, 1)).toBe(0)
  })

  it('indexOf returns correct index by point id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 'Ok',
        distances: [[0, 5000], [5000, 0]],
        durations: [[0, 300], [300, 0]],
      }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result.indexOf('A')).toBe(0)
    expect(result.indexOf('B')).toBe(1)
    expect(result.indexOf('X')).toBe(-1)
  })

  it('returns null and catches error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    })
    const result = await buildExternalRoutingMatrix(POINTS)
    expect(result).toBeNull()
  })

  it('returns null when response code is not Ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 'Error' }),
    })
    const result = await buildExternalRoutingMatrix(POINTS)
    expect(result).toBeNull()
  })

  it('returns null when generic URL is missing', async () => {
    // Use a separate module load with URL=''
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.stubEnv('ROUTING_API_TYPE', 'generic')
    vi.stubEnv('ROUTING_API_KEY', 'key')
    vi.stubEnv('ROUTING_API_URL', '')
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.doMock('../distanceCache', () => ({ cachedDist: vi.fn(() => 5) }))
    const mod2 = await import('../externalRoutingApi')
    const result = await mod2.buildExternalRoutingMatrix(POINTS)
    expect(result).toBeNull()
    // Restore for next tests
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

// ----- unknown API type -----
describe('buildExternalRoutingMatrix — unknown type', () => {
  let buildExternalRoutingMatrix: (
    points: Array<{ id: string; lat: number; lng: number }>,
  ) => Promise<unknown>

  beforeAll(async () => {
    vi.stubEnv('ROUTING_API_TYPE', 'unknown-api')
    vi.stubEnv('ROUTING_API_KEY', 'test-key')
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.doMock('../distanceCache', () => ({ cachedDist: vi.fn(() => 5) }))
    const mod = await import('../externalRoutingApi')
    buildExternalRoutingMatrix = mod.buildExternalRoutingMatrix
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns null for unknown routing type', async () => {
    const result = await buildExternalRoutingMatrix([
      { id: 'A', lat: 45.9, lng: 6.1 },
      { id: 'B', lat: 46.0, lng: 6.2 },
    ])
    expect(result).toBeNull()
  })
})

// ----- HERE API -----
describe('buildExternalRoutingMatrix — HERE API', () => {
  let buildExternalRoutingMatrix: (
    points: Array<{ id: string; lat: number; lng: number }>,
    timeoutMs?: number,
  ) => Promise<unknown>
  let mockFetch: ReturnType<typeof vi.fn>

  const POINTS = [
    { id: 'A', lat: 45.9, lng: 6.1 },
    { id: 'B', lat: 46.0, lng: 6.2 },
  ]

  beforeAll(async () => {
    vi.stubEnv('ROUTING_API_TYPE', 'here')
    vi.stubEnv('ROUTING_API_KEY', 'here-api-key')
    vi.stubEnv('ROUTING_API_URL', '')
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.doMock('../distanceCache', () => ({ cachedDist: vi.fn(() => 5) }))
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const mod = await import('../externalRoutingApi')
    buildExternalRoutingMatrix = mod.buildExternalRoutingMatrix
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  beforeEach(() => mockFetch.mockReset())

  it('returns OsrmMatrix on valid HERE response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        matrix: {
          travelTimes: [0, 300, 300, 0],
          distances: [0, 5000, 5000, 0],
          numOrigins: 2,
          numDestinations: 2,
        },
      }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result).not.toBeNull()
    expect(result.size).toBe(2)
    // dur[0][1] = 300/60 = 5 min
    expect(result.duration(0, 1)).toBeCloseTo(5, 1)
    // dist[0][1] = 5000/1000 = 5 km
    expect(result.distance(0, 1)).toBeCloseTo(5, 1)
  })

  it('returns null on HERE API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' })
    const result = await buildExternalRoutingMatrix(POINTS)
    expect(result).toBeNull()
  })

  it('handles HERE response with no matrix data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    // No matrix data → dist/dur arrays remain -1 → fallback
    expect(result).not.toBeNull()
  })
})

// ----- Trimble API -----
describe('buildExternalRoutingMatrix — Trimble API', () => {
  let buildExternalRoutingMatrix: (
    points: Array<{ id: string; lat: number; lng: number }>,
    timeoutMs?: number,
  ) => Promise<unknown>
  let mockFetch: ReturnType<typeof vi.fn>

  const POINTS = [
    { id: 'A', lat: 45.9, lng: 6.1 },
    { id: 'B', lat: 46.0, lng: 6.2 },
  ]

  beforeAll(async () => {
    vi.stubEnv('ROUTING_API_TYPE', 'trimble')
    vi.stubEnv('ROUTING_API_KEY', 'trimble-key')
    vi.stubEnv('ROUTING_API_URL', 'https://pcmiler.example.com')
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.doMock('../distanceCache', () => ({ cachedDist: vi.fn(() => 5) }))
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const mod = await import('../externalRoutingApi')
    buildExternalRoutingMatrix = mod.buildExternalRoutingMatrix
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  beforeEach(() => mockFetch.mockReset())

  it('returns OsrmMatrix on valid Trimble response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        RouteMatrixResults: [
          { Distances: [{ Distance: 10, Time: 600 }, { Distance: 10, Time: 600 }] },
          { Distances: [{ Distance: 10, Time: 600 }, { Distance: 10, Time: 600 }] },
        ],
      }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result).not.toBeNull()
    expect(result.size).toBe(2)
  })

  it('returns null on Trimble API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })
    const result = await buildExternalRoutingMatrix(POINTS)
    expect(result).toBeNull()
  })

  it('handles empty RouteMatrixResults', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ RouteMatrixResults: [] }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result).not.toBeNull()
  })

  // Regression N1: `if (!oi === undefined) continue` — operator precedence bug, `!oi` (boolean)
  // evaluated before `===`, so the condition was always false and never actually guarded
  // anything. If the API ever returns more result rows than requested origins (malformed/
  // oversized response), `oi` is undefined for the extra row and `dist[oi][di] = ...` throws,
  // caught by the outer try/catch, silently discarding the otherwise-valid matrix and falling
  // back to OSRM/haversine instead of the real API data.
  it('ignores an extra RouteMatrixResults row beyond the requested origins instead of throwing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        RouteMatrixResults: [
          { Distances: [{ Distance: 10, Time: 600 }, { Distance: 10, Time: 600 }] },
          { Distances: [{ Distance: 10, Time: 600 }, { Distance: 10, Time: 600 }] },
          { Distances: [{ Distance: 10, Time: 600 }, { Distance: 10, Time: 600 }] }, // extra row, no matching origin
        ],
      }),
    })
    const result = await buildExternalRoutingMatrix(POINTS) as any
    expect(result).not.toBeNull()
    expect(result.size).toBe(2)
  })
})
