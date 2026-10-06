import { describe, expect, it } from 'vitest'
import { explainAssignment } from '../explain'
import type { CostContext } from '../types'
import type { Driver, Exutoire, Mission } from '@/lib/types'

const kmToLng = (km: number) => km / 111.195
const truck = (id: string, depotKm: number, over: Partial<Driver> = {}): Driver =>
  ({ id, firstName: id, lastName: '', sector: 'S', depotName: 'D', depotLat: 0, depotLng: kmToLng(depotKm), vehicleCapacity: 2, ...over })
const pose = (id: string, km: number, over: Partial<Mission> = {}): Mission =>
  ({ id, type: 'POSER', date: '2026-10-07', address: id, latitude: 0, longitude: kmToLng(km), estimatedDurationMin: 15, maneuverTimeMin: 5, binSizeM3: 15, ...over })
const EX: Exutoire = { id: 'ex', name: 'Tri', address: '', lat: 0, lng: kmToLng(5), openingHoursOpen: 0, openingHoursClose: 1439, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15 }
const ctx: CostContext = { depotLat: 0, depotLng: 0, startTimeMin: 420, speedKmh: 50, exutoires: [EX], date: '2026-10-07' }

describe('explainAssignment', () => {
  const drivers = [truck('near', 0), truck('far', 60), truck('small', 2, { maxBinSizeM3: 10 })]
  const routes = [
    { driverId: 'near', missions: [pose('a', 3), pose('b', 6)] },
    { driverId: 'far', missions: [pose('c', 58)] },
    { driverId: 'small', missions: [] },
  ]

  it('shows what the mission costs where it is and in every other route, cheapest first', () => {
    const alts = explainAssignment('b', drivers, routes, ctx)
    expect(alts[0]).toMatchObject({ driverId: 'near', chosen: true, feasible: true })
    const far = alts.find(a => a.driverId === 'far')!
    expect(far.feasible).toBe(true)
    expect(far.extraKm!).toBeGreaterThan(alts[0].extraKm!)
    expect(far.extraMin!).toBeGreaterThan(alts[0].extraMin!)
  })

  it('says why a truck cannot take it', () => {
    const small = explainAssignment('b', drivers, routes, ctx).find(a => a.driverId === 'small')!
    expect(small).toMatchObject({ feasible: false, extraKm: null })
    expect(small.reason).toMatch(/benne|m³/i)
  })

  it('returns nothing for a mission that is not planned', () => {
    expect(explainAssignment('zzz', drivers, routes, ctx)).toEqual([])
  })
})
