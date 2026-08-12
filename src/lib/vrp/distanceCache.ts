const _cache = new Map<string, number>()
const _CACHE_MAX = 500_000

const RAD    = Math.PI / 180
const EARTH_R = 6371

const _cosCache = new Float64Array(18001)
for (let i = 0; i <= 18000; i++) {
  _cosCache[i] = Math.cos(((i - 9000) / 100) * RAD)
}
function fastCosLat(lat: number): number {
  const idx = Math.round(lat * 100) + 9000
  if (idx >= 0 && idx <= 18000) return _cosCache[idx]
  return Math.cos(lat * RAD)
}

// A composite string key (rather than a hashed int32) is used deliberately: with up to
// _CACHE_MAX (500k) entries, the birthday paradox makes a 32-bit hash collision near-certain
// well before the cache fills (>60% probability by ~100k unique pairs) — a collision meant two
// different coordinate pairs would silently share one cached distance, with no error or log.
// The string key can't collide by construction (it *is* the coordinates), at the cost of a
// slightly more expensive Map key than a raw int, which is negligible next to the trig this
// cache exists to avoid recomputing.
function _key(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const a1 = Math.round(lat1 * 1e4)
  const b1 = Math.round(lng1 * 1e4)
  const a2 = Math.round(lat2 * 1e4)
  const b2 = Math.round(lng2 * 1e4)

  let x1 = a1, y1 = b1, x2 = a2, y2 = b2
  if (a1 > a2 || (a1 === a2 && b1 > b2)) { x1 = a2; y1 = b2; x2 = a1; y2 = b1 }

  return `${x1},${y1},${x2},${y2}`
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const key = _key(lat1, lng1, lat2, lng2)

  const cached = _cache.get(key)
  if (cached !== undefined) return cached

  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const sinHalfDLat = Math.sin(dLat / 2)
  const sinHalfDLng = Math.sin(dLng / 2)
  const a = sinHalfDLat * sinHalfDLat +
    fastCosLat(lat1) * fastCosLat(lat2) * sinHalfDLng * sinHalfDLng
  const dist = 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))

  if (_cache.size >= _CACHE_MAX) {
    const evictCount = Math.ceil(_CACHE_MAX * 0.1)
    const iter = _cache.keys()
    for (let i = 0; i < evictCount; i++) {
      const k = iter.next().value
      if (k !== undefined) _cache.delete(k)
      else break
    }
  }
  _cache.set(key, dist)
  return dist
}

export function cachedDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const hav = haversineKm(lat1, lng1, lat2, lng2)
  const factor = hav < 5 ? 1.50 : hav < 20 ? 1.35 : 1.20
  return hav * factor
}

export function clearDistanceCache(): void {
  _cache.clear()
}

export function distanceCacheStats(): { size: number; maxSize: number } {
  return { size: _cache.size, maxSize: _CACHE_MAX }
}

export interface DistanceMatrix {

  get(_i: number, _j: number): number

  size: number

  indexOf(_id: string): number
}

interface GeoPoint {
  id: string
  lat: number
  lng: number
}

export function buildDistanceMatrix(points: GeoPoint[]): DistanceMatrix {
  const n = points.length

  const data = new Float64Array((n * (n - 1)) / 2)
  const idIndex = new Map<string, number>()

  for (let i = 0; i < n; i++) {
    idIndex.set(points[i].id, i)
  }

  let idx = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      data[idx++] = cachedDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng)
    }
  }

  function triIndex(i: number, j: number): number {
    const a = Math.min(i, j)
    const b = Math.max(i, j)
    return (a * (2 * n - a - 1)) / 2 + (b - a - 1)
  }

  return {
    get(i: number, j: number): number {
      if (i === j) return 0
      return data[triIndex(i, j)]
    },
    size: n,
    indexOf(id: string): number {
      return idIndex.get(id) ?? -1
    },
  }
}

export function collectMatrixPoints(
  missions: { id: string; latitude: number; longitude: number }[],
  drivers:  { id: string; depotLat: number; depotLng: number }[],
  exutoires: { id: string; lat: number; lng: number }[],
): GeoPoint[] {
  const points: GeoPoint[] = []
  const seen = new Set<string>()

  for (const d of drivers) {
    const key = `depot_${d.id}`
    if (!seen.has(key)) {
      points.push({ id: key, lat: d.depotLat, lng: d.depotLng })
      seen.add(key)
    }
  }

  for (const m of missions) {
    if (!seen.has(m.id)) {
      points.push({ id: m.id, lat: m.latitude, lng: m.longitude })
      seen.add(m.id)
    }
  }

  for (const e of exutoires) {
    const key = `exu_${e.id}`
    if (!seen.has(key)) {
      points.push({ id: key, lat: e.lat, lng: e.lng })
      seen.add(key)
    }
  }

  return points
}
