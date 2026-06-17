import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

// Separate file: tests calcTrimbleRoute + calcTrimbleMatrix when credentials are present.
// Uses vi.resetModules() + vi.doMock() + dynamic import to reload module with env vars set.

describe('trimble — with credentials', () => {
  let calcTrimbleRoute: (req: { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }) => Promise<{ distanceKm: number; durationMin: number } | null>
  let calcTrimbleMatrix: (points: Array<{ lat: number; lng: number }>) => Promise<number[][]>
  let IS_TRIMBLE_AVAILABLE: boolean
  let mockFetchProtected: ReturnType<typeof vi.fn>
  let MockCircuitOpenError: new (msg?: string) => Error

  beforeAll(async () => {
    vi.stubEnv('TRIMBLE_API_URL', 'https://api.trimble.example.com')
    vi.stubEnv('TRIMBLE_API_KEY', 'test-api-key')
    vi.resetModules()

    mockFetchProtected = vi.fn()
    MockCircuitOpenError = class CircuitOpenError extends Error {
      constructor(msg?: string) { super(msg); this.name = 'CircuitOpenError' }
    }

    vi.doMock('@/lib/httpClient', () => ({ fetchProtected: mockFetchProtected }))
    vi.doMock('@/lib/circuitBreaker', () => ({ CircuitOpenError: MockCircuitOpenError }))
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.doMock('@/lib/algorithm', () => ({
      haversineKm: vi.fn(() => 10),
      roadDistKm: vi.fn(() => 12),
    }))

    const mod = await import('../trimble')
    calcTrimbleRoute = mod.calcTrimbleRoute
    calcTrimbleMatrix = mod.calcTrimbleMatrix
    IS_TRIMBLE_AVAILABLE = mod.IS_TRIMBLE_AVAILABLE
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    mockFetchProtected.mockReset()
  })

  it('IS_TRIMBLE_AVAILABLE is true when env vars set', () => {
    expect(IS_TRIMBLE_AVAILABLE).toBe(true)
  })

  const req = { origin: { lat: 45.9, lng: 6.1 }, destination: { lat: 46.0, lng: 6.2 } }

  describe('calcTrimbleRoute', () => {
    it('returns null and does not throw on CircuitOpenError', async () => {
      mockFetchProtected.mockRejectedValueOnce(new MockCircuitOpenError('circuit open'))
      const result = await calcTrimbleRoute(req)
      expect(result).toBeNull()
    })

    it('returns null and does not throw on generic Error', async () => {
      mockFetchProtected.mockRejectedValueOnce(new Error('network error'))
      const result = await calcTrimbleRoute(req)
      expect(result).toBeNull()
    })

    it('returns null on non-ok response', async () => {
      mockFetchProtected.mockResolvedValueOnce({ ok: false, status: 500 })
      const result = await calcTrimbleRoute(req)
      expect(result).toBeNull()
    })

    it('returns null when response has no report', async () => {
      mockFetchProtected.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      const result = await calcTrimbleRoute(req)
      expect(result).toBeNull()
    })

    it('returns distanceKm and durationMin on success', async () => {
      mockFetchProtected.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ report: { totalDistance: 50000, totalTime: 3600 } }),
      })
      const result = await calcTrimbleRoute(req)
      expect(result).not.toBeNull()
      expect(result!.distanceKm).toBe(50)
      expect(result!.durationMin).toBe(60)
    })

    it('handles missing totalDistance and totalTime (defaults to 0)', async () => {
      mockFetchProtected.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ report: {} }),
      })
      const result = await calcTrimbleRoute(req)
      expect(result).not.toBeNull()
      expect(result!.distanceKm).toBe(0)
      expect(result!.durationMin).toBe(0)
    })
  })

  describe('calcTrimbleMatrix (IS_TRIMBLE_AVAILABLE=true)', () => {
    it('fills matrix using calcTrimbleRoute results', async () => {
      mockFetchProtected.mockResolvedValue({
        ok: true,
        json: async () => ({ report: { totalDistance: 10000, totalTime: 600 } }),
      })
      const A = { lat: 45.9, lng: 6.1 }
      const B = { lat: 46.0, lng: 6.2 }
      const m = await calcTrimbleMatrix([A, B])
      expect(m).toHaveLength(2)
      expect(m[0][0]).toBe(0)
      expect(m[1][1]).toBe(0)
      expect(m[0][1]).toBe(10) // 600s / 60 = 10 min
      expect(m[1][0]).toBe(10)
    })

    it('falls back to roadDistKm when route returns null', async () => {
      mockFetchProtected.mockResolvedValue({ ok: false, status: 503 })
      const A = { lat: 45.9, lng: 6.1 }
      const B = { lat: 46.0, lng: 6.2 }
      const m = await calcTrimbleMatrix([A, B])
      // roadDistKm mocked to 12 → estimateDuration(12) = 12 * 1.3 * 60 / 50 = 18.72
      expect(m[0][1]).toBeCloseTo(18.72, 1)
    })

    it('returns [[0]] for single point', async () => {
      const m = await calcTrimbleMatrix([{ lat: 45.9, lng: 6.1 }])
      expect(m).toEqual([[0]])
    })

    it('handles 3-point matrix concurrently', async () => {
      mockFetchProtected.mockResolvedValue({
        ok: true,
        json: async () => ({ report: { totalDistance: 5000, totalTime: 300 } }),
      })
      const pts = [
        { lat: 45.9, lng: 6.1 },
        { lat: 46.0, lng: 6.2 },
        { lat: 46.1, lng: 6.3 },
      ]
      const m = await calcTrimbleMatrix(pts)
      expect(m).toHaveLength(3)
      expect(m.every(row => row.length === 3)).toBe(true)
      expect(m[0][0]).toBe(0)
      expect(m[1][1]).toBe(0)
      expect(m[2][2]).toBe(0)
    })
  })
})
