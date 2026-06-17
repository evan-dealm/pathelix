import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { geocodeAddress, geocodeBatchBAN, geocodeBatch } from '../geocode'

function banResponse(lat: number, lng: number, label: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      features: [{
        geometry: { coordinates: [lng, lat] },
        properties: { label },
      }],
    }),
  }
}

function banEmptyResponse() {
  return { ok: true, json: () => Promise.resolve({ features: [] }) }
}

function banCsvResponse(csv: string) {
  return { ok: true, text: () => Promise.resolve(csv) }
}

describe('geocodeAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for empty or short address', async () => {
    expect(await geocodeAddress('')).toBeNull()
    expect(await geocodeAddress('ab')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('geocodes a valid address via BAN API', async () => {
    mockFetch.mockResolvedValue(banResponse(45.867, 5.944, '162 Rue des Acacias 74150 Rumilly'))

    const result = await geocodeAddress('162 rue des Acacias Rumilly test-unique-1')

    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(45.867)
    expect(result!.lng).toBeCloseTo(5.944)
    expect(result!.label).toContain('Acacias')
  })

  it('returns null when BAN returns no features', async () => {
    mockFetch.mockResolvedValue(banEmptyResponse())

    const result = await geocodeAddress('adresse-introuvable-xyz-99999')
    expect(result).toBeNull()
  })

  it('returns null when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))

    const result = await geocodeAddress('1 rue du réseau, timeout-ville-9999')
    expect(result).toBeNull()
  })

  it('returns null when API responds with error status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })

    const result = await geocodeAddress('1 rue erreur serveur-ban-fail-8888')
    expect(result).toBeNull()
  })

  it('uses cache for repeated calls', async () => {
    mockFetch.mockResolvedValue(banResponse(48.856, 2.352, 'Paris'))

    const addr = 'cache-test-unique-address-7777'
    const r1 = await geocodeAddress(addr)
    const r2 = await geocodeAddress(addr)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(r1).toEqual(r2)
  })
})

describe('geocodeBatchBAN', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array for empty input', async () => {
    const result = await geocodeBatchBAN([])
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('parses CSV response from BAN', async () => {
    const csv = 'adresse,latitude,longitude,result_label\n"1 rue A",45.5,4.5,1 Rue A 69000 Lyon\n"2 rue B",48.8,2.3,2 Rue B 75000 Paris'
    mockFetch.mockResolvedValue(banCsvResponse(csv))

    const results = await geocodeBatchBAN(['1 rue A', '2 rue B'])

    expect(results).toHaveLength(2)
    expect(results[0]!.lat).toBeCloseTo(45.5)
    expect(results[1]!.lat).toBeCloseTo(48.8)
  })

  it('returns null for failed rows', async () => {
    const csv = 'adresse,latitude,longitude,result_label\n"bad addr",,,\n"good addr",45.0,4.0,Good'
    mockFetch.mockResolvedValue(banCsvResponse(csv))

    const results = await geocodeBatchBAN(['bad addr', 'good addr'])

    expect(results[0]).toBeNull()
    expect(results[1]!.lat).toBeCloseTo(45.0)
  })

  it('returns all nulls when API fails', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))

    const results = await geocodeBatchBAN(['addr1', 'addr2'])

    expect(results).toEqual([null, null])
  })

  it('returns all nulls when API returns error status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 })

    const results = await geocodeBatchBAN(['addr1'])
    expect(results).toEqual([null])
  })
})

describe('geocodeBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 when no items need geocoding', async () => {
    const items = [
      { address: '1 rue A', latitude: 45.5, longitude: 4.5 },
    ]
    const count = await geocodeBatch(items)
    expect(count).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('geocodes items with address but no coordinates', async () => {
    const csv = 'adresse,latitude,longitude,result_label\n"5 rue test",45.1,4.2,5 Rue Test'
    mockFetch.mockResolvedValue(banCsvResponse(csv))

    const items = [{ address: '5 rue test', latitude: 0, longitude: 0 }]
    const count = await geocodeBatch(items)

    expect(count).toBe(1)
    expect(items[0].latitude).toBeCloseTo(45.1)
    expect(items[0].longitude).toBeCloseTo(4.2)
  })

  it('calls progress callback', async () => {
    const csv = 'adresse,latitude,longitude,result_label\n"addr",45.0,4.0,Addr'
    mockFetch.mockResolvedValue(banCsvResponse(csv))

    const progress = vi.fn()
    const items = [{ address: 'addr', latitude: 0, longitude: 0 }]
    await geocodeBatch(items, progress)

    expect(progress).toHaveBeenCalled()
  })

  it('skips items that already have coordinates', async () => {
    const items = [
      { address: 'has coords', latitude: 45.5, longitude: 4.5 },
      { address: 'no coords', latitude: 0, longitude: 0 },
    ]
    const csv = 'adresse,latitude,longitude,result_label\n"no coords",48.0,2.0,No Coords'
    mockFetch.mockResolvedValue(banCsvResponse(csv))

    await geocodeBatch(items)

    expect(items[0].latitude).toBe(45.5)

    expect(items[1].latitude).toBeCloseTo(48.0)
  })

  it('supports exutoire format (lat/lng)', async () => {
    const csv = 'adresse,latitude,longitude,result_label\n"addr",45.0,4.0,Addr'
    mockFetch.mockResolvedValue(banCsvResponse(csv))

    const items = [{ address: 'addr', lat: 0, lng: 0 } as Record<string, unknown>]
    await geocodeBatch(items as never)

    expect(items[0].lat).toBeCloseTo(45.0)
    expect(items[0].lng).toBeCloseTo(4.0)
  })
})
