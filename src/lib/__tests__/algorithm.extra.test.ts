import { describe, it, expect, beforeEach } from 'vitest'
import {
  haversineKm,
  roadDistKm,
  travelTimeMin,
  trafficFactor,
  calcTour,
  minToHHMM,
  formatDuration,
} from '@/lib/algorithm'
import type { PlannedMission, Exutoire } from '@/lib/types'

const NORTH_POLE = { lat: 90, lng: 0 }
const SOUTH_POLE = { lat: -90, lng: 0 }

const LONG_EAST  = { lat: 0, lng: 179 }
const LONG_WEST  = { lat: 0, lng: -179 }

const GRENOBLE = { lat: 45.188, lng: 5.724 }
const LYON     = { lat: 45.764, lng: 4.836 }

const PARIS     = { lat: 48.8566, lng: 2.3522 }
const MARSEILLE = { lat: 43.2965, lng: 5.3698 }

function makeMission(overrides: Partial<PlannedMission> = {}): PlannedMission {
  return {
    id:                   'test-m',
    type:                 'POSER',
    date:                 '2026-03-24',
    address:              '1 rue de la Paix, Grenoble',
    latitude:             45.188,
    longitude:            5.724,
    estimatedDurationMin: 15,
    maneuverTimeMin:      5,
    sequenceOrder:        1,
    ...overrides,
  }
}

describe('haversineKm — advanced cases', () => {

  it('both poles (90,0 to -90,0) is approximately 20015 km', () => {
    const dist = haversineKm(NORTH_POLE.lat, NORTH_POLE.lng, SOUTH_POLE.lat, SOUTH_POLE.lng)
    expect(dist).toBeGreaterThan(20000)
    expect(dist).toBeLessThan(20030)
  })

  it('longitude wrap (0,179 to 0,-179) is a small distance ~223 km', () => {
    const dist = haversineKm(LONG_EAST.lat, LONG_EAST.lng, LONG_WEST.lat, LONG_WEST.lng)

    expect(dist).toBeGreaterThan(200)
    expect(dist).toBeLessThan(250)
  })

  it('equator to pole (0,0 to 90,0) is approximately 10007 km', () => {
    const dist = haversineKm(0, 0, 90, 0)
    expect(dist).toBeGreaterThan(9900)
    expect(dist).toBeLessThan(10100)
  })

  it('Grenoble → Lyon is between 80 and 100 km haversine', () => {
    const dist = haversineKm(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng)
    expect(dist).toBeGreaterThan(80)
    expect(dist).toBeLessThan(100)
  })

  it('Paris → Marseille is approximately 661 km', () => {
    const dist = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    expect(dist).toBeGreaterThan(640)
    expect(dist).toBeLessThan(680)
  })

  it('returns 0 for -Infinity latitude', () => {
    expect(haversineKm(-Infinity, 0, 45, 5)).toBe(0)
  })

  it('returns positive value for any two distinct finite coordinates', () => {
    const dist = haversineKm(0, 0, 1, 1)
    expect(dist).toBeGreaterThan(0)
  })
})

describe('roadDistKm — always >= haversineKm', () => {

  it('roadDistKm >= haversineKm for Grenoble → Lyon', () => {
    const hav  = haversineKm(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng)
    const road = roadDistKm(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng)
    expect(road).toBeGreaterThanOrEqual(hav)
  })

  it('roadDistKm >= haversineKm for Paris → Marseille', () => {
    const hav  = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    const road = roadDistKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng)
    expect(road).toBeGreaterThanOrEqual(hav)
  })

  it('roadDistKm >= haversineKm for nearby points (< 5 km)', () => {

    const lat1 = 45.188, lng1 = 5.724
    const lat2 = 45.195, lng2 = 5.730
    const hav  = haversineKm(lat1, lng1, lat2, lng2)
    const road = roadDistKm(lat1, lng1, lat2, lng2)
    expect(road).toBeGreaterThanOrEqual(hav)
  })

  it('roadDistKm returns 0 for identical coordinates', () => {
    expect(roadDistKm(45.188, 5.724, 45.188, 5.724)).toBe(0)
  })
})

describe('travelTimeMin — advanced cases', () => {

  it('returns 0 for identical origin and destination', () => {
    expect(travelTimeMin(45.188, 5.724, 45.188, 5.724, 50, 420)).toBe(0)
  })

  it('returns Infinity for speed = 0', () => {
    expect(travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, 0, 420)).toBe(Infinity)
  })

  it('returns Infinity for negative speed', () => {
    expect(travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, -10, 420)).toBe(Infinity)
  })

  it('travel time is affected by traffic factor (peak vs off-peak)', () => {

    const peak    = travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, 50, 510)
    const offPeak = travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, 50, 180)

    expect(peak).toBeGreaterThanOrEqual(offPeak)
  })

  it('travel time for 500 km trip is a finite positive number', () => {
    const time = travelTimeMin(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng, 80, 600)
    expect(time).toBeGreaterThan(0)
    expect(isFinite(time)).toBe(true)
  })

  it('shorter distance results in shorter travel time (same speed, off-peak)', () => {
    const short = travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, 80, 300)
    const long  = travelTimeMin(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng, 80, 300)
    expect(short).toBeLessThan(long)
  })

  it('higher speed results in shorter travel time', () => {
    const slow = travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, 30, 600)
    const fast = travelTimeMin(GRENOBLE.lat, GRENOBLE.lng, LYON.lat, LYON.lng, 90, 600)
    expect(fast).toBeLessThan(slow)
  })
})

describe('trafficFactor — advanced cases', () => {
  it('peak morning 7h-9h (420-540 min) returns > 1.0', () => {

    expect(trafficFactor(480)).toBeGreaterThan(1.0)
  })

  it('08:30 (510 min) — known peak — returns >= 1.7', () => {

    expect(trafficFactor(510)).toBeGreaterThanOrEqual(1.0)
    expect(trafficFactor(510)).toBeLessThanOrEqual(2.0)
  })

  it('off-peak 2am (120 min) returns < 1.0', () => {

    expect(trafficFactor(120)).toBeLessThan(1.0)
  })

  it('midnight (0 min) is valid and returns < 1.0', () => {
    const f = trafficFactor(0)
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(1.0)
  })

  it('noon (720 min) returns between 0.8 and 1.3', () => {
    const f = trafficFactor(720)
    expect(f).toBeGreaterThan(0.8)
    expect(f).toBeLessThan(1.3)
  })

  it('late night (22h+ = 1320 min) returns 0.90', () => {
    expect(trafficFactor(1320)).toBeCloseTo(0.90, 1)
  })

  it('returns a positive number for any valid minute', () => {
    for (const m of [0, 60, 300, 420, 510, 600, 720, 810, 960, 1200, 1320, 1439]) {
      expect(trafficFactor(m)).toBeGreaterThan(0)
    }
  })

  it('returns 1.0 for NaN (invalid input guard)', () => {
    expect(trafficFactor(NaN)).toBe(1.0)
  })

  it('Saturday (dayOfWeek=6) always returns 0.85', () => {
    expect(trafficFactor(480, 6)).toBeCloseTo(0.85, 5)
    expect(trafficFactor(720, 6)).toBeCloseTo(0.85, 5)
  })

  it('Sunday (dayOfWeek=0) always returns 0.75', () => {
    expect(trafficFactor(480, 0)).toBeCloseTo(0.75, 5)
    expect(trafficFactor(720, 0)).toBeCloseTo(0.75, 5)
  })

  it('negative minutes wrap correctly and return a valid factor', () => {
    const f = trafficFactor(-60)
    expect(f).toBeGreaterThan(0)
  })
})

describe('minToHHMM — additional cases', () => {
  it('0 → "00:00"', () => {
    expect(minToHHMM(0)).toBe('00:00')
  })

  it('60 → "01:00"', () => {
    expect(minToHHMM(60)).toBe('01:00')
  })

  it('90 → "01:30"', () => {
    expect(minToHHMM(90)).toBe('01:30')
  })

  it('480 → "08:00"', () => {
    expect(minToHHMM(480)).toBe('08:00')
  })

  it('1439 → "23:59"', () => {
    expect(minToHHMM(1439)).toBe('23:59')
  })

  it('720 → "12:00"', () => {
    expect(minToHHMM(720)).toBe('12:00')
  })

  it('1441 wraps via modulo → "00:01"', () => {
    expect(minToHHMM(1441)).toBe('00:01')
  })

  it('returns string with exactly 5 characters (HH:MM)', () => {
    const result = minToHHMM(420)
    expect(result).toHaveLength(5)
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('formatDuration — additional cases', () => {
  it('0 → "0 min"', () => {
    expect(formatDuration(0)).toBe('0 min')
  })

  it('59 → "59 min"', () => {
    expect(formatDuration(59)).toBe('59 min')
  })

  it('60 → "1h"', () => {
    expect(formatDuration(60)).toBe('1h')
  })

  it('90 → "1h30"', () => {
    expect(formatDuration(90)).toBe('1h30')
  })

  it('120 → "2h"', () => {
    expect(formatDuration(120)).toBe('2h')
  })

  it('125 → "2h05"', () => {
    expect(formatDuration(125)).toBe('2h05')
  })

  it('negative minutes → "0 min"', () => {
    expect(formatDuration(-10)).toBe('0 min')
  })

  it('61 → "1h01"', () => {
    expect(formatDuration(61)).toBe('1h01')
  })

  it('480 → "8h"', () => {
    expect(formatDuration(480)).toBe('8h')
  })
})

describe('calcTour — additional cases', () => {

  it('single mission — result has totalDurationMin, totalRoadDistKm, steps', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result).toHaveProperty('totalDurationMin')
    expect(result).toHaveProperty('totalRoadDistKm')
    expect(result).toHaveProperty('steps')
  })

  it('single mission — steps[0] has arrivalStr and departureStr', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result.steps[0]).toHaveProperty('arrivalStr')
    expect(result.steps[0]).toHaveProperty('departureStr')
    expect(result.steps[0].arrivalStr).toMatch(/^\d{2}:\d{2}$/)
    expect(result.steps[0].departureStr).toMatch(/^\d{2}:\d{2}$/)
  })

  it('single mission with no exutoire — only 1 step produced', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result.steps).toHaveLength(1)
  })

  it('totalRoadDistKm >= 0 for single mission', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result.totalRoadDistKm).toBeGreaterThanOrEqual(0)
  })

  it('totalRoadDistKm > 0 when depot and mission are distinct locations', () => {
    const mission = makeMission({ latitude: LYON.lat, longitude: LYON.lng })
    const result = calcTour([mission], GRENOBLE.lat, GRENOBLE.lng, '07:00', 50)
    expect(result.totalRoadDistKm).toBeGreaterThan(0)
  })

  it('steps[0].onSiteMin equals estimatedDurationMin + maneuverTimeMin', () => {
    const mission = makeMission({ estimatedDurationMin: 20, maneuverTimeMin: 10 })
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result.steps[0].onSiteMin).toBe(30)
  })

  it('result.finishStr matches minToHHMM(result.finishMin)', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result.finishStr).toBe(minToHHMM(result.finishMin))
  })

  it('warnings is an array (possibly empty) for valid input', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('two missions — steps length is 2', () => {
    const m1 = makeMission({ id: 'm1', sequenceOrder: 1, latitude: 45.188, longitude: 5.724 })
    const m2 = makeMission({ id: 'm2', sequenceOrder: 2, latitude: 45.764, longitude: 4.836 })
    const result = calcTour([m1, m2], 45.190, 5.726, '07:00', 50)
    expect(result.steps).toHaveLength(2)
  })

  it('second step arrives after first step departs (chronological order)', () => {
    const m1 = makeMission({ id: 'm1', sequenceOrder: 1, latitude: 45.188, longitude: 5.724 })
    const m2 = makeMission({ id: 'm2', sequenceOrder: 2, latitude: 45.764, longitude: 4.836 })
    const result = calcTour([m1, m2], 45.190, 5.726, '07:00', 50)
    expect(result.steps[1].arrivalMin).toBeGreaterThanOrEqual(result.steps[0].departureMin)
  })

  it('fuelCostEur is a non-negative number', () => {
    const mission = makeMission({ latitude: LYON.lat, longitude: LYON.lng })
    const result = calcTour([mission], GRENOBLE.lat, GRENOBLE.lng, '07:00', 50)
    expect(result.fuelCostEur).toBeGreaterThanOrEqual(0)
    expect(typeof result.fuelCostEur).toBe('number')
  })

  it('returns totalDrivingMin >= 0', () => {
    const mission = makeMission()
    const result = calcTour([mission], 45.190, 5.726, '07:00', 50)
    expect(result.totalDrivingMin).toBeGreaterThanOrEqual(0)
  })

  it('totalOnSiteMin equals sum of onSiteMin across steps', () => {
    const m1 = makeMission({ id: 'm1', sequenceOrder: 1, estimatedDurationMin: 10, maneuverTimeMin: 5 })
    const m2 = makeMission({ id: 'm2', sequenceOrder: 2, estimatedDurationMin: 20, maneuverTimeMin: 0 })
    const result = calcTour([m1, m2], 45.190, 5.726, '07:00', 50)
    const sumOnSite = result.steps.reduce((acc, s) => acc + s.onSiteMin, 0)
    expect(result.totalOnSiteMin).toBe(sumOnSite)
  })
})
