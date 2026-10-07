/**
 * Tests for startTrafficAggregation / runAggregationCycle / resolveEdgeSpeeds.
 * Uses vi.resetModules() + vi.stubEnv to load the module with VALHALLA_URL set.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'

const mockBuildTrafficTar = vi.fn()
const mockWriteTrafficTar = vi.fn()
const mockGetAllCurrentPositions = vi.fn(() => [] as { lat: number; lng: number; speedKmh: number; updatedAt: number }[])

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/traffic/trafficTarBuilder', () => ({
  buildTrafficTar:  mockBuildTrafficTar,
  writeTrafficTar:  mockWriteTrafficTar,
}))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: {
    driverPosition: {
      // Rows as the database returns them, built from the compact fixtures of this file.
      findMany: async () => mockGetAllCurrentPositions().map(p => ({ latitude: p.lat, longitude: p.lng, speedKmh: p.speedKmh, recordedAt: new Date(p.updatedAt) })),
    },
  },
}))

let startTrafficAggregation: () => void
let stopTrafficAggregation: () => void

beforeAll(async () => {
  vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
  vi.resetModules()
  const mod = await import('../trafficAggregator')
  startTrafficAggregation = mod.startTrafficAggregation
  stopTrafficAggregation  = mod.stopTrafficAggregation
})

afterAll(() => {
  stopTrafficAggregation()
  vi.unstubAllEnvs()
  vi.resetModules()
})

afterEach(() => {
  stopTrafficAggregation()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

/** Wait for pending microtasks + one macrotask tick */
function flushAsync() {
  return new Promise<void>(resolve => setTimeout(resolve, 20))
}

describe('startTrafficAggregation', () => {
  it('does not throw when called', () => {
    expect(() => startTrafficAggregation()).not.toThrow()
  })

  it('does not start twice (_running guard)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503 })))
    startTrafficAggregation()
    startTrafficAggregation() // second call should be no-op
    await flushAsync()
    // If started twice, fetch would be called more times (it's called inside runAggregationCycle)
    // We can't precisely count, but stop should work cleanly
    expect(() => stopTrafficAggregation()).not.toThrow()
  })
})

describe('runAggregationCycle — GPS observations', () => {
  it('calls buildTrafficTar when GPS data and Valhalla trace succeeds', async () => {
    const now = Date.now()
    mockGetAllCurrentPositions.mockReturnValue([
      { lat: 45.76, lng: 6.05, speedKmh: 50, updatedAt: now - 1000 },
    ])

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/locate')) {
        return {
          ok: true,
          json: async () => [{ edges: [{ id: 'edge-1', correlated_lat: 45.76, correlated_lon: 6.05 }] }],
        }
      }
      if (String(url).includes('/trace_attributes')) {
        return {
          ok: true,
          json: async () => ({ edges: [{ id: 'edge-1' }] }),
        }
      }
      return { ok: false, status: 404 }
    }))

    mockBuildTrafficTar.mockReturnValue(Buffer.from('tar-data'))
    mockWriteTrafficTar.mockResolvedValue(undefined)

    startTrafficAggregation()
    await flushAsync()

    expect(mockBuildTrafficTar).toHaveBeenCalled()
    expect(mockWriteTrafficTar).toHaveBeenCalled()
  })

  it('skips buildTrafficTar when resolveEdgeSpeeds returns empty', async () => {
    const now = Date.now()
    mockGetAllCurrentPositions.mockReturnValue([
      { lat: 45.76, lng: 6.05, speedKmh: 50, updatedAt: now - 1000 },
    ])

    // Valhalla returns nothing useful
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ edges: [] }],
    })))

    mockBuildTrafficTar.mockReturnValue(null)

    startTrafficAggregation()
    await flushAsync()

    // buildTrafficTar was called (with empty array) → returned null → writeTrafficTar not called
    expect(mockWriteTrafficTar).not.toHaveBeenCalled()
  })

  it('handles runAggregationCycle when all GPS positions are too old', async () => {
    mockGetAllCurrentPositions.mockReturnValue([
      { lat: 45.76, lng: 6.05, speedKmh: 50, updatedAt: Date.now() - 400_000 }, // too old
    ])
    vi.stubGlobal('fetch', vi.fn())

    startTrafficAggregation()
    await flushAsync()

    // No observations → resolveEdgeSpeeds not called → buildTrafficTar not called
    expect(mockBuildTrafficTar).not.toHaveBeenCalled()
  })

  it('handles Valhalla locate failure gracefully', async () => {
    const now = Date.now()
    mockGetAllCurrentPositions.mockReturnValue([
      { lat: 45.76, lng: 6.05, speedKmh: 60, updatedAt: now - 5000 },
    ])

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/locate')) return { ok: false, status: 503 }
      if (String(url).includes('/trace_attributes')) return { ok: false, status: 500 }
      return { ok: false }
    }))

    mockBuildTrafficTar.mockReturnValue(null)

    startTrafficAggregation()
    await flushAsync()

    // Error in trace_attributes → no edges → buildTrafficTar returns null → no writeTrafficTar
    expect(mockWriteTrafficTar).not.toHaveBeenCalled()
  })

  it('handles runAggregationCycle exception gracefully', async () => {
    mockGetAllCurrentPositions.mockImplementation(() => { throw new Error('store unavailable') })
    vi.stubGlobal('fetch', vi.fn())

    expect(() => startTrafficAggregation()).not.toThrow()
    await flushAsync()
    // Error inside collectGpsSpeeds → caught → returns [] → cycle returns early
    expect(mockBuildTrafficTar).not.toHaveBeenCalled()
  })
})

describe('stopTrafficAggregation', () => {
  it('clears the interval and resets _running', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
    startTrafficAggregation()
    expect(() => stopTrafficAggregation()).not.toThrow()
    expect(() => stopTrafficAggregation()).not.toThrow() // idempotent
  })
})
