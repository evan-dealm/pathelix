import { describe, it, expect } from 'vitest'
import type { Mission, Driver, Exutoire } from '@/lib/types'

function makeDriver(id: string, lat: number, lng: number): Driver {
  return {
    id,
    firstName: 'D', lastName: id,
    sector:    'Test',
    depotName: 'Depot',
    depotLat:  lat,
    depotLng:  lng,
    vehicleCapacity: 5,
    maxBinSizeM3:    10,
  }
}

function makeMission(id: string, lat: number, lng: number, dur = 30, priority?: 1 | 2 | 3): Mission {
  return {
    id,
    type:                 'RETIRER',
    date:                 '2026-05-01',
    address:              `${lat},${lng}`,
    latitude:             lat,
    longitude:            lng,
    estimatedDurationMin: dur,
    maneuverTimeMin:      5,
    priority,
  }
}

function makeExutoire(id: string, lat: number, lng: number): Exutoire {
  return {
    id,
    name:              'Exutoire',
    address:           `${lat},${lng}`,
    lat,
    lng,
    openingHoursOpen:  360,
    openingHoursClose: 1200,
    closedDays:        [],
    acceptedWasteTypes: [],
    serviceTimeMin:    15,
  }
}

const SMALL_INSTANCE = {
  drivers: [
    makeDriver('d1', 45.75, 4.85),
    makeDriver('d2', 45.73, 4.83),
  ],
  missions: [
    makeMission('m1', 45.76, 4.87, 25, 1),
    makeMission('m2', 45.74, 4.84, 30),
    makeMission('m3', 45.77, 4.86, 20),
    makeMission('m4', 45.72, 4.82, 35),
    makeMission('m5', 45.75, 4.88, 25),
    makeMission('m6', 45.73, 4.85, 30),
    makeMission('m7', 45.76, 4.83, 20),
    makeMission('m8', 45.74, 4.86, 40),
    makeMission('m9', 45.77, 4.84, 25),
    makeMission('m10', 45.72, 4.87, 30),
  ],
  exutoires: [makeExutoire('e1', 45.76, 4.89)],
}

const P1_INSTANCE = {
  drivers:   [makeDriver('d1', 45.75, 4.85)],
  missions:  [
    makeMission('p1a', 45.76, 4.87, 20, 1),
    makeMission('p1b', 45.74, 4.84, 30, 2),
    makeMission('p1c', 45.75, 4.86, 25, 3),
    makeMission('p1d', 45.73, 4.83, 35, 2),
  ],
  exutoires: [makeExutoire('e1', 45.78, 4.90)],
}

function makeSolomonR101(n: number, driverCount: number) {

  const missions: Mission[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 10)
    const col = i % 10
    missions.push(makeMission(`m${i}`, 45.70 + row * 0.01, 4.80 + col * 0.01, 20 + (i % 3) * 10))
  }
  const drivers: Driver[] = []
  for (let d = 0; d < driverCount; d++) {
    drivers.push(makeDriver(`d${d}`, 45.75, 4.85))
  }
  return { missions, drivers, exutoires: [makeExutoire('e1', 45.76, 4.90)] }
}

describe('VRP runVRP — small instance', () => {
  it('assigns all missions', async () => {
    const { runVRP } = await import('@/lib/vrp/index')
    const { drivers, missions, exutoires } = SMALL_INSTANCE

    const result = await runVRP(missions, drivers, exutoires, '2026-05-01', {
      timeBudgetMs:    2000,
      seed:            42,
      defaultSpeedKmh: 50,
      defaultStartTime: '07:00',
      valhallaFactor:  1.0,
      tenantId:        'test',
    })

    const totalAssigned = Object.values(result.assignments)
      .flatMap(v => v)
      .filter(m => !m.isSynthetic)
      .length

    expect(totalAssigned + result.unassignedMissions.length).toBe(missions.length)
    expect(result.unassignedMissions.length).toBeLessThanOrEqual(2)
    expect(result.stats.score).toBeGreaterThan(0)
  }, 15_000)

  it('P1 missions are assigned first', async () => {
    const { runVRP } = await import('@/lib/vrp/index')
    const { drivers, missions, exutoires } = P1_INSTANCE

    const result = await runVRP(missions, drivers, exutoires, '2026-05-01', {
      timeBudgetMs:    1000,
      seed:            42,
      defaultSpeedKmh: 50,
      defaultStartTime: '07:00',
      valhallaFactor:  1.0,
      tenantId:        'test',
    })

    const driverPlan = Object.values(result.assignments)[0] ?? []
    const p1Idx = driverPlan.findIndex(m => m.id === 'p1a')

    expect(p1Idx).toBeLessThanOrEqual(1)
  }, 10_000)
})

describe('VRP runVRP — Solomon R101 (50 missions, 5 drivers)', () => {
  it('produces feasible solution within time budget', async () => {
    const { runVRP } = await import('@/lib/vrp/index')
    const { missions, drivers, exutoires } = makeSolomonR101(50, 5)

    const t0 = Date.now()
    const result = await runVRP(missions, drivers, exutoires, '2026-05-01', {
      timeBudgetMs:    5000,
      seed:            42,
      defaultSpeedKmh: 50,
      defaultStartTime: '07:00',
      valhallaFactor:  1.0,
      tenantId:        'test',
    })
    const elapsed = Date.now() - t0

    expect(elapsed).toBeLessThan(5000 * 1.4)

    const assigned = Object.values(result.assignments).flatMap(v => v).filter(m => !m.isSynthetic).length

    expect(assigned).toBeGreaterThanOrEqual(Math.floor(missions.length * 0.8))

    if (result.stats.objectives?.workloadCV !== undefined) {
      expect(result.stats.objectives.workloadCV).toBeLessThan(0.6)
    }
  }, 20_000)
})

describe('VRP sector balancing', () => {
  it('rebalanceSectors reduces workload variance', async () => {
    const { buildSectors, rebalanceSectors } = await import('@/lib/vrp/sector')
    const { missions, drivers } = makeSolomonR101(40, 4)

    const sectors = buildSectors(drivers, missions, 2)
    const initialLoads = sectors.map(s =>
      s.missions.reduce((a, m) => a + m.estimatedDurationMin, 0) / Math.max(1, s.drivers.length),
    )
    const initialVariance = Math.max(...initialLoads) - Math.min(...initialLoads)

    rebalanceSectors(sectors, 10)

    const finalLoads = sectors.map(s =>
      s.missions.reduce((a, m) => a + m.estimatedDurationMin, 0) / Math.max(1, s.drivers.length),
    )
    const finalVariance = Math.max(...finalLoads) - Math.min(...finalLoads)

    expect(finalVariance).toBeLessThanOrEqual(initialVariance * 1.05)
  })
})

describe('VRP routeCost multi-dim capacity', () => {
  it('effectiveCapacity uses capacityDimensions.nbBennes when set', async () => {
    const driverWithDims: Driver = {
      ...makeDriver('dx', 45.75, 4.85),
      vehicleCapacity:    3,
      capacityDimensions: { nbBennes: 7 },
    }

    const { runVRP } = await import('@/lib/vrp/index')
    const missions = Array.from({ length: 6 }, (_, i) =>
      makeMission(`m${i}`, 45.75 + i * 0.01, 4.85 + i * 0.01, 20),
    )
    const result = await runVRP(missions, [driverWithDims], [makeExutoire('e1', 45.80, 4.90)], '2026-05-01', {
      timeBudgetMs: 500, seed: 42, defaultSpeedKmh: 50, defaultStartTime: '07:00',
      valhallaFactor: 1.0, tenantId: 'test',
    })

    const plan = Object.values(result.assignments)[0] ?? []
    const nonSynthetic = plan.filter(m => !m.isSynthetic)
    expect(nonSynthetic.length).toBe(6)
  }, 10_000)
})
