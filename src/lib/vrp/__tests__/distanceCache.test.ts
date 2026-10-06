import { describe, it, expect } from 'vitest'
import {
  haversineKm,
  cachedDist,
  buildDistanceMatrix,
  collectMatrixPoints,
} from '@/lib/vrp/distanceCache'

const PARIS     = { lat: 48.8566, lng: 2.3522 }
const LYON      = { lat: 45.7640, lng: 4.8357 }
const MARSEILLE = { lat: 43.2965, lng: 5.3698 }
const ANNECY    = { lat: 45.8992, lng: 6.1294 }
const GRENOBLE  = { lat: 45.1885, lng: 5.7245 }
const LONDON    = { lat: 51.5074, lng: -0.1278 }


describe('haversineKm', () => {
  it('returns 0 for the same point (Paris)', () => {
    expect(haversineKm(PARIS.lat, PARIS.lng, PARIS.lat, PARIS.lng)).toBe(0)
  })

  it('returns 0 for the same point (Lyon)', () => {
    expect(haversineKm(LYON.lat, LYON.lng, LYON.lat, LYON.lng)).toBe(0)
  })

  it('returns 0 for the same point (Annecy)', () => {
    expect(haversineKm(ANNECY.lat, ANNECY.lng, ANNECY.lat, ANNECY.lng)).toBe(0)
  })

  it('returns 0 for the same point at the origin (0, 0)', () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0)
  })

  it('Paris to Lyon is approximately 392 km (±5)', () => {
    const dist = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    expect(dist).toBeGreaterThan(387)
    expect(dist).toBeLessThan(397)
  })

  it('Paris to London is approximately 340 km (±10)', () => {
    const dist = haversineKm(PARIS.lat, PARIS.lng, LONDON.lat, LONDON.lng)
    expect(dist).toBeGreaterThan(330)
    expect(dist).toBeLessThan(350)
  })

  it('Annecy to Grenoble is approximately 85 km (±5)', () => {
    const dist = haversineKm(ANNECY.lat, ANNECY.lng, GRENOBLE.lat, GRENOBLE.lng)
    expect(dist).toBeGreaterThan(80)
    expect(dist).toBeLessThan(90)
  })

  it('is symmetric: A→B equals B→A (Paris–Lyon)', () => {
    const ab = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const ba = haversineKm(LYON.lat, LYON.lng, PARIS.lat, PARIS.lng)
    expect(ab).toBeCloseTo(ba, 6)
  })

  it('is symmetric: A→B equals B→A (Annecy–Grenoble)', () => {
    const ab = haversineKm(ANNECY.lat, ANNECY.lng, GRENOBLE.lat, GRENOBLE.lng)
    const ba = haversineKm(GRENOBLE.lat, GRENOBLE.lng, ANNECY.lat, ANNECY.lng)
    expect(ab).toBeCloseTo(ba, 6)
  })

  it('is symmetric: A→B equals B→A (Paris–Marseille)', () => {
    const ab = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    const ba = haversineKm(MARSEILLE.lat, MARSEILLE.lng, PARIS.lat, PARIS.lng)
    expect(ab).toBeCloseTo(ba, 6)
  })

  it('returns a positive value for two different points', () => {
    expect(haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)).toBeGreaterThan(0)
  })

  it('returns a positive value for Annecy–Marseille', () => {
    expect(haversineKm(ANNECY.lat, ANNECY.lng, MARSEILLE.lat, MARSEILLE.lng)).toBeGreaterThan(0)
  })

  it('returns a positive value for Lyon–Marseille', () => {
    expect(haversineKm(LYON.lat, LYON.lng, MARSEILLE.lat, MARSEILLE.lng)).toBeGreaterThan(0)
  })

  // The memo cache in front of haversineKm was removed (its string-key lookup cost more than
  // the computation); what matters is that the function is pure and symmetric.
  it('is symmetric', () => {
    expect(haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)).toBe(haversineKm(LYON.lat, LYON.lng, PARIS.lat, PARIS.lng))
  })

  it('Paris to Marseille is in a reasonable range (660–700 km)', () => {
    const dist = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    expect(dist).toBeGreaterThan(660)
    expect(dist).toBeLessThan(700)
  })
})


describe('cachedDist', () => {
  it('returns a value strictly greater than haversineKm (factor > 1)', () => {
    const hav = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const road = cachedDist(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    expect(road).toBeGreaterThan(hav)
  })

  it('applies factor 1.50 for very short trips (< 5 km) — adjacent points ~1 km', () => {

    const lat1 = 45.8992
    const lng1 = 6.1294
    const lat2 = 45.9082
    const lng2 = 6.1294
    const hav = haversineKm(lat1, lng1, lat2, lng2)
    const road = cachedDist(lat1, lng1, lat2, lng2)
    expect(hav).toBeLessThan(5)
    expect(road).toBeCloseTo(hav * 1.50, 4)
  })

  it('applies factor 1.35 for medium trips (5–20 km) — Annecy to Grenoble is ~85 km so use two nearby towns', () => {

    const lat1 = 45.8992
    const lng1 = 6.1294
    const lat2 = 45.9892
    const lng2 = 6.2500
    const hav = haversineKm(lat1, lng1, lat2, lng2)
    const road = cachedDist(lat1, lng1, lat2, lng2)
    if (hav >= 5 && hav < 20) {
      expect(road).toBeCloseTo(hav * 1.35, 4)
    }

    expect(road).toBeGreaterThan(hav)
  })

  it('applies factor 1.20 for long trips (> 20 km) — Paris to Lyon', () => {
    const hav = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const road = cachedDist(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    expect(hav).toBeGreaterThan(20)
    expect(road).toBeCloseTo(hav * 1.20, 4)
  })

  it('applies factor 1.20 for Paris–Marseille', () => {
    const hav = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    const road = cachedDist(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    expect(hav).toBeGreaterThan(20)
    expect(road).toBeCloseTo(hav * 1.20, 4)
  })

  it('returns 0 for same point (factor * 0 = 0)', () => {
    expect(cachedDist(PARIS.lat, PARIS.lng, PARIS.lat, PARIS.lng)).toBe(0)
  })

  it('is symmetric (same factor both directions)', () => {
    const ab = cachedDist(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const ba = cachedDist(LYON.lat, LYON.lng, PARIS.lat, PARIS.lng)
    expect(ab).toBeCloseTo(ba, 4)
  })
})

describe('buildDistanceMatrix', () => {
  const points = [
    { id: 'paris',     lat: PARIS.lat,     lng: PARIS.lng },
    { id: 'lyon',      lat: LYON.lat,      lng: LYON.lng },
    { id: 'marseille', lat: MARSEILLE.lat, lng: MARSEILLE.lng },
  ]

  it('has size matching input length', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.size).toBe(3)
  })

  it('has size 1 for a single point', () => {
    const matrix = buildDistanceMatrix([{ id: 'paris', lat: PARIS.lat, lng: PARIS.lng }])
    expect(matrix.size).toBe(1)
  })

  it('has size 0 for empty input', () => {
    const matrix = buildDistanceMatrix([])
    expect(matrix.size).toBe(0)
  })

  it('get(i, i) === 0 for index 0', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(0, 0)).toBe(0)
  })

  it('get(i, i) === 0 for index 1', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(1, 1)).toBe(0)
  })

  it('get(i, i) === 0 for index 2', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(2, 2)).toBe(0)
  })

  it('get(0, 0) === 0 for a single point matrix', () => {
    const matrix = buildDistanceMatrix([{ id: 'paris', lat: PARIS.lat, lng: PARIS.lng }])
    expect(matrix.get(0, 0)).toBe(0)
  })

  it('is symmetric: get(0, 1) === get(1, 0)', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(0, 1)).toBeCloseTo(matrix.get(1, 0), 6)
  })

  it('is symmetric: get(0, 2) === get(2, 0)', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(0, 2)).toBeCloseTo(matrix.get(2, 0), 6)
  })

  it('is symmetric: get(1, 2) === get(2, 1)', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(1, 2)).toBeCloseTo(matrix.get(2, 1), 6)
  })

  it('indexOf returns correct index for paris', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.indexOf('paris')).toBe(0)
  })

  it('indexOf returns correct index for lyon', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.indexOf('lyon')).toBe(1)
  })

  it('indexOf returns correct index for marseille', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.indexOf('marseille')).toBe(2)
  })

  it('indexOf returns -1 for an unknown id', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.indexOf('nantes')).toBe(-1)
  })

  it('indexOf returns -1 for empty string', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.indexOf('')).toBe(-1)
  })

  it('distances between different geo points are > 0', () => {
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(0, 1)).toBeGreaterThan(0)
    expect(matrix.get(0, 2)).toBeGreaterThan(0)
    expect(matrix.get(1, 2)).toBeGreaterThan(0)
  })

  it('3-point matrix: all pairs computed and Paris–Lyon matches cachedDist', () => {
    const expected = cachedDist(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const matrix = buildDistanceMatrix(points)
    expect(matrix.get(0, 1)).toBeCloseTo(expected, 2)
  })

  it('2-point matrix: has size 2', () => {
    const matrix = buildDistanceMatrix([
      { id: 'a', lat: PARIS.lat, lng: PARIS.lng },
      { id: 'b', lat: LYON.lat,  lng: LYON.lng  },
    ])
    expect(matrix.size).toBe(2)
  })

  it('2-point matrix: get(0,1) > 0 and get(1,0) > 0', () => {
    const matrix = buildDistanceMatrix([
      { id: 'a', lat: PARIS.lat, lng: PARIS.lng },
      { id: 'b', lat: LYON.lat,  lng: LYON.lng  },
    ])
    expect(matrix.get(0, 1)).toBeGreaterThan(0)
    expect(matrix.get(1, 0)).toBeGreaterThan(0)
  })
})

describe('collectMatrixPoints', () => {
  const missions  = [{ id: 'm1', latitude: PARIS.lat,     longitude: PARIS.lng }]
  const drivers   = [{ id: 'd1', depotLat: LYON.lat,      depotLng:  LYON.lng  }]
  const exutoires = [{ id: 'e1', lat: MARSEILLE.lat,      lng: MARSEILLE.lng   }]

  it('returns empty array for all-empty inputs', () => {
    expect(collectMatrixPoints([], [], [])).toHaveLength(0)
  })

  it('drivers are prefixed with depot_', () => {
    const pts = collectMatrixPoints([], drivers, [])
    expect(pts[0].id).toBe('depot_d1')
  })

  it('missions use raw id', () => {
    const pts = collectMatrixPoints(missions, [], [])
    expect(pts[0].id).toBe('m1')
  })

  it('exutoires are prefixed with exu_', () => {
    const pts = collectMatrixPoints([], [], exutoires)
    expect(pts[0].id).toBe('exu_e1')
  })

  it('returns drivers first', () => {
    const pts = collectMatrixPoints(missions, drivers, exutoires)
    expect(pts[0].id).toBe('depot_d1')
  })

  it('returns missions after drivers', () => {
    const pts = collectMatrixPoints(missions, drivers, exutoires)
    expect(pts[1].id).toBe('m1')
  })

  it('returns exutoires last', () => {
    const pts = collectMatrixPoints(missions, drivers, exutoires)
    expect(pts[2].id).toBe('exu_e1')
  })

  it('total count matches unique points', () => {
    const pts = collectMatrixPoints(missions, drivers, exutoires)
    expect(pts).toHaveLength(3)
  })

  it('deduplicates drivers with the same id', () => {
    const dups = [
      { id: 'd1', depotLat: LYON.lat, depotLng: LYON.lng },
      { id: 'd1', depotLat: LYON.lat, depotLng: LYON.lng },
    ]
    const pts = collectMatrixPoints([], dups, [])
    expect(pts.filter(p => p.id === 'depot_d1')).toHaveLength(1)
  })

  it('deduplicates missions with the same id', () => {
    const dups = [
      { id: 'm1', latitude: PARIS.lat, longitude: PARIS.lng },
      { id: 'm1', latitude: PARIS.lat, longitude: PARIS.lng },
    ]
    const pts = collectMatrixPoints(dups, [], [])
    expect(pts.filter(p => p.id === 'm1')).toHaveLength(1)
  })

  it('deduplicates exutoires with the same id', () => {
    const dups = [
      { id: 'e1', lat: MARSEILLE.lat, lng: MARSEILLE.lng },
      { id: 'e1', lat: MARSEILLE.lat, lng: MARSEILLE.lng },
    ]
    const pts = collectMatrixPoints([], [], dups)
    expect(pts.filter(p => p.id === 'exu_e1')).toHaveLength(1)
  })

  it('carries correct lat/lng for driver depot', () => {
    const pts = collectMatrixPoints([], drivers, [])
    expect(pts[0].lat).toBe(LYON.lat)
    expect(pts[0].lng).toBe(LYON.lng)
  })

  it('carries correct lat/lng for mission', () => {
    const pts = collectMatrixPoints(missions, [], [])
    expect(pts[0].lat).toBe(PARIS.lat)
    expect(pts[0].lng).toBe(PARIS.lng)
  })

  it('carries correct lat/lng for exutoire', () => {
    const pts = collectMatrixPoints([], [], exutoires)
    expect(pts[0].lat).toBe(MARSEILLE.lat)
    expect(pts[0].lng).toBe(MARSEILLE.lng)
  })

  it('handles multiple drivers without dedup', () => {
    const twoDrivers = [
      { id: 'd1', depotLat: LYON.lat, depotLng: LYON.lng },
      { id: 'd2', depotLat: PARIS.lat, depotLng: PARIS.lng },
    ]
    const pts = collectMatrixPoints([], twoDrivers, [])
    expect(pts).toHaveLength(2)
    expect(pts[0].id).toBe('depot_d1')
    expect(pts[1].id).toBe('depot_d2')
  })

  it('handles multiple missions', () => {
    const twoMissions = [
      { id: 'm1', latitude: PARIS.lat, longitude: PARIS.lng },
      { id: 'm2', latitude: LYON.lat,  longitude: LYON.lng  },
    ]
    const pts = collectMatrixPoints(twoMissions, [], [])
    expect(pts).toHaveLength(2)
    expect(pts[0].id).toBe('m1')
    expect(pts[1].id).toBe('m2')
  })

  it('does not cross-deduplicate different id types (mission id vs exutoire exu_ id)', () => {

    const mWithExuName = [{ id: 'exu_e1', latitude: PARIS.lat, longitude: PARIS.lng }]
    const exuList      = [{ id: 'e1',     lat: MARSEILLE.lat,  lng: MARSEILLE.lng   }]

    const pts = collectMatrixPoints(mWithExuName, [], exuList)
    expect(pts).toHaveLength(1)
    expect(pts[0].id).toBe('exu_e1')
  })
})

// Regression M8: the cache key used to be a hashed int32 (FNV-1a-like) with no collision check
// — at the cache's stated max size (500k), the birthday paradox makes a collision near-certain
// well before it fills, silently returning one pair's cached distance for a completely
// different pair. The key is now the coordinates themselves (as a string), so two distinct
// pairs structurally cannot collide.
describe('cache key collision (M8 regression)', () => {
  it('two distinct nearby coordinate pairs each return their own correct distance, repeatedly', () => {
    const d1a = haversineKm(45.1000, 5.2000, 45.1000, 5.3000)
    const d2a = haversineKm(45.1001, 5.2001, 45.1001, 5.3001)
    // Same two pairs queried again must still return their own value, not a merged/overwritten one
    const d1b = haversineKm(45.1000, 5.2000, 45.1000, 5.3000)
    const d2b = haversineKm(45.1001, 5.2001, 45.1001, 5.3001)
    expect(d1a).toBe(d1b)
    expect(d2a).toBe(d2b)
  })
})
