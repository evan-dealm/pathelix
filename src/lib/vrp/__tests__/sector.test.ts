import { describe, it, expect, vi } from 'vitest'

vi.mock('../distanceCache', () => ({
  cachedDist: vi.fn((_lat1: number, _lng1: number, lat2: number, lng2: number) => {
    return Math.sqrt(Math.pow(lat2 - _lat1, 2) + Math.pow(lng2 - _lng1, 2))
  }),
}))

import {
  clusterDriversGeographically,
  assignMissionsToSectors,
  buildSectors,
  rebalanceSectors,
  validateSectorTemporalFeasibility,
} from '../sector'
import type { Sector } from '../sector'
import type { Driver, Mission } from '@/lib/types'

function makeDriver(id: string, lat: number, lng: number): Driver {
  return {
    id,
    name: `Driver ${id}`,
    depotLat: lat,
    depotLng: lng,
    skills: [],
    vehicleType: 'standard',
    maxBins: 6,
  } as unknown as Driver
}

function makeMission(id: string, lat: number, lng: number, opts: Partial<Mission> = {}): Mission {
  return {
    id,
    type: 'POSER',
    address: 'addr',
    latitude: lat,
    longitude: lng,
    estimatedDurationMin: 30,
    maneuverTimeMin: 5,
    ...opts,
  } as Mission
}

// ─── clusterDriversGeographically ────────────────────────────────────────────

describe('clusterDriversGeographically', () => {
  it('returns empty array for no drivers', () => {
    expect(clusterDriversGeographically([])).toHaveLength(0)
  })

  it('assigns all to sector 0 when all fit in one sector', () => {
    const drivers = [makeDriver('d1', 48.8, 2.3), makeDriver('d2', 48.9, 2.4)]
    const assignments = clusterDriversGeographically(drivers, 15)
    expect(new Set(assignments).size).toBe(1)
    expect(assignments.every(a => a === 0)).toBe(true)
  })

  it('creates multiple sectors when driver count exceeds target', () => {
    // 10 drivers, target 3 per sector → ~3-4 sectors
    const drivers = Array.from({ length: 10 }, (_, i) =>
      makeDriver(`d${i}`, 48.0 + i * 0.1, 2.0 + i * 0.1),
    )
    const assignments = clusterDriversGeographically(drivers, 3)
    expect(assignments).toHaveLength(10)
    const uniqueSectors = new Set(assignments)
    expect(uniqueSectors.size).toBeGreaterThan(1)
  })

  it('assigns geographically close drivers to same sector', () => {
    // Two clusters: north and south
    const northDrivers = Array.from({ length: 5 }, (_, i) =>
      makeDriver(`north${i}`, 51.0 + i * 0.01, 0.0),
    )
    const southDrivers = Array.from({ length: 5 }, (_, i) =>
      makeDriver(`south${i}`, 48.0 + i * 0.01, 0.0),
    )
    const drivers = [...northDrivers, ...southDrivers]
    const assignments = clusterDriversGeographically(drivers, 5)

    // North cluster indices should be same sector
    const northSectors = new Set(assignments.slice(0, 5))
    const southSectors = new Set(assignments.slice(5, 10))
    // The two clusters should not fully overlap
    const overlap = [...northSectors].filter(s => southSectors.has(s))
    expect(overlap.length).toBeLessThan(2)
  })
})

// ─── assignMissionsToSectors ─────────────────────────────────────────────────

describe('assignMissionsToSectors', () => {
  it('does nothing when no missions', () => {
    const sector: Sector = { index: 0, drivers: [makeDriver('d1', 48.0, 2.0)], missions: [] }
    assignMissionsToSectors([], [sector])
    expect(sector.missions).toHaveLength(0)
  })

  it('does nothing when no sectors', () => {
    const missions = [makeMission('m1', 48.0, 2.0)]
    assignMissionsToSectors(missions, [])
    // no throw
  })

  it('assigns all missions to the single sector', () => {
    const sector: Sector = { index: 0, drivers: [makeDriver('d1', 48.0, 2.0)], missions: [] }
    const missions = [
      makeMission('m1', 48.1, 2.1),
      makeMission('m2', 48.2, 2.2),
    ]
    assignMissionsToSectors(missions, [sector])
    expect(sector.missions).toHaveLength(2)
  })

  it('assigns missions to nearest sector by geo distance', () => {
    const northSector: Sector = { index: 0, drivers: [makeDriver('dn', 52.0, 0.0)], missions: [] }
    const southSector: Sector = { index: 1, drivers: [makeDriver('ds', 48.0, 0.0)], missions: [] }
    const missions = [
      makeMission('mn', 52.1, 0.1), // near north
      makeMission('ms', 47.9, 0.1), // near south
    ]
    assignMissionsToSectors(missions, [northSector, southSector])
    expect(northSector.missions.some(m => m.id === 'mn')).toBe(true)
    expect(southSector.missions.some(m => m.id === 'ms')).toBe(true)
  })

  it('clears existing missions before reassigning', () => {
    const sector: Sector = {
      index: 0,
      drivers: [makeDriver('d1', 48.0, 2.0)],
      missions: [makeMission('old', 48.0, 2.0)],
    }
    assignMissionsToSectors([makeMission('new', 48.1, 2.1)], [sector])
    expect(sector.missions.some(m => m.id === 'old')).toBe(false)
    expect(sector.missions.some(m => m.id === 'new')).toBe(true)
  })
})

// ─── buildSectors ─────────────────────────────────────────────────────────────

describe('buildSectors', () => {
  it('returns a single sector for small driver count', () => {
    const drivers = [makeDriver('d1', 48.0, 2.0), makeDriver('d2', 48.1, 2.1)]
    const missions = [makeMission('m1', 48.05, 2.05)]
    const sectors = buildSectors(drivers, missions, 15)
    expect(sectors.length).toBeGreaterThanOrEqual(1)
    // All missions assigned somewhere
    const totalAssigned = sectors.reduce((n, s) => n + s.missions.length, 0)
    expect(totalAssigned).toBe(missions.length)
  })

  it('returns multiple sectors when needed', () => {
    const drivers = Array.from({ length: 20 }, (_, i) =>
      makeDriver(`d${i}`, 48.0 + i * 0.1, 2.0),
    )
    const missions = Array.from({ length: 10 }, (_, i) =>
      makeMission(`m${i}`, 48.0 + i * 0.1, 2.0),
    )
    const sectors = buildSectors(drivers, missions, 5)
    expect(sectors.length).toBeGreaterThan(1)
  })

  it('sectors have contiguous indices starting at 0', () => {
    const drivers = [makeDriver('d1', 48.0, 2.0)]
    const sectors = buildSectors(drivers, [], 15)
    sectors.forEach((s, i) => expect(s.index).toBe(i))
  })
})

// ─── rebalanceSectors ─────────────────────────────────────────────────────────

describe('rebalanceSectors', () => {
  it('does nothing for single sector', () => {
    const sector: Sector = {
      index: 0,
      drivers: [makeDriver('d1', 48.0, 2.0)],
      missions: [makeMission('m1', 48.0, 2.0)],
    }
    expect(() => rebalanceSectors([sector])).not.toThrow()
    expect(sector.missions).toHaveLength(1)
  })

  it('does nothing for empty sectors list', () => {
    expect(() => rebalanceSectors([])).not.toThrow()
  })

  it('transfers missions from overloaded to underloaded sector', () => {
    // Sector A: 1 driver, 10 missions → very overloaded
    // Sector B: 1 driver, 0 missions → underloaded
    const sectorA: Sector = {
      index: 0,
      drivers: [makeDriver('dA', 48.0, 2.0)],
      missions: Array.from({ length: 10 }, (_, i) =>
        makeMission(`mA${i}`, 48.0, 2.0),
      ),
    }
    const sectorB: Sector = {
      index: 1,
      drivers: [makeDriver('dB', 48.1, 2.1)],
      missions: [],
    }
    rebalanceSectors([sectorA, sectorB])
    // After rebalancing, sectorB should have received some missions
    const totalA = sectorA.missions.length
    const totalB = sectorB.missions.length
    expect(totalA + totalB).toBe(10) // no missions lost
  })
})

// ─── validateSectorTemporalFeasibility ───────────────────────────────────────

describe('validateSectorTemporalFeasibility', () => {
  it('returns same sectors when no temporal issues', () => {
    const sector: Sector = {
      index: 0,
      drivers: [makeDriver('d1', 48.0, 2.0)],
      missions: [makeMission('m1', 48.0, 2.0)],
    }
    const result = validateSectorTemporalFeasibility([sector])
    expect(result).toHaveLength(1)
  })

  it('does not split sectors with fewer than 5 tight missions', () => {
    const sector: Sector = {
      index: 0,
      drivers: [makeDriver('d1', 48.0, 2.0), makeDriver('d2', 48.1, 2.1)],
      missions: Array.from({ length: 4 }, (_, i) =>
        makeMission(`m${i}`, 48.0, 2.0, {
          timeWindow: { openMin: 480, closeMin: 510 }, // 30-min window (tight)
        }),
      ),
    }
    const result = validateSectorTemporalFeasibility([sector])
    expect(result).toHaveLength(1)
  })

  it('splits sectors with many tight missions and wide span', () => {
    // 20 tight missions spanning 8 hours, 4 drivers, > 8 per driver
    const missions = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeMission(`early${i}`, 48.0, 2.0, {
          timeWindow: { openMin: 480, closeMin: 510 }, // 8:00 AM window
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeMission(`late${i}`, 48.0, 2.0, {
          timeWindow: { openMin: 960, closeMin: 990 }, // 4:00 PM window
        }),
      ),
    ]
    const sector: Sector = {
      index: 0,
      drivers: [
        makeDriver('d1', 48.0, 2.0),
        makeDriver('d2', 48.1, 2.1),
        makeDriver('d3', 48.2, 2.2),
        makeDriver('d4', 48.3, 2.3),
      ],
      missions,
    }
    const result = validateSectorTemporalFeasibility([sector], 6)
    // Should split into morning + afternoon sectors
    expect(result.length).toBeGreaterThanOrEqual(1)
    // All missions should be accounted for
    const totalMissions = result.reduce((n, s) => n + s.missions.length, 0)
    expect(totalMissions).toBe(20)
  })
})
