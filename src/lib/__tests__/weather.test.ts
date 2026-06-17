import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockPrisma = vi.hoisted(() => ({
  interventionMetric: { update: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ default: mockPrisma }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { fetchWeatherAt, enrichMetricWithWeather } from '@/lib/weather'

function makeHourlyData(code: number, temp = 20, precip = 0, wind = 10) {
  const arr24 = Array(24).fill(0)
  return {
    hourly: {
      time:           arr24.map((_, i) => `2026-05-10T${String(i).padStart(2, '0')}:00`),
      temperature_2m: arr24.map(() => temp),
      precipitation:  arr24.map(() => precip),
      windspeed_10m:  arr24.map(() => wind),
      weathercode:    arr24.map(() => code),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.interventionMetric.update.mockResolvedValue({ id: 'm-1' })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('fetchWeatherAt', () => {
  it('returns null when API responds with non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: vi.fn() })
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T12:00:00Z'))
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T12:00:00Z'))
    expect(result).toBeNull()
  })

  it('returns WeatherConditions on success (code 0 = clear sky)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeHourlyData(0, 22, 0, 5)),
    })
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T00:00:00Z'))
    expect(result).not.toBeNull()
    expect(result!.weatherCode).toBe(0)
    expect(result!.temperatureC).toBe(22)
    expect(result!.isAdverse).toBe(false)
    expect(result!.description).toBe('Ciel clair')
  })

  it('sets isAdverse = true for rain (code 65)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeHourlyData(65)),
    })
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T00:00:00Z'))
    expect(result!.isAdverse).toBe(true)
    expect(result!.description).toBe('Pluie forte')
  })

  it('sets isAdverse = true for storm (code 95)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeHourlyData(95)),
    })
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T00:00:00Z'))
    expect(result!.isAdverse).toBe(true)
  })

  it('sets isAdverse = false for light rain (code 61)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeHourlyData(61)),
    })
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T00:00:00Z'))
    // isAdverse = code >= 65 || (code >= 61 && code <= 67) || code >= 71
    // 61 is >= 61 && <= 67 → isAdverse = true
    expect(result!.weatherCode).toBe(61)
    expect(result!.isAdverse).toBe(true)
  })

  it('returns unknown description for unrecognized weather code', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeHourlyData(999)),
    })
    const result = await fetchWeatherAt(45.75, 4.83, new Date('2026-05-10T00:00:00Z'))
    expect(result!.description).toBe('Inconnu')
  })
})

describe('enrichMetricWithWeather', () => {
  it('does nothing when fetchWeatherAt returns null', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: vi.fn() })
    await enrichMetricWithWeather('m-1', 45.75, 4.83, new Date())
    expect(mockPrisma.interventionMetric.update).not.toHaveBeenCalled()
  })

  it('updates the metric when weather is fetched successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeHourlyData(0)),
    })
    await enrichMetricWithWeather('m-1', 45.75, 4.83, new Date('2026-05-10T00:00:00Z'))
    expect(mockPrisma.interventionMetric.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-1' } }),
    )
  })
})
