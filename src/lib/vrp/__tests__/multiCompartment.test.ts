import { describe, it, expect } from 'vitest'
import {
  initLoadState,
  needsDump,
  loadBin,
  dumpAll,
  countDumpTrips,
} from '../multiCompartment'
import type { Driver, Mission } from '@/lib/types'

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'd-1',
    firstName: 'A',
    lastName: 'A',
    sector: 'N',
    depotName: 'D',
    depotLat: 45.9,
    depotLng: 6.1,
    archived: false,
    vehicleCapacity: 3,
    ...overrides,
  }
}

function makeMission(type: Mission['type'], binSizeM3?: number): Mission {
  return {
    id: `m-${Math.random()}`,
    type,
    date: '2025-06-15',
    address: 'test',
    latitude: 45.9,
    longitude: 6.1,
    estimatedDurationMin: 20,
    maneuverTimeMin: 5,
    binSizeM3,
  }
}

describe('initLoadState', () => {
  it('uses vehicleCapacity when no capacityDimensions', () => {
    const driver = makeDriver({ vehicleCapacity: 3 })
    const state = initLoadState(driver)
    expect(state.maxBins).toBe(3)
    expect(state.binsLoaded).toBe(0)
    expect(state.volumeLoadedM3).toBe(0)
  })

  it('uses nbBennes from capacityDimensions', () => {
    const driver = makeDriver({ capacityDimensions: { nbBennes: 5, volume: 150 } })
    const state = initLoadState(driver)
    expect(state.maxBins).toBe(5)
  })

  it('derives maxBins from volume when nbBennes absent', () => {
    const driver = makeDriver({
      capacityDimensions: { volume: 60 },
      maxBinSizeM3: 30,
    })
    const state = initLoadState(driver)
    expect(state.maxBins).toBe(2) // 60 / 30 = 2
  })

  it('maxBins is at least 1', () => {
    const driver = makeDriver({ vehicleCapacity: 0 })
    const state = initLoadState(driver)
    expect(state.maxBins).toBeGreaterThanOrEqual(1)
  })

  it('initializes with zero loads', () => {
    const state = initLoadState(makeDriver())
    expect(state.binsLoaded).toBe(0)
    expect(state.volumeLoadedM3).toBe(0)
  })
})

describe('needsDump', () => {
  it('returns false for non-pickup missions', () => {
    const state = { binsLoaded: 3, maxBins: 3, volumeLoadedM3: 0, maxVolumeM3: 90 }
    expect(needsDump(state, makeMission('POSER'))).toBe(false)
    expect(needsDump(state, makeMission('PAUSE'))).toBe(false)
    expect(needsDump(state, makeMission('VIDER'))).toBe(false)
  })

  it('returns true when bins at capacity', () => {
    const state = { binsLoaded: 3, maxBins: 3, volumeLoadedM3: 0, maxVolumeM3: 90 }
    expect(needsDump(state, makeMission('RETIRER'))).toBe(true)
  })

  it('returns false when bins below capacity', () => {
    const state = { binsLoaded: 2, maxBins: 3, volumeLoadedM3: 0, maxVolumeM3: 90 }
    expect(needsDump(state, makeMission('RETIRER'))).toBe(false)
  })

  it('returns true when volume would overflow', () => {
    const state = { binsLoaded: 0, maxBins: 5, volumeLoadedM3: 80, maxVolumeM3: 90 }
    expect(needsDump(state, makeMission('RETIRER', 15))).toBe(true) // 80 + 15 > 90
  })

  it('returns false when volume fits', () => {
    const state = { binsLoaded: 0, maxBins: 5, volumeLoadedM3: 20, maxVolumeM3: 90 }
    expect(needsDump(state, makeMission('RETIRER', 15))).toBe(false) // 20 + 15 < 90
  })

  it('checks ECHANGER and CHARGER_IMMEDIAT types', () => {
    const state = { binsLoaded: 3, maxBins: 3, volumeLoadedM3: 0, maxVolumeM3: 90 }
    expect(needsDump(state, makeMission('ECHANGER'))).toBe(true)
    expect(needsDump(state, makeMission('CHARGER_IMMEDIAT'))).toBe(true)
  })
})

describe('loadBin', () => {
  it('increments binsLoaded by 1', () => {
    const state = { binsLoaded: 1, maxBins: 3, volumeLoadedM3: 10, maxVolumeM3: 90 }
    const next = loadBin(state, makeMission('RETIRER', 15))
    expect(next.binsLoaded).toBe(2)
  })

  it('adds binSizeM3 to volumeLoadedM3', () => {
    const state = { binsLoaded: 0, maxBins: 3, volumeLoadedM3: 10, maxVolumeM3: 90 }
    const next = loadBin(state, makeMission('RETIRER', 20))
    expect(next.volumeLoadedM3).toBe(30)
  })

  it('uses 0 for missing binSizeM3', () => {
    const state = { binsLoaded: 0, maxBins: 3, volumeLoadedM3: 10, maxVolumeM3: 90 }
    const next = loadBin(state, makeMission('RETIRER'))
    expect(next.volumeLoadedM3).toBe(10)
  })

  it('does not mutate original state', () => {
    const state = { binsLoaded: 1, maxBins: 3, volumeLoadedM3: 5, maxVolumeM3: 90 }
    loadBin(state, makeMission('RETIRER', 10))
    expect(state.binsLoaded).toBe(1)
    expect(state.volumeLoadedM3).toBe(5)
  })
})

describe('dumpAll', () => {
  it('resets binsLoaded and volumeLoadedM3 to 0', () => {
    const state = { binsLoaded: 3, maxBins: 3, volumeLoadedM3: 90, maxVolumeM3: 90 }
    const next = dumpAll(state)
    expect(next.binsLoaded).toBe(0)
    expect(next.volumeLoadedM3).toBe(0)
  })

  it('preserves maxBins and maxVolumeM3', () => {
    const state = { binsLoaded: 3, maxBins: 5, volumeLoadedM3: 90, maxVolumeM3: 150 }
    const next = dumpAll(state)
    expect(next.maxBins).toBe(5)
    expect(next.maxVolumeM3).toBe(150)
  })
})

describe('countDumpTrips', () => {
  it('returns 0 for empty route', () => {
    expect(countDumpTrips([], makeDriver({ vehicleCapacity: 3 }))).toBe(0)
  })

  it('returns 1 for route with pickups under capacity', () => {
    const driver = makeDriver({ vehicleCapacity: 3 })
    const missions = [
      makeMission('RETIRER'),
      makeMission('RETIRER'),
      makeMission('POSER'),
    ]
    expect(countDumpTrips(missions, driver)).toBe(1)
  })

  it('returns 2 for route exceeding capacity', () => {
    const driver = makeDriver({ vehicleCapacity: 2 })
    const missions = [
      makeMission('RETIRER'),
      makeMission('RETIRER'),
      makeMission('RETIRER'), // triggers dump after 2
    ]
    expect(countDumpTrips(missions, driver)).toBe(2)
  })

  it('does not count non-pickup types toward dumps', () => {
    const driver = makeDriver({ vehicleCapacity: 2 })
    const missions = [
      makeMission('RETIRER'),
      makeMission('POSER'),
      makeMission('PAUSE'),
    ]
    expect(countDumpTrips(missions, driver)).toBe(1)
  })

  it('counts final trip if bins loaded at end', () => {
    const driver = makeDriver({ vehicleCapacity: 3 })
    const missions = [
      makeMission('RETIRER'),
    ]
    expect(countDumpTrips(missions, driver)).toBe(1)
  })
})
