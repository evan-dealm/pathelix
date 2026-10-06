import { describe, expect, it } from 'vitest'
import { simulateRouteTrace } from '../routeCost'
import type { CostContext } from '../types'
import type { Driver, Exutoire, Mission } from '@/lib/types'

const kmToLng = (km: number) => km / 111.195
const truck: Driver = { id: 'd', firstName: 'd', lastName: '', sector: 'S', depotName: 'D', depotLat: 0, depotLng: 0, vehicleCapacity: 1 }
const m = (id: string, type: Mission['type'], km: number): Mission => ({ id, type, date: '2026-10-07', address: id, latitude: 0, longitude: kmToLng(km), estimatedDurationMin: 15, maneuverTimeMin: 5 })
const EX: Exutoire = { id: 'ex', name: 'Tri', address: '', lat: 0, lng: kmToLng(4), openingHoursOpen: 0, openingHoursClose: 1439, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15 }
const ctx: CostContext = { depotLat: 0, depotLng: 0, startTimeMin: 420, speedKmh: 50, exutoires: [EX], date: '2026-10-07' }
const noBin = (missions: Mission[]) => simulateRouteTrace({ driverId: 'd', missions }, ctx, [truck])!.violations.filter(v => v.code === 'NO_EMPTY_BIN')

describe('empty bins on a one-bin truck', () => {
  it('a collected bin, once emptied at the outlet, is put down at the next delivery', () => {
    // pose (bin from the depot) → collect → dump → pose the emptied bin
    expect(noBin([m('p1', 'POSER', 3), m('r1', 'RETIRER', 6), m('p2', 'POSER', 8)])).toEqual([])
  })

  it('two deliveries in a row still need a second bin', () => {
    expect(noBin([m('p1', 'POSER', 3), m('p2', 'POSER', 6)]).map(v => v.missionId)).toEqual(['p2'])
  })

  it('never carries more bins than it holds', () => {
    // exchange then collect: two emptied bins, but only one fits — the second delivery has none
    const v = noBin([m('e1', 'ECHANGER', 3), m('r1', 'RETIRER', 5), m('p1', 'POSER', 7), m('p2', 'POSER', 9)])
    expect(v.map(x => x.missionId)).toEqual(['p2'])
  })
})
