import { describe, it, expect } from 'vitest'
import { isHfvrpCompatible, areAllHfvrpCompatible } from '../hfvrp'
import type { Driver, Mission } from '@/lib/types'

function makeDriver(maxBinSizeM3?: number): Driver {
  return {
    id: 'd-1',
    firstName: 'A',
    lastName: 'A',
    sector: 'N',
    depotName: 'D',
    depotLat: 45.9,
    depotLng: 6.1,
    archived: false,
    maxBinSizeM3,
  }
}

function makeMission(binSizeM3?: number): Mission {
  return {
    id: 'm-1',
    type: 'RETIRER',
    date: '2025-06-15',
    address: 'test',
    latitude: 45.9,
    longitude: 6.1,
    estimatedDurationMin: 20,
    maneuverTimeMin: 5,
    binSizeM3,
  }
}

describe('isHfvrpCompatible', () => {
  it('returns true when driver has no maxBinSizeM3', () => {
    expect(isHfvrpCompatible(makeMission(40), makeDriver())).toBe(true)
  })

  it('returns true when mission has no binSizeM3', () => {
    expect(isHfvrpCompatible(makeMission(), makeDriver(30))).toBe(true)
  })

  it('returns true when mission fits driver', () => {
    expect(isHfvrpCompatible(makeMission(25), makeDriver(30))).toBe(true)
  })

  it('returns true when mission exactly matches driver capacity', () => {
    expect(isHfvrpCompatible(makeMission(30), makeDriver(30))).toBe(true)
  })

  it('returns false when mission exceeds driver capacity', () => {
    expect(isHfvrpCompatible(makeMission(35), makeDriver(30))).toBe(false)
  })
})

describe('areAllHfvrpCompatible', () => {
  it('returns true for empty mission list', () => {
    expect(areAllHfvrpCompatible([], makeDriver(30))).toBe(true)
  })

  it('returns true when driver has no maxBinSizeM3', () => {
    const missions = [makeMission(40), makeMission(50)]
    expect(areAllHfvrpCompatible(missions, makeDriver())).toBe(true)
  })

  it('returns true when all missions fit', () => {
    const missions = [makeMission(20), makeMission(25), makeMission(30)]
    expect(areAllHfvrpCompatible(missions, makeDriver(30))).toBe(true)
  })

  it('returns false when one mission does not fit', () => {
    const missions = [makeMission(20), makeMission(35), makeMission(25)]
    expect(areAllHfvrpCompatible(missions, makeDriver(30))).toBe(false)
  })

  it('ignores missions without binSizeM3', () => {
    const missions = [makeMission(20), makeMission(), makeMission(25)]
    expect(areAllHfvrpCompatible(missions, makeDriver(30))).toBe(true)
  })
})
