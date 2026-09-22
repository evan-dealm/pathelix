import { describe, it, expect } from 'vitest'
import { toLngLat, latLngTupleToLngLat, routingGeometryToLngLat } from '@/lib/maplibre/coords'

// Real coordinates from this project's seed data (prisma/seed.ts) — the exact kind of value
// that flows from Driver.depotLat/depotLng, Mission.latitude/longitude, Exutoire.lat/lng into
// a map. Getting this conversion backwards silently misplaces every point on the map without
// throwing — these tests exist specifically to catch that regression.
const GABIN_DEPOT = { lat: 46.0682, lng: 5.9245 }       // La Semine depot (seed.ts)
const CARNEIRO_MISSION = { lat: 46.310, lng: 6.068 }    // ZI Valserhône mission (seed.ts)
const SIVALOR_EXUTOIRE = { lat: 46.2437, lng: 6.0250 }  // Sivalor Saint-Genis exutoire (seed.ts)

describe('toLngLat', () => {
  it('flips {lat, lng} to MapLibre [lng, lat] order', () => {
    expect(toLngLat(GABIN_DEPOT)).toEqual([5.9245, 46.0682])
  })

  it('flips a real mission coordinate correctly', () => {
    expect(toLngLat(CARNEIRO_MISSION)).toEqual([6.068, 46.310])
  })

  it('flips a real exutoire coordinate correctly', () => {
    expect(toLngLat(SIVALOR_EXUTOIRE)).toEqual([6.025, 46.2437])
  })

  it('never returns the input order unchanged (lat !== lng in every fixture)', () => {
    for (const p of [GABIN_DEPOT, CARNEIRO_MISSION, SIVALOR_EXUTOIRE]) {
      const [lng, lat] = toLngLat(p)
      expect(lng).toBe(p.lng)
      expect(lat).toBe(p.lat)
      expect(lng).not.toBe(p.lat) // guards against a silent no-op "conversion"
    }
  })

  it('handles negative longitude (west of Greenwich) without sign errors', () => {
    expect(toLngLat({ lat: 48.8566, lng: -2.3522 })).toEqual([-2.3522, 48.8566])
  })
})

describe('latLngTupleToLngLat', () => {
  it('flips a Leaflet-style [lat, lng] tuple to MapLibre [lng, lat]', () => {
    expect(latLngTupleToLngLat([46.0682, 5.9245])).toEqual([5.9245, 46.0682])
  })

  it('round-trips with toLngLat for the same point', () => {
    const fromObject = toLngLat(GABIN_DEPOT)
    const fromTuple   = latLngTupleToLngLat([GABIN_DEPOT.lat, GABIN_DEPOT.lng])
    expect(fromTuple).toEqual(fromObject)
  })
})

describe('routingGeometryToLngLat', () => {
  it('is an identity pass-through — /api/routing already returns GeoJSON [lng, lat]', () => {
    const geo: [number, number][] = [[6.068, 46.310], [5.9245, 46.0682]]
    expect(routingGeometryToLngLat(geo)).toEqual(geo)
  })

  it('returns an empty array unchanged', () => {
    expect(routingGeometryToLngLat([])).toEqual([])
  })
})
