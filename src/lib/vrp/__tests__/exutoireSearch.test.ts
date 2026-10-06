import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetExutoireCongestion,
  getCongestionMap,
  recordExutoireVisit,
  findBestExutoire,
} from '@/lib/vrp/exutoireSearch'
import type { Exutoire } from '@/lib/types'

function makeExutoire(overrides: Partial<Exutoire> & { id: string }): Exutoire {
  return {
    name:              'Centre de tri',
    address:           'Annecy',
    lat:               45.8992,
    lng:               6.1294,
    openingHoursOpen:  420,
    openingHoursClose: 1080,
    closedDays:        [],
    acceptedWasteTypes: [],
    serviceTimeMin:    15,
    ...overrides,
  }
}

const MISSION_LAT = 45.8992
const MISSION_LNG = 6.1294

const EXU_NEAR: Exutoire = makeExutoire({ id: 'near', lat: 45.9300, lng: 6.1294 })

const EXU_FAR: Exutoire = makeExutoire({ id: 'far', lat: 45.1885, lng: 5.7245 })

const MON = 1

const SUN = 0

beforeEach(() => {
  resetExutoireCongestion()
})

describe('resetExutoireCongestion', () => {
  it('returns a new empty Map', () => {
    const map = resetExutoireCongestion()
    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(0)
  })

  it('clears previously recorded visits', () => {
    recordExutoireVisit('e1')
    expect(getCongestionMap().get('e1')).toBe(1)
    resetExutoireCongestion()
    expect(getCongestionMap().size).toBe(0)
  })

  it('returns the same reference as getCongestionMap after reset', () => {
    const returned = resetExutoireCongestion()
    const current  = getCongestionMap()
    expect(returned).toBe(current)
  })
})

describe('recordExutoireVisit', () => {
  it('increments counter from 0 to 1 on first call', () => {
    recordExutoireVisit('e1')
    expect(getCongestionMap().get('e1')).toBe(1)
  })

  it('increments counter on subsequent calls', () => {
    recordExutoireVisit('e1')
    recordExutoireVisit('e1')
    expect(getCongestionMap().get('e1')).toBe(2)
  })

  it('tracks multiple exutoires independently', () => {
    recordExutoireVisit('e1')
    recordExutoireVisit('e2')
    recordExutoireVisit('e1')
    expect(getCongestionMap().get('e1')).toBe(2)
    expect(getCongestionMap().get('e2')).toBe(1)
  })

  it('writes to an external congestionMap when passed', () => {
    const external = new Map<string, number>()
    recordExutoireVisit('e1', external)
    expect(external.get('e1')).toBe(1)
    expect(getCongestionMap().has('e1')).toBe(false)
  })

  it('increments correctly in an external congestionMap', () => {
    const external = new Map<string, number>()
    recordExutoireVisit('e1', external)
    recordExutoireVisit('e1', external)
    expect(external.get('e1')).toBe(2)
  })

  it('uses internal map when congestionMap param is undefined', () => {
    recordExutoireVisit('e1', undefined)
    expect(getCongestionMap().get('e1')).toBe(1)
  })
})

describe('getCongestionMap', () => {
  it('returns the current internal map', () => {
    const map = getCongestionMap()
    expect(map).toBeInstanceOf(Map)
  })

  it('reflects visits recorded via recordExutoireVisit', () => {
    recordExutoireVisit('e42')
    expect(getCongestionMap().get('e42')).toBe(1)
  })

  it('is empty after reset', () => {
    recordExutoireVisit('e1')
    resetExutoireCongestion()
    expect(getCongestionMap().size).toBe(0)
  })
})

describe('findBestExutoire', () => {
  it('returns undefined for an empty exutoire array', () => {
    expect(findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [], MON)).toBeUndefined()
  })

  it('returns the only candidate when one exutoire is available', () => {
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR], MON)
    expect(result?.id).toBe('near')
  })

  it('filters out exutoire closed on given day of week', () => {
    const closedMonday = makeExutoire({ id: 'closed', closedDays: [MON] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [closedMonday], MON)
    expect(result).toBeUndefined()
  })

  it('returns undefined when all exutoires are closed on that day', () => {
    const a = makeExutoire({ id: 'a', closedDays: [MON] })
    const b = makeExutoire({ id: 'b', closedDays: [MON] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [a, b], MON)
    expect(result).toBeUndefined()
  })

  it('includes exutoires open on the given day', () => {
    const openMon = makeExutoire({ id: 'open', closedDays: [SUN] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [openMon], MON)
    expect(result?.id).toBe('open')
  })

  it('filters by waste type — rejects incompatible type', () => {
    const woodOnly = makeExutoire({ id: 'wood', acceptedWasteTypes: ['bois'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, 'gravats', [woodOnly], MON)
    expect(result).toBeUndefined()
  })

  it('filters by waste type — accepts matching type (case-insensitive)', () => {
    const gravatsEx = makeExutoire({ id: 'g', acceptedWasteTypes: ['Gravats'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, 'gravats', [gravatsEx], MON)
    expect(result?.id).toBe('g')
  })

  it('filters by waste type — rejects partial match (Q3: exact match only)', () => {

    const ex = makeExutoire({ id: 'ex', acceptedWasteTypes: ['verts'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, 'déchets verts', [ex], MON)
    expect(result).toBeUndefined()
  })

  it('filters by waste type — accepts exact match with different casing', () => {
    const ex = makeExutoire({ id: 'ex', acceptedWasteTypes: ['déchets verts'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, 'Déchets Verts', [ex], MON)
    expect(result?.id).toBe('ex')
  })

  it('ignores waste type filter when wasteTypeLabel is undefined', () => {
    const woodOnly = makeExutoire({ id: 'wood', acceptedWasteTypes: ['bois'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [woodOnly], MON)
    expect(result?.id).toBe('wood')
  })

  it('ignores waste type filter when acceptedWasteTypes is empty', () => {
    const any = makeExutoire({ id: 'any', acceptedWasteTypes: [] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, 'gravats', [any], MON)
    expect(result?.id).toBe('any')
  })

  it('linked exutoire gets bonus but closer one can still win (Q10)', () => {

    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, 'far', undefined, [EXU_NEAR, EXU_FAR], MON)
    expect(result?.id).toBe('near')
  })

  it('ignores linked exutoire when it is filtered out (closed on that day)', () => {
    const closedLinked = makeExutoire({ id: 'linked', closedDays: [MON] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, 'linked', undefined, [EXU_NEAR, closedLinked], MON)
    expect(result?.id).toBe('near')
  })

  it('ignores linked exutoire when it is filtered out by waste type', () => {
    const linkedWoodOnly = makeExutoire({ id: 'linked', acceptedWasteTypes: ['bois'] })
    const gravatsEx      = makeExutoire({ id: 'gravats', acceptedWasteTypes: ['gravats'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, 'linked', 'gravats', [linkedWoodOnly, gravatsEx], MON)
    expect(result?.id).toBe('gravats')
  })

  it('records a visit on the chosen exutoire (internal map)', () => {
    findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR], MON)
    expect(getCongestionMap().get('near')).toBe(1)
  })

  it('records a visit on the best-scored exutoire (Q10: linked is scored not forced)', () => {
    findBestExutoire(MISSION_LAT, MISSION_LNG, 'far', undefined, [EXU_NEAR, EXU_FAR], MON)

    expect(getCongestionMap().get('near')).toBe(1)
  })

  it('accumulates multiple visits for the same exutoire', () => {
    findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR], MON)
    findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR], MON)
    expect(getCongestionMap().get('near')).toBe(2)
  })

  it('filters by currentMin: excludes exutoire that would be reached after close + 30 min', () => {

    const tightClose = makeExutoire({
      id: 'tight',
      lat: 45.1885, lng: 5.7245,
      openingHoursClose: 600,
    })

    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [tightClose], MON, 540)
    expect(result).toBeUndefined()
  })

  it('does NOT filter by currentMin when arrival is within close + 30 min', () => {
    const wideOpen = makeExutoire({
      id: 'wide',
      openingHoursClose: 1200,
    })

    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [wideOpen], MON, 480)
    expect(result?.id).toBe('wide')
  })

  it('picks the closer exutoire when all other criteria are equal', () => {

    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR, EXU_FAR], MON)
    expect(result?.id).toBe('near')
  })

  it('uses a custom congestionMap passed as parameter (does not pollute internal map)', () => {
    const custom = new Map<string, number>()
    findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR], MON, undefined, custom)
    expect(custom.get('near')).toBe(1)
    expect(getCongestionMap().has('near')).toBe(false)
  })

  it('reads congestion from custom map when scoring candidates', () => {

    const custom = new Map<string, number>([['near', 10000]])

    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [EXU_NEAR, EXU_FAR], MON, undefined, custom)
    expect(result).toBeDefined()
  })

  it('returns undefined when all exutoires fail waste type filter', () => {
    const a = makeExutoire({ id: 'a', acceptedWasteTypes: ['bois'] })
    const b = makeExutoire({ id: 'b', acceptedWasteTypes: ['bois'] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, 'gravats', [a, b], MON)
    expect(result).toBeUndefined()
  })

  it('does not record a visit when no candidate is found', () => {
    findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [], MON)
    expect(getCongestionMap().size).toBe(0)
  })

  it('returns a defined result when all exutoires are open on a given Sunday', () => {
    const openSun = makeExutoire({ id: 'open-sun', closedDays: [MON] })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [openSun], SUN)
    expect(result?.id).toBe('open-sun')
  })

  it('handles a single exutoire with a serviceTimeMin of 0', () => {
    const ex = makeExutoire({ id: 'zero-svc', serviceTimeMin: 0 })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, undefined, undefined, [ex], MON)
    expect(result?.id).toBe('zero-svc')
  })

  it('linked exutoire bonus not enough to beat a much closer one (Q10)', () => {

    const farLinked = makeExutoire({ id: 'far-linked', lat: 43.2965, lng: 5.3698 })
    const near      = EXU_NEAR
    const result    = findBestExutoire(MISSION_LAT, MISSION_LNG, 'far-linked', undefined, [near, farLinked], MON)
    expect(result?.id).toBe('near')
  })

  it('linked exutoire wins when candidates are equidistant (Q10 bonus tips the scale)', () => {

    const a = makeExutoire({ id: 'a', lat: 45.9300, lng: 6.1294 })
    const b = makeExutoire({ id: 'b', lat: 45.9200, lng: 6.1294 })
    const result = findBestExutoire(MISSION_LAT, MISSION_LNG, 'b', undefined, [a, b], MON)
    expect(result?.id).toBe('b')
  })
})
