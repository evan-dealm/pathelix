import { describe, it, expect, beforeEach } from 'vitest'
import { haversineKm, roadDistKm, travelTimeMin, trafficFactor, calcTour, minToHHMM, formatDuration } from '../algorithm'
import { clearDistanceCache } from '@/lib/vrp/distanceCache'
import type { PlannedMission, Exutoire } from '@/lib/types'

const PARIS = { lat: 48.8566, lng: 2.3522 }
const LYON  = { lat: 45.7640, lng: 4.8357 }

const GARE_LYON = { lat: 48.8443, lng: 2.3736 }
const BASTILLE  = { lat: 48.8534, lng: 2.3690 }

function makeMission(overrides: Partial<PlannedMission> = {}): PlannedMission {
  return {
    id:                   'm-1',
    type:                 'POSER',
    date:                 '2026-03-18',
    address:              '10 rue de Rivoli, Paris',
    latitude:             48.8566,
    longitude:            2.3522,
    estimatedDurationMin: 15,
    maneuverTimeMin:      5,
    sequenceOrder:        1,
    ...overrides,
  }
}

describe('haversineKm', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  it('returns correct distance Paris → Lyon (~392 km)', () => {
    const dist = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    expect(dist).toBeGreaterThan(380)
    expect(dist).toBeLessThan(400)
  })

  it('returns correct distance for nearby points (~1 km)', () => {
    const dist = haversineKm(GARE_LYON.lat, GARE_LYON.lng, BASTILLE.lat, BASTILLE.lng)
    expect(dist).toBeGreaterThan(0.5)
    expect(dist).toBeLessThan(2.0)
  })

  it('returns 0 for identical coordinates', () => {
    const dist = haversineKm(PARIS.lat, PARIS.lng, PARIS.lat, PARIS.lng)
    expect(dist).toBe(0)
  })

  it('returns 0 for NaN coordinates', () => {
    expect(haversineKm(NaN, 2.0, 48.0, 2.0)).toBe(0)
  })

  it('returns 0 for Infinity coordinates', () => {
    expect(haversineKm(Infinity, 2.0, 48.0, 2.0)).toBe(0)
  })

  it('is symmetric (A→B == B→A)', () => {
    const ab = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const ba = haversineKm(LYON.lat, LYON.lng, PARIS.lat, PARIS.lng)
    expect(ab).toBeCloseTo(ba, 6)
  })
})

describe('distance cache', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  it('returns same result on cache hit', () => {
    const first  = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const second = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    expect(first).toBe(second)
  })

  it('cache hit is symmetric', () => {
    haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)

    const result = haversineKm(LYON.lat, LYON.lng, PARIS.lat, PARIS.lng)
    expect(result).toBeGreaterThan(380)
  })
})

describe('roadDistKm', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  it('returns road distance > haversine distance (tortuosity factor)', () => {
    const hav  = haversineKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    const road = roadDistKm(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng)
    expect(road).toBeGreaterThan(hav)
  })

  it('returns 0 for identical coordinates', () => {
    expect(roadDistKm(PARIS.lat, PARIS.lng, PARIS.lat, PARIS.lng)).toBe(0)
  })
})

describe('trafficFactor', () => {
  it('returns base factor 1.0 during off-peak hours', () => {

    expect(trafficFactor(600)).toBe(1.0)
  })

  it('returns elevated factor during morning rush (08:30 = 510 min)', () => {
    expect(trafficFactor(510)).toBeGreaterThan(1.0)
  })

  it('returns low factor during late night (02:00 = 120 min)', () => {
    expect(trafficFactor(120)).toBeLessThan(1.0)
  })

  it('handles negative minutes via modulo', () => {

    const result = trafficFactor(-60)
    expect(result).toBeGreaterThan(0)
  })
})

describe('travelTimeMin', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  it('returns 0 for same origin and destination', () => {
    const time = travelTimeMin(PARIS.lat, PARIS.lng, PARIS.lat, PARIS.lng, 50, 420)
    expect(time).toBe(0)
  })

  it('returns Infinity when speed is 0', () => {
    const time = travelTimeMin(PARIS.lat, PARIS.lng, LYON.lat, LYON.lng, 0, 420)
    expect(time).toBe(Infinity)
  })

  it('returns positive time for valid trip', () => {
    const time = travelTimeMin(GARE_LYON.lat, GARE_LYON.lng, BASTILLE.lat, BASTILLE.lng, 30, 420)
    expect(time).toBeGreaterThan(0)
  })
})

describe('calcTour', () => {
  beforeEach(() => {
    clearDistanceCache()
  })

  it('returns empty result for empty missions', () => {
    const result = calcTour([], 48.85, 2.35, '07:00', 50)
    expect(result.steps).toHaveLength(0)
    expect(result.totalDurationMin).toBe(0)
    expect(result.totalRoadDistKm).toBe(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('calculates tour with single mission', () => {
    const mission = makeMission({
      latitude: 48.87,
      longitude: 2.38,
    })
    const result = calcTour([mission], 48.85, 2.35, '07:00', 50)

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].mission.id).toBe('m-1')
    expect(result.steps[0].arrivalMin).toBeGreaterThanOrEqual(420)
    expect(result.steps[0].onSiteMin).toBe(20)
    expect(result.totalDurationMin).toBeGreaterThan(0)
    expect(result.finishMin).toBeGreaterThan(420)
  })

  it('respects time windows — waits if arriving early', () => {
    const mission = makeMission({
      latitude:  48.856,
      longitude: 2.353,
      timeWindow: { openMin: 600, closeMin: 720 },
    })

    const result = calcTour([mission], 48.856, 2.352, '07:00', 50)

    expect(result.steps[0].arrivalMin).toBeGreaterThanOrEqual(600)
  })

  it('orders missions by sequence and accumulates travel time', () => {
    const missions: PlannedMission[] = [
      makeMission({ id: 'm-1', sequenceOrder: 1, latitude: 48.86, longitude: 2.36 }),
      makeMission({ id: 'm-2', sequenceOrder: 2, latitude: 48.88, longitude: 2.40 }),
    ]

    const result = calcTour(missions, 48.85, 2.35, '07:00', 50)

    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].mission.id).toBe('m-1')
    expect(result.steps[1].mission.id).toBe('m-2')

    expect(result.steps[1].arrivalMin).toBeGreaterThanOrEqual(result.steps[0].departureMin)
  })

  it('warns on invalid speed and falls back to 50 km/h', () => {
    const mission = makeMission()
    const result = calcTour([mission], 48.85, 2.35, '07:00', -10)

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].message).toContain('Vitesse invalide')
  })

  it('warns on invalid depot coordinates', () => {
    const mission = makeMission()
    const result = calcTour([mission], NaN, NaN, '07:00', 50)

    expect(result.warnings.some(w => w.message.includes('dépôt'))).toBe(true)
  })

  it('warns on mission with invalid GPS coordinates', () => {
    const mission = makeMission({ latitude: NaN, longitude: NaN })
    const result = calcTour([mission], 48.85, 2.35, '07:00', 50)

    expect(result.warnings.some(w => w.message.includes('GPS invalides'))).toBe(true)
    expect(result.steps[0].hasMissingCoords).toBe(true)
  })

  it('warns on time window violation (late arrival)', () => {

    const mission = makeMission({
      latitude:   45.76,
      longitude:  4.83,
      timeWindow: { openMin: 420, closeMin: 425 },
    })

    const result = calcTour([mission], 48.85, 2.35, '07:00', 50)
    expect(result.warnings.some(w => w.message.includes('fermeture de la fenêtre'))).toBe(true)
  })

  it('handles linked exutoire', () => {
    const exutoire: Exutoire = {
      id:                'ex-1',
      name:              'Déchetterie Nord',
      address:           '1 rue du Tri',
      lat:               48.89,
      lng:               2.35,
      openingHoursOpen:  360,
      openingHoursClose: 1080,
      closedDays:        [0],
      acceptedWasteTypes: ['Encombrants'],
      serviceTimeMin:    10,
    }

    const mission = makeMission({
      type:             'RETIRER',
      linkedExutoireId: 'ex-1',
      latitude:  48.86,
      longitude: 2.36,
    })

    const result = calcTour([mission], 48.85, 2.35, '07:00', 50, [exutoire])

    expect(result.steps).toHaveLength(2)
    expect(result.steps[1].mission.type).toBe('VIDER')
    expect(result.steps[1].mission.isSynthetic).toBe(true)
  })

  it('defaults to 07:00 for invalid startTime', () => {
    const mission = makeMission()
    const result = calcTour([mission], 48.85, 2.35, 'invalid', 50)

    expect(result.steps[0].arrivalMin).toBeGreaterThanOrEqual(420)
  })
})

describe('minToHHMM', () => {
  it('formats 420 as 07:00', () => {
    expect(minToHHMM(420)).toBe('07:00')
  })

  it('formats 0 as 00:00', () => {
    expect(minToHHMM(0)).toBe('00:00')
  })

  it('formats 1439 as 23:59', () => {
    expect(minToHHMM(1439)).toBe('23:59')
  })
})

describe('formatDuration', () => {
  it('formats 0 as "0 min"', () => {
    expect(formatDuration(0)).toBe('0 min')
  })

  it('formats 45 as "45 min"', () => {
    expect(formatDuration(45)).toBe('45 min')
  })

  it('formats 60 as "1h"', () => {
    expect(formatDuration(60)).toBe('1h')
  })

  it('formats 90 as "1h30"', () => {
    expect(formatDuration(90)).toBe('1h30')
  })
})
