import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordOBDReading,
  getAllCurrentPositions,
  getSpeedHistoryForDate,
  getAllSpeedHistories,
  pruneOldOBDData,
} from '@/lib/obdStore'

const BASE_TS = new Date('2026-05-10T09:30:00.000Z').getTime()
const TODAY   = '2026-05-10'

function readingFor(driverId: string, overrides: Partial<{ lat: number; lng: number; speedKmh: number; ignition: boolean; timestamp: number }> = {}) {
  return {
    driverId,
    timestamp: BASE_TS,
    lat:       45.76,
    lng:       4.83,
    speedKmh:  60,
    ignition:  true,
    ...overrides,
  }
}

beforeEach(() => {
  pruneOldOBDData(0)
})

describe('recordOBDReading + getAllCurrentPositions', () => {
  it('stores and retrieves a driver position', () => {
    recordOBDReading(readingFor('d-1'))
    const positions = getAllCurrentPositions()
    const pos = positions.find(p => p.driverId === 'd-1')
    expect(pos).toBeDefined()
    expect(pos!.lat).toBe(45.76)
    expect(pos!.lng).toBe(4.83)
    expect(pos!.speedKmh).toBe(60)
    expect(pos!.ignition).toBe(true)
  })

  it('overwrites previous position for same driver', () => {
    recordOBDReading(readingFor('d-2', { speedKmh: 50 }))
    recordOBDReading(readingFor('d-2', { speedKmh: 80, lat: 45.80 }))
    const positions = getAllCurrentPositions()
    const pos = positions.find(p => p.driverId === 'd-2')
    expect(pos!.speedKmh).toBe(80)
    expect(pos!.lat).toBe(45.80)
  })

  it('stores multiple drivers independently', () => {
    recordOBDReading(readingFor('d-alpha', { lat: 45.10 }))
    recordOBDReading(readingFor('d-beta',  { lat: 46.20 }))
    const positions = getAllCurrentPositions()
    expect(positions.find(p => p.driverId === 'd-alpha')?.lat).toBe(45.10)
    expect(positions.find(p => p.driverId === 'd-beta')?.lat).toBe(46.20)
  })

  it('records ignition=false correctly', () => {
    recordOBDReading(readingFor('d-off', { ignition: false }))
    const pos = getAllCurrentPositions().find(p => p.driverId === 'd-off')
    expect(pos!.ignition).toBe(false)
  })
})

describe('getSpeedHistoryForDate', () => {
  it('returns empty array for unknown driver', () => {
    expect(getSpeedHistoryForDate('nobody', TODAY)).toEqual([])
  })

  it('returns speed history sorted by minute', () => {
    const ts1 = new Date('2026-05-10T08:00:00Z').getTime()
    const ts2 = new Date('2026-05-10T09:00:00Z').getTime()
    const ts3 = new Date('2026-05-10T07:00:00Z').getTime()

    recordOBDReading(readingFor('d-hist', { timestamp: ts1, speedKmh: 60 }))
    recordOBDReading(readingFor('d-hist', { timestamp: ts2, speedKmh: 80 }))
    recordOBDReading(readingFor('d-hist', { timestamp: ts3, speedKmh: 40 }))

    const history = getSpeedHistoryForDate('d-hist', TODAY)
    expect(history.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < history.length; i++) {
      expect(history[i].minuteOfDay).toBeGreaterThanOrEqual(history[i - 1].minuteOfDay)
    }
  })

  it('deduplicates readings at same minute (keeps latest)', () => {
    const base = new Date('2026-05-10T10:00:00.000Z').getTime()
    const sameMinute2 = base + 30_000

    recordOBDReading(readingFor('d-dedup', { timestamp: base,        speedKmh: 55 }))
    recordOBDReading(readingFor('d-dedup', { timestamp: sameMinute2, speedKmh: 70 }))

    const history = getSpeedHistoryForDate('d-dedup', TODAY)

    const d = new Date(base)
    const expectedMinute = d.getHours() * 60 + d.getMinutes()
    const duped = history.filter(h => h.minuteOfDay === expectedMinute)
    expect(duped).toHaveLength(1)
    expect(duped[0].speedKmh).toBe(70)
  })

  it('only returns entries for requested date', () => {
    const ts = new Date('2026-05-11T09:00:00Z').getTime()
    recordOBDReading(readingFor('d-date', { timestamp: ts }))
    expect(getSpeedHistoryForDate('d-date', TODAY)).toHaveLength(0)
    expect(getSpeedHistoryForDate('d-date', '2026-05-11').length).toBeGreaterThan(0)
  })
})

describe('getAllSpeedHistories', () => {
  it('returns histories keyed by driverId for the given date', () => {
    const ts = new Date('2026-05-10T10:00:00Z').getTime()
    recordOBDReading(readingFor('d-x', { timestamp: ts }))
    recordOBDReading(readingFor('d-y', { timestamp: ts, speedKmh: 90 }))

    const all = getAllSpeedHistories(TODAY)
    expect(all['d-x']).toBeDefined()
    expect(all['d-y']).toBeDefined()
    expect(all['d-y'][0].speedKmh).toBe(90)
  })

  it('excludes data from other dates', () => {
    const ts = new Date('2026-04-01T10:00:00Z').getTime()
    recordOBDReading(readingFor('d-old', { timestamp: ts }))
    const all = getAllSpeedHistories(TODAY)
    expect(all['d-old']).toBeUndefined()
  })
})

describe('pruneOldOBDData', () => {
  it('removes positions and history older than daysToKeep', () => {
    const oldTs = new Date('2020-01-01T10:00:00Z').getTime()
    recordOBDReading(readingFor('d-prune', { timestamp: oldTs }))

    pruneOldOBDData(7)

    const positions = getAllCurrentPositions()
    expect(positions.find(p => p.driverId === 'd-prune')).toBeUndefined()
    expect(getSpeedHistoryForDate('d-prune', '2020-01-01')).toHaveLength(0)
  })

  it('keeps recent positions', () => {
    const recentTs = Date.now() - 1000
    recordOBDReading(readingFor('d-keep', { timestamp: recentTs }))

    pruneOldOBDData(7)

    const positions = getAllCurrentPositions()
    expect(positions.find(p => p.driverId === 'd-keep')).toBeDefined()
  })
})
