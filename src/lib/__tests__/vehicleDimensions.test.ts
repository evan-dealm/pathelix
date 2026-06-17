import { describe, it, expect } from 'vitest'
import { prismaRowToDriver } from '../prismaMappers'
import type { Driver, VehicleDimensions } from '../types'

describe('prismaRowToDriver — vehicleDimensions', () => {
  const baseRow = {
    id: 'drv-1',
    firstName: 'Jean',
    lastName: 'Dupont',
    sector: 'Nord',
    depotName: 'Depot',
    depotLat: 45.9,
    depotLng: 6.1,
    maxBinSizeM3: null,
    vehicleCapacity: null,
    archived: false,
    skills: null,
    weeklyHoursMax: null,
    phone: null,
    notes: null,
  }

  it('retourne undefined si pas de véhicule assigné', () => {
    const driver = prismaRowToDriver({ ...baseRow, vehicles: undefined })
    expect(driver.vehicleDimensions).toBeUndefined()
  })

  it('retourne undefined si vehicles est un tableau vide', () => {
    const driver = prismaRowToDriver({ ...baseRow, vehicles: [] })
    expect(driver.vehicleDimensions).toBeUndefined()
  })

  it('extrait les dimensions du premier véhicule', () => {
    const driver = prismaRowToDriver({
      ...baseRow,
      vehicles: [{
        weightTon: 19,
        heightM: 3.5,
        widthM: 2.55,
        lengthM: 10.0,
        axleCount: 2,
        hazmat: false,
      }],
    })
    expect(driver.vehicleDimensions).toEqual({
      weightTon: 19,
      heightM: 3.5,
      widthM: 2.55,
      lengthM: 10.0,
      axleCount: 2,
      hazmat: false,
    })
  })

  it('utilise des défauts si les champs sont null', () => {
    const driver = prismaRowToDriver({
      ...baseRow,
      vehicles: [{
        weightTon: null,
        heightM: null,
        widthM: null,
        lengthM: null,
        axleCount: null,
        hazmat: null,
      }],
    })
    expect(driver.vehicleDimensions).toEqual({
      weightTon: 26,
      heightM: 4.0,
      widthM: 2.55,
      lengthM: 12.0,
      axleCount: 3,
      hazmat: false,
    })
  })

  it('ignore le deuxième véhicule si plusieurs', () => {
    const driver = prismaRowToDriver({
      ...baseRow,
      vehicles: [
        { weightTon: 7.5, heightM: 3.0, widthM: 2.4, lengthM: 7.5, axleCount: 2, hazmat: false },
        { weightTon: 44, heightM: 4.0, widthM: 2.55, lengthM: 18.75, axleCount: 5, hazmat: true },
      ],
    })
    expect(driver.vehicleDimensions!.weightTon).toBe(7.5)
  })

  it('hazmat true est bien préservé', () => {
    const driver = prismaRowToDriver({
      ...baseRow,
      vehicles: [{ weightTon: 26, heightM: 4.0, widthM: 2.55, lengthM: 12, axleCount: 3, hazmat: true }],
    })
    expect(driver.vehicleDimensions!.hazmat).toBe(true)
  })
})

function computeWorstCaseDims(drivers: Driver[]): VehicleDimensions {
  return {
    weightTon: Math.max(...drivers.map(d => d.vehicleDimensions?.weightTon ?? 26)),
    heightM:   Math.max(...drivers.map(d => d.vehicleDimensions?.heightM ?? 4.0)),
    widthM:    Math.max(...drivers.map(d => d.vehicleDimensions?.widthM ?? 2.55)),
    lengthM:   Math.max(...drivers.map(d => d.vehicleDimensions?.lengthM ?? 12.0)),
    axleCount: Math.max(...drivers.map(d => d.vehicleDimensions?.axleCount ?? 3)),
    hazmat:    drivers.some(d => d.vehicleDimensions?.hazmat === true),
  }
}

describe('Worst-case dimensions', () => {
  const makeDriverWithDims = (dims: Partial<VehicleDimensions>): Driver => ({
    id: `drv-${Math.random().toString(36).slice(2, 6)}`,
    firstName: 'Test',
    lastName: 'Driver',
    sector: 'Test',
    depotName: 'Depot',
    depotLat: 45.9,
    depotLng: 6.1,
    archived: false,
    vehicleDimensions: {
      weightTon: dims.weightTon ?? 26,
      heightM: dims.heightM ?? 4.0,
      widthM: dims.widthM ?? 2.55,
      lengthM: dims.lengthM ?? 12.0,
      axleCount: dims.axleCount ?? 3,
      hazmat: dims.hazmat ?? false,
    },
  })

  it('prend le max de chaque dimension', () => {
    const drivers = [
      makeDriverWithDims({ weightTon: 19, heightM: 3.5, lengthM: 10 }),
      makeDriverWithDims({ weightTon: 26, heightM: 4.0, lengthM: 12 }),
      makeDriverWithDims({ weightTon: 32, heightM: 4.0, lengthM: 16.5 }),
    ]
    const worst = computeWorstCaseDims(drivers)
    expect(worst.weightTon).toBe(32)
    expect(worst.heightM).toBe(4.0)
    expect(worst.lengthM).toBe(16.5)
  })

  it('hazmat true si au moins un chauffeur ADR', () => {
    const drivers = [
      makeDriverWithDims({ hazmat: false }),
      makeDriverWithDims({ hazmat: true }),
      makeDriverWithDims({ hazmat: false }),
    ]
    expect(computeWorstCaseDims(drivers).hazmat).toBe(true)
  })

  it('hazmat false si aucun chauffeur ADR', () => {
    const drivers = [
      makeDriverWithDims({ hazmat: false }),
      makeDriverWithDims({ hazmat: false }),
    ]
    expect(computeWorstCaseDims(drivers).hazmat).toBe(false)
  })

  it('utilise les défauts si dimensions absentes', () => {
    const drivers: Driver[] = [{
      id: 'drv-no-dims',
      firstName: 'Test',
      lastName: 'NoDims',
      sector: 'Test',
      depotName: 'Depot',
      depotLat: 45.9,
      depotLng: 6.1,
      archived: false,

    }]
    const worst = computeWorstCaseDims(drivers)
    expect(worst.weightTon).toBe(26)
    expect(worst.heightM).toBe(4.0)
    expect(worst.widthM).toBe(2.55)
    expect(worst.lengthM).toBe(12.0)
    expect(worst.axleCount).toBe(3)
    expect(worst.hazmat).toBe(false)
  })

  it('mix de drivers avec et sans dimensions', () => {
    const drivers: Driver[] = [
      makeDriverWithDims({ weightTon: 44, lengthM: 18.75 }),
      {
        id: 'drv-no-dims',
        firstName: 'Test',
        lastName: 'NoDims',
        sector: 'Test',
        depotName: 'Depot',
        depotLat: 45.9,
        depotLng: 6.1,
        archived: false,
      },
    ]
    const worst = computeWorstCaseDims(drivers)
    expect(worst.weightTon).toBe(44)
    expect(worst.lengthM).toBe(18.75)
  })

  it('un seul chauffeur → ses propres dimensions', () => {
    const drivers = [makeDriverWithDims({ weightTon: 7.5, heightM: 3.0, axleCount: 2 })]
    const worst = computeWorstCaseDims(drivers)
    expect(worst.weightTon).toBe(7.5)
    expect(worst.heightM).toBe(3.0)
    expect(worst.axleCount).toBe(2)
  })
})

function buildCostingOptions(dims: VehicleDimensions) {
  return {
    truck: {
      weight:     dims.weightTon,
      height:     dims.heightM,
      width:      dims.widthM,
      length:     dims.lengthM,
      axle_count: dims.axleCount,
      hazmat:     dims.hazmat,
      use_highways: 0.8,
      use_tolls:    0.5,
    },
  }
}

describe('buildCostingOptions', () => {
  it('mappe correctement les dimensions vers l\'API Valhalla', () => {
    const dims: VehicleDimensions = {
      weightTon: 26, heightM: 4.0, widthM: 2.55, lengthM: 12.0, axleCount: 3, hazmat: false,
    }
    const opts = buildCostingOptions(dims)
    expect(opts.truck.weight).toBe(26)
    expect(opts.truck.height).toBe(4.0)
    expect(opts.truck.width).toBe(2.55)
    expect(opts.truck.length).toBe(12.0)
    expect(opts.truck.axle_count).toBe(3)
    expect(opts.truck.hazmat).toBe(false)
  })

  it('inclut les paramètres d\'optimisation routière', () => {
    const dims: VehicleDimensions = {
      weightTon: 3.5, heightM: 2.5, widthM: 2.0, lengthM: 6.0, axleCount: 2, hazmat: false,
    }
    const opts = buildCostingOptions(dims)
    expect(opts.truck.use_highways).toBe(0.8)
    expect(opts.truck.use_tolls).toBe(0.5)
  })

  it('hazmat true est transmis', () => {
    const dims: VehicleDimensions = {
      weightTon: 26, heightM: 4.0, widthM: 2.55, lengthM: 12.0, axleCount: 3, hazmat: true,
    }
    const opts = buildCostingOptions(dims)
    expect(opts.truck.hazmat).toBe(true)
  })

  it('VL utilitaire 3.5t → profil léger', () => {
    const dims: VehicleDimensions = {
      weightTon: 3.5, heightM: 2.5, widthM: 2.0, lengthM: 6.0, axleCount: 2, hazmat: false,
    }
    const opts = buildCostingOptions(dims)
    expect(opts.truck.weight).toBe(3.5)
    expect(opts.truck.axle_count).toBe(2)
  })

  it('PL 44t grand routier → profil lourd', () => {
    const dims: VehicleDimensions = {
      weightTon: 44, heightM: 4.0, widthM: 2.55, lengthM: 18.75, axleCount: 5, hazmat: false,
    }
    const opts = buildCostingOptions(dims)
    expect(opts.truck.weight).toBe(44)
    expect(opts.truck.length).toBe(18.75)
    expect(opts.truck.axle_count).toBe(5)
  })
})
