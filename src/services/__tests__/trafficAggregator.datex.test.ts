import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type * as TrafficAggregatorModule from '../trafficAggregator'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/traffic/trafficTarBuilder', () => ({
  buildTrafficTar: vi.fn(() => null),
  writeTrafficTar: vi.fn(),
}))
vi.mock('@/lib/obdStore', () => ({
  getAllCurrentPositions: vi.fn(() => []),
}))

let collectDatexEvents: typeof TrafficAggregatorModule.collectDatexEvents

beforeAll(async () => {
  vi.stubEnv('DATEX_II_URL', 'http://fake-datex.test/feed')
  vi.resetModules()
  const mod = await import('../trafficAggregator')
  collectDatexEvents = mod.collectDatexEvents
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

function mockFetch(xml: string, ok = true): void {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, text: () => Promise.resolve(xml) }),
  ))
}

function situation(inner: string, lat = '45.9', lng = '6.1'): string {
  return `<situationRecord><latitude>${lat}</latitude><longitude>${lng}</longitude>${inner}</situationRecord>`
}

describe('collectDatexEvents — parseDatexXml branches', () => {
  it('returns empty when fetch fails (status 500)', async () => {
    mockFetch('', false)
    expect(await collectDatexEvents()).toEqual([])
  })

  it('returns empty for malformed XML (no situationRecord)', async () => {
    mockFetch('<root><notASituation/></root>')
    expect(await collectDatexEvents()).toEqual([])
  })

  it('returns empty when lat/lng tags are missing', async () => {
    mockFetch('<situationRecord><roadClosed/></situationRecord>')
    expect(await collectDatexEvents()).toEqual([])
  })

  it('returns empty when coordinates are out of France bounds', async () => {
    mockFetch(situation('<roadClosed/>', '10.0', '50.0'))
    expect(await collectDatexEvents()).toEqual([])
  })

  it('defaults to 30 km/h for generic roadworks-free record', async () => {
    mockFetch(situation('<someOtherTag/>'))
    const result = await collectDatexEvents()
    expect(result).toHaveLength(1)
    expect(result[0].speedKmh).toBe(30)
    expect(result[0].source).toBe('datex')
  })

  it('sets speedKmh=0 for roadClosed', async () => {
    mockFetch(situation('<roadClosed/>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(0)
  })

  it('sets speedKmh=0 for fermeture keyword', async () => {
    mockFetch(situation('<fermeture>oui</fermeture>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(0)
  })

  it('sets speedKmh=10 for accident', async () => {
    mockFetch(situation('<accident/>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(10)
  })

  it('sets speedKmh=30 for roadworks', async () => {
    mockFetch(situation('<roadworks/>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(30)
  })

  it('sets speedKmh=30 for travaux keyword', async () => {
    mockFetch(situation('<travaux/>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(30)
  })

  it('sets speedKmh=20 for abnormalTraffic', async () => {
    mockFetch(situation('<abnormalTraffic/>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(20)
  })

  it('sets speedKmh=20 for ralentissement keyword', async () => {
    mockFetch(situation('<ralentissement/>'))
    const result = await collectDatexEvents()
    expect(result[0].speedKmh).toBe(20)
  })

  it('returns multiple observations from multiple situationRecords', async () => {
    const xml = situation('<roadClosed/>') + situation('<accident/>', '46.0', '6.2')
    mockFetch(xml)
    const result = await collectDatexEvents()
    expect(result).toHaveLength(2)
  })

  it('returns empty when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
    expect(await collectDatexEvents()).toEqual([])
  })
})
