import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// File-scoped mock handles — captured by vi.mock() factories
const mockFetchProtected     = vi.fn()
const mockGetCircuitBreaker  = vi.fn()
const mockMetricsIncrement   = vi.fn()

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/httpClient', () => ({
  fetchProtected: mockFetchProtected,
}))

vi.mock('@/lib/circuitBreaker', () => ({
  getCircuitBreaker: mockGetCircuitBreaker,
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: mockMetricsIncrement, histogram: vi.fn(), gauge: vi.fn() },
  METRIC:  { CB_FAILURE: 'cb.failure' },
}))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  // Default circuit breaker is CLOSED
  mockGetCircuitBreaker.mockReturnValue({ getState: vi.fn(() => 'CLOSED') })
  // Set env vars so module-level constants are populated on fresh import
  process.env.NESSY_BASE_URL = 'http://test.nessy.fr'
  process.env.NESSY_API_KEY  = 'test-api-key-xyz'
})

afterEach(() => {
  delete process.env.NESSY_BASE_URL
  delete process.env.NESSY_API_KEY
})

// ─── importMissionsFromNessy ────────────────────────────────────────────────

describe('importMissionsFromNessy — not configured', () => {
  it('returns [] when NESSY_BASE_URL is not set', async () => {
    delete process.env.NESSY_BASE_URL
    const { importMissionsFromNessy } = await import('@/services/nessy')
    expect(await importMissionsFromNessy('2026-05-10')).toEqual([])
    expect(mockFetchProtected).not.toHaveBeenCalled()
  })

  it('returns [] when NESSY_API_KEY is not set', async () => {
    delete process.env.NESSY_API_KEY
    const { importMissionsFromNessy } = await import('@/services/nessy')
    expect(await importMissionsFromNessy('2026-05-10')).toEqual([])
    expect(mockFetchProtected).not.toHaveBeenCalled()
  })
})

describe('importMissionsFromNessy — HTTP success', () => {
  it('returns mapped missions on HTTP 200 with valid payload', async () => {
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({
        missions: [{
          id:                   'n-001',
          type:                 'POSER',
          date:                 '2026-05-10',
          address:              '10 rue de la Paix, Lyon',
          latitude:             45.75,
          longitude:            4.83,
          estimatedDurationMin: 45,
          clientName:           'Dupont SA',
        }],
      }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    const result = await importMissionsFromNessy('2026-05-10')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('POSER')
    expect(result[0].address).toBe('10 rue de la Paix, Lyon')
    expect(result[0].id).toBe('n-001')
  })

  it('calls fetchProtected with correct URL, headers, and circuit breaker name', async () => {
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({ missions: [] }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    await importMissionsFromNessy('2026-03-15')

    expect(mockFetchProtected).toHaveBeenCalledWith(
      'http://test.nessy.fr/api/missions?date=2026-03-15',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Api-Key': 'test-api-key-xyz',
          'Accept':    'application/json',
        }),
      }),
      expect.objectContaining({ maxRetries: 2, timeoutMs: 6_000 }),
      'nessy',
    )
  })

  it('increments success metric on successful import', async () => {
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({ missions: [] }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    await importMissionsFromNessy('2026-05-10')
    expect(mockMetricsIncrement).toHaveBeenCalledWith(
      expect.stringContaining('success'),
      expect.objectContaining({ service: 'nessy' }),
    )
  })

  it('generates fallback id when payload has no id field', async () => {
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({
        missions: [{
          type:                 'RETIRER',
          date:                 '2026-05-10',
          address:              'Test addr',
          latitude:             45.0,
          longitude:            4.0,
          estimatedDurationMin: 20,
        }],
      }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    const result = await importMissionsFromNessy('2026-05-10')
    expect(result[0].id).toMatch(/^nessy-\d+/)
  })

  it('returns empty array when missions key is absent in response', async () => {
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({ data: 'unexpected_shape' }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    expect(await importMissionsFromNessy('2026-05-10')).toEqual([])
  })

  it('handles multiple missions in one response', async () => {
    const missionBase = {
      type: 'POSER', date: '2026-05-10', address: 'A', latitude: 45.0, longitude: 4.0, estimatedDurationMin: 20,
    }
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({
        missions: [
          { ...missionBase, id: 'n-1', clientName: 'Client A' },
          { ...missionBase, id: 'n-2', type: 'RETIRER', clientName: 'Client B' },
          { ...missionBase, id: 'n-3', type: 'ECHANGER', clientName: 'Client C' },
        ],
      }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    const result = await importMissionsFromNessy('2026-05-10')
    expect(result).toHaveLength(3)
    expect(result[1].type).toBe('RETIRER')
  })
})

describe('importMissionsFromNessy — HTTP errors', () => {
  it('returns [] when API responds with non-ok status', async () => {
    mockFetchProtected.mockResolvedValue({ ok: false, status: 503 })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    expect(await importMissionsFromNessy('2026-05-10')).toEqual([])
  })

  it('returns [] and does not throw when fetchProtected rejects', async () => {
    mockFetchProtected.mockRejectedValue(new Error('ECONNREFUSED'))
    const { importMissionsFromNessy } = await import('@/services/nessy')
    await expect(importMissionsFromNessy('2026-05-10')).resolves.toEqual([])
  })

  it('increments failure metric on fetchProtected rejection', async () => {
    mockFetchProtected.mockRejectedValue(new Error('timeout'))
    const { importMissionsFromNessy } = await import('@/services/nessy')
    await importMissionsFromNessy('2026-05-10')
    expect(mockMetricsIncrement).toHaveBeenCalledWith('cb.failure', { name: 'nessy' })
  })

  it('returns [] when a mission payload has invalid GPS coordinates', async () => {
    // nessyPayloadToMission throws for bad coords — caught by outer catch → return []
    mockFetchProtected.mockResolvedValue({
      ok:   true,
      json: async () => ({
        missions: [{
          type: 'POSER', date: '2026-05-10', address: 'Bad coords',
          latitude: 999, longitude: 4.83, estimatedDurationMin: 30,
        }],
      }),
    })
    const { importMissionsFromNessy } = await import('@/services/nessy')
    expect(await importMissionsFromNessy('2026-05-10')).toEqual([])
  })
})

describe('importMissionsFromNessy — circuit breaker open', () => {
  it('returns [] when circuit breaker is OPEN and request fails', async () => {
    mockGetCircuitBreaker.mockReturnValue({ getState: vi.fn(() => 'OPEN') })
    mockFetchProtected.mockRejectedValue(new Error('Circuit breaker open'))
    const { importMissionsFromNessy } = await import('@/services/nessy')
    const result = await importMissionsFromNessy('2026-05-10')
    expect(result).toEqual([])
  })
})

// ─── exportStatusesToNessy ──────────────────────────────────────────────────

describe('exportStatusesToNessy — not configured', () => {
  it('returns without fetching when NESSY_BASE_URL not set', async () => {
    delete process.env.NESSY_BASE_URL
    const { exportStatusesToNessy } = await import('@/services/nessy')
    await exportStatusesToNessy({ 'mission-1': 'COMPLETED' })
    expect(mockFetchProtected).not.toHaveBeenCalled()
  })
})

describe('exportStatusesToNessy — HTTP success', () => {
  it('POSTs statuses with correct method and body', async () => {
    mockFetchProtected.mockResolvedValue({ ok: true })
    const { exportStatusesToNessy } = await import('@/services/nessy')
    await exportStatusesToNessy({ 'mission-1': 'COMPLETED', 'mission-2': 'FAILED' })
    expect(mockFetchProtected).toHaveBeenCalledWith(
      'http://test.nessy.fr/api/statuses',
      expect.objectContaining({
        method:  'POST',
        headers: expect.objectContaining({
          'X-Api-Key':     'test-api-key-xyz',
          'Content-Type':  'application/json',
        }),
        body: JSON.stringify({ statuses: { 'mission-1': 'COMPLETED', 'mission-2': 'FAILED' } }),
      }),
      expect.objectContaining({ maxRetries: 1, timeoutMs: 4_000 }),
      'nessy',
    )
  })
})

describe('exportStatusesToNessy — resilience', () => {
  it('does not throw when API returns non-ok status', async () => {
    mockFetchProtected.mockResolvedValue({ ok: false, status: 502 })
    const { exportStatusesToNessy } = await import('@/services/nessy')
    await expect(exportStatusesToNessy({ 'mission-1': 'DONE' })).resolves.not.toThrow()
  })

  it('does not throw when fetchProtected rejects', async () => {
    mockFetchProtected.mockRejectedValue(new Error('timeout'))
    const { exportStatusesToNessy } = await import('@/services/nessy')
    await expect(exportStatusesToNessy({ 'mission-1': 'DONE' })).resolves.not.toThrow()
  })

  it('handles empty statuses object without crash', async () => {
    mockFetchProtected.mockResolvedValue({ ok: true })
    const { exportStatusesToNessy } = await import('@/services/nessy')
    await expect(exportStatusesToNessy({})).resolves.not.toThrow()
  })
})
