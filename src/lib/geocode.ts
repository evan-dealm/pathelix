const BAN_URL = 'https://api-adresse.data.gouv.fr'

const GEOCODE_CACHE_MAX = 5000
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
interface GeoCacheEntry {
  result: { lat: number; lng: number; label?: string } | null
  ts: number
}
const _geoCache = new Map<string, GeoCacheEntry>()

function cacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ')
}

function getCached(address: string): { lat: number; lng: number; label?: string } | null | undefined {
  const entry = _geoCache.get(cacheKey(address))
  if (!entry) return undefined
  if (Date.now() - entry.ts > GEOCODE_CACHE_TTL_MS) {
    _geoCache.delete(cacheKey(address))
    return undefined
  }
  return entry.result
}

function setCache(address: string, result: { lat: number; lng: number; label?: string } | null): void {
  const key = cacheKey(address)

  if (_geoCache.size >= GEOCODE_CACHE_MAX && !_geoCache.has(key)) {
    const firstKey = _geoCache.keys().next().value
    if (firstKey !== undefined) _geoCache.delete(firstKey)
  }
  _geoCache.set(key, { result, ts: Date.now() })
}

export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number; label?: string } | null> {
  if (!address || address.trim().length < 3) return null

  const cached = getCached(address)
  if (cached !== undefined) return cached

  try {
    const url = `${BAN_URL}/search/?q=${encodeURIComponent(address)}&limit=1`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const data = await res.json()
    if (data.features && data.features.length > 0) {
      const feature = data.features[0]
      const [lng, lat] = feature.geometry.coordinates
      const result = { lat, lng, label: feature.properties.label }
      setCache(address, result)
      return result
    }
    setCache(address, null)
    return null
  } catch {
    return null
  }
}

export async function geocodeBatchBAN(
  addresses: string[],
): Promise<Array<{ lat: number; lng: number; label: string } | null>> {
  if (addresses.length === 0) return []

  const csvContent = 'adresse\n' + addresses.map(a => `"${a.replace(/"/g, '""')}"`).join('\n')
  const formData = new FormData()
  formData.append('data', new Blob([csvContent], { type: 'text/csv' }), 'addresses.csv')

  try {
    const res = await fetch(`${BAN_URL}/search/csv/`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return addresses.map(() => null)

    const resultCsv = await res.text()
    const lines = resultCsv.split('\n')
    if (lines.length < 2) return addresses.map(() => null)

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const latIdx = headers.indexOf('latitude')
    const lngIdx = headers.indexOf('longitude')
    const labelIdx = headers.indexOf('result_label')

    if (latIdx === -1 || lngIdx === -1) return addresses.map(() => null)

    const results: Array<{ lat: number; lng: number; label: string } | null> = []
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) { results.push(null); continue }
      const cols = lines[i].split(',')
      const lat = parseFloat(cols[latIdx])
      const lng = parseFloat(cols[lngIdx])
      if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
        results.push({ lat, lng, label: cols[labelIdx] ?? '' })
      } else {
        results.push(null)
      }
    }
    return results
  } catch {
    return addresses.map(() => null)
  }
}

type GeocodableItem = Record<string, unknown> & (
  | { address?: string; latitude?: number; longitude?: number }
  | { adresse?: string; lat?: number; lng?: number }
  | { depotName?: string; depotLat?: number; depotLng?: number }
)

export async function geocodeBatch(
  items: GeocodableItem[],
  onProgress?: (_done: number, _total: number, _lastAddress: string) => void,
): Promise<number> {
  function getAddr(item: Record<string, unknown>): string | null {
    return (item.address || item.adresse || item.depotName) as string | null
  }

  function needsGeo(item: Record<string, unknown>): boolean {
    const addr = getAddr(item)
    if (!addr) return false
    if (item.latitude && item.longitude && item.latitude !== 0 && item.longitude !== 0) return false
    if (item.lat && item.lng && item.lat !== 0 && item.lng !== 0) return false
    if (item.depotLat && item.depotLng && item.depotLat !== 0 && item.depotLng !== 0) return false
    return true
  }

  function setCoords(item: Record<string, unknown>, lat: number, lng: number): void {
    if ('latitude' in item || 'longitude' in item) { item.latitude = lat; item.longitude = lng }
    if ('lat' in item || 'lng' in item) { item.lat = lat; item.lng = lng }
    if ('depotLat' in item || 'depotLng' in item) { item.depotLat = lat; item.depotLng = lng }
    if (!('latitude' in item) && !('lat' in item) && !('depotLat' in item)) {
      item.latitude = lat; item.longitude = lng
    }
  }

  const toGeocode = items.filter(needsGeo)
  if (toGeocode.length === 0) return 0

  const addresses = toGeocode.map(item => getAddr(item)!)
  onProgress?.(0, toGeocode.length, 'Géocodage en lot BAN...')

  try {
    const results = await geocodeBatchBAN(addresses)
    let geocoded = 0
    for (let i = 0; i < toGeocode.length; i++) {
      const coords = results[i]

      setCache(addresses[i], coords)
      if (coords) {
        setCoords(toGeocode[i], coords.lat, coords.lng)
        geocoded++
      }
      onProgress?.(i + 1, toGeocode.length, addresses[i])
    }
    return geocoded
  } catch {

    let geocoded = 0
    for (let i = 0; i < toGeocode.length; i++) {
      const item = toGeocode[i]
      const addr = getAddr(item)
      const coords = await geocodeAddress(addr!)
      if (coords) {
        setCoords(item, coords.lat, coords.lng)
        geocoded++
      }
      onProgress?.(i + 1, toGeocode.length, addr!)
    }
    return geocoded
  }
}
