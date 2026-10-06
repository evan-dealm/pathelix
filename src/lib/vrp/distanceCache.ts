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

/**
 * Straight-line distance in km. Computed directly: the Map lookup with a template-string key
 * that used to front this cost more than the trigonometry itself (it was ~35 % of a VRP run).
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const sinHalfDLat = Math.sin(dLat / 2)
  const sinHalfDLng = Math.sin(dLng / 2)
  const a = sinHalfDLat * sinHalfDLat +
    fastCosLat(lat1) * fastCosLat(lat2) * sinHalfDLng * sinHalfDLng
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function cachedDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const hav = haversineKm(lat1, lng1, lat2, lng2)
  const factor = hav < 5 ? 1.50 : hav < 20 ? 1.35 : 1.20
  return hav * factor
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
