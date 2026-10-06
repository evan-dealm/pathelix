import { describe, expect, it } from 'vitest'
import { allocateTour, groupProfits, missionProfits, type MissionMeta, type TourInput } from '../profitability'

const RATES = { driverHourlyCostEur: 30, wearPerKm: 0.2, fuelPerKm: 0.5 }
const TOUR: TourInput = {
  date: '2026-10-05', driverId: 'd1', vehicleId: 'v1',
  steps: [
    { missionId: 'a', kind: 'MISSION', travelMin: 20, onSiteMin: 20, km: 15 },
    { missionId: 'a', kind: 'DUMP', travelMin: 15, onSiteMin: 15, km: 10 }, // dump of a's bin
    { missionId: null, kind: 'BREAK', travelMin: 0, onSiteMin: 45, km: 0 },
    { missionId: 'b', kind: 'MISSION', travelMin: 30, onSiteMin: 20, km: 25 },
  ],
  returnMin: 30, returnKm: 20,
}

describe('allocateTour', () => {
  it('gives each mission its own drive and site time, dumps included, and shares the rest', () => {
    const [a, b] = allocateTour(TOUR, RATES)
    // own: a = 70 min / 25 km, b = 50 min / 25 km; shared: 75 min (break + return), 20 km.
    expect(a).toMatchObject({ missionId: 'a', minutes: Math.round(70 + 75 * 70 / 120), km: 35 })
    expect(b).toMatchObject({ missionId: 'b', minutes: Math.round(50 + 75 * 50 / 120), km: 35 })
    expect(a.minutes + b.minutes).toBe(195) // the whole tour is paid for
    expect(a.labourCost).toBeCloseTo((70 + 75 * 70 / 120) / 60 * 30, 1)
    expect(a.distanceCost).toBeCloseTo(35 * 0.7, 2)
  })

  it('scales to the measured kilometres and duration when the tour has them', () => {
    const [a, b] = allocateTour({ ...TOUR, actualKm: 140, actualMin: 390 }, RATES)
    expect(a.km + b.km).toBeCloseTo(140, 0)
    expect(a.minutes + b.minutes).toBeCloseTo(390, -1)
  })

  it('leaves labour out when the hourly cost is unknown', () => {
    expect(allocateTour(TOUR, { ...RATES, driverHourlyCostEur: null }).every(x => x.labourCost === 0)).toBe(true)
  })
})

describe('missionProfits and groupProfits', () => {
  const meta = new Map<string, MissionMeta>([
    ['a', { id: 'a', date: '2026-10-05', type: 'RETIRER', clientId: 'c1', clientName: 'Dupont' }],
    ['b', { id: 'b', date: '2026-10-05', type: 'POSER', clientId: 'c2', clientName: 'Martin' }],
  ])
  const rows = missionProfits([TOUR], RATES, meta, new Map([['a', 300]]), new Map([['a', 120]]))

  it('adds revenue and outlet fees per mission and flags what is not invoiced', () => {
    const a = rows.find(r => r.missionId === 'a')!
    const b = rows.find(r => r.missionId === 'b')!
    expect(a.dumpCost).toBe(120)
    expect(a.cost).toBeCloseTo(a.labourCost + a.distanceCost + 120, 2)
    expect(a.margin).toBeCloseTo(300 - a.cost, 2)
    expect(a.invoiced).toBe(true)
    expect(b).toMatchObject({ revenueHT: 0, invoiced: false })
  })

  it('groups by customer, worst margin first, with the margin of invoiced work apart', () => {
    const g = groupProfits(rows, 'client')
    expect(g.map(x => x.key)).toEqual(['c2', 'c1'])
    expect(g[0]).toMatchObject({ missions: 1, invoicedMissions: 0, invoicedMargin: 0, marginPct: null })
    expect(g[1].marginPct).toBeCloseTo(g[1].margin / 300 * 100, 0)
  })
})
