import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeRouteCost, computeSolutionCost, isAllerRetourCompatible, createVrpCostConfig } from '../routeCost'
import type { Route, CostContext } from '../types'
import type { Driver, Mission } from '@/lib/types'

vi.mock('@/lib/algorithm', () => ({
  travelTimeMin: (lat1: number, lng1: number, lat2: number, lng2: number, speed: number) => {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return (dist / speed) * 60
  },
}))

vi.mock('@/lib/familiarityLoader', () => ({
  getFamiliarityBonus: () => 0,
}))

vi.mock('../realDistance', () => ({
  realDurationMin: () => null,
  realDistanceKm: () => null,
}))

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver-1',
    firstName: 'Jean',
    lastName: 'Dupont',
    sector: 'Nord',
    depotName: 'Depot Nord',
    depotLat: 45.9,
    depotLng: 6.1,
    archived: false,
    ...overrides,
  }
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    type: 'POSER',
    date: '2025-06-15',
    address: '1 rue test',
    latitude: 45.91,
    longitude: 6.12,
    estimatedDurationMin: 30,
    maneuverTimeMin: 10,
    ...overrides,
  }
}

function makeCtx(overrides: Partial<CostContext> = {}): CostContext {
  return {
    depotLat: 45.9,
    depotLng: 6.1,
    startTimeMin: 480,
    speedKmh: 40,
    exutoires: [],
    date: '2025-06-15',
    ...overrides,
  }
}

describe('Skill compatibility dans routeCost', () => {
  const drivers = [makeDriver({ skills: ['permis_C', 'CACES', 'ADR'] })]
  const ctx = makeCtx()

  it('pas de pénalité si la mission n\'a pas de requiredSkills', () => {
    const route: Route = { driverId: 'driver-1', missions: [makeMission()] }
    const cost = computeRouteCost(route, ctx, drivers)
    expect(cost).toBeLessThan(10_000)
  })

  it('pas de pénalité si le chauffeur a tous les skills', () => {
    const route: Route = {
      driverId: 'driver-1',
      missions: [makeMission({ requiredSkills: ['permis_C', 'CACES'] })],
    }
    const cost = computeRouteCost(route, ctx, drivers)
    expect(cost).toBeLessThan(10_000)
  })

  it('pénalité significative par skill manquant', () => {
    const noSkillDrivers = [makeDriver({ skills: [] })]
    const route: Route = {
      driverId: 'driver-1',
      missions: [makeMission({ requiredSkills: ['permis_C'] })],
    }
    const costWithSkill = computeRouteCost(route, ctx, drivers)
    const costWithout = computeRouteCost(route, ctx, noSkillDrivers)

    expect(costWithout - costWithSkill).toBeGreaterThanOrEqual(5_000)
  })

  it('pénalité cumulative pour plusieurs skills manquants', () => {
    const noSkillDrivers = [makeDriver({ skills: [] })]
    const route: Route = {
      driverId: 'driver-1',
      missions: [makeMission({ requiredSkills: ['permis_C', 'CACES', 'ADR'] })],
    }
    const costWithout = computeRouteCost(route, ctx, noSkillDrivers)
    const costWith = computeRouteCost(route, ctx, drivers)

    expect(costWithout - costWith).toBeGreaterThanOrEqual(15_000)
  })

  it('pénalité pour skills manquants sur plusieurs missions', () => {
    const noSkillDrivers = [makeDriver({ skills: [] })]
    const route: Route = {
      driverId: 'driver-1',
      missions: [
        makeMission({ requiredSkills: ['permis_C'] }),
        makeMission({ requiredSkills: ['ADR'] }),
      ],
    }
    const costWithout = computeRouteCost(route, ctx, noSkillDrivers)
    const costWith = computeRouteCost(route, ctx, drivers)

    expect(costWithout - costWith).toBeGreaterThanOrEqual(10_000)
  })

  it('chauffeur sans skills défini (undefined) → pénalité appliquée', () => {
    const noSkillProp = [makeDriver({ skills: undefined })]
    const route: Route = {
      driverId: 'driver-1',
      missions: [makeMission({ requiredSkills: ['permis_C'] })],
    }
    const cost = computeRouteCost(route, ctx, noSkillProp)
    expect(cost).toBeGreaterThanOrEqual(5_000)
  })
})

describe('isAllerRetourCompatible', () => {
  it('ALLER_RETOUR peut être ajouté à une route vide', () => {
    expect(isAllerRetourCompatible([], 'ALLER_RETOUR')).toBe(true)
  })

  it('ALLER_RETOUR ne peut pas être ajouté à une route non vide', () => {
    expect(isAllerRetourCompatible([{ type: 'POSER' }], 'ALLER_RETOUR')).toBe(false)
  })

  it('mission normale ne peut pas rejoindre une route avec ALLER_RETOUR', () => {
    expect(isAllerRetourCompatible([{ type: 'ALLER_RETOUR' }], 'POSER')).toBe(false)
  })

  it('mission normale peut rejoindre une route sans ALLER_RETOUR', () => {
    expect(isAllerRetourCompatible([{ type: 'POSER' }], 'RETIRER')).toBe(true)
  })

  it('POSER sur route vide → ok', () => {
    expect(isAllerRetourCompatible([], 'POSER')).toBe(true)
  })
})

describe('createVrpCostConfig', () => {
  it('retourne les défauts sans paramètres', () => {
    const cfg = createVrpCostConfig()
    expect(cfg.overtimePenalty).toBe(30_000)
    expect(cfg.fixedRouteCost).toBe(50)
    expect(cfg.lunchBreakStartMin).toBe(720)
  })

  it('retourne les défauts avec undefined', () => {
    const cfg = createVrpCostConfig(undefined)
    expect(cfg.overtimePenalty).toBe(30_000)
  })

  it('merge partiel override', () => {
    const cfg = createVrpCostConfig({ overtimePenalty: 50_000, fixedRouteCost: 100 })
    expect(cfg.overtimePenalty).toBe(50_000)
    expect(cfg.fixedRouteCost).toBe(100)
    expect(cfg.lunchBreakStartMin).toBe(720)
  })

  it('override de 0 est respecté (pas fallback)', () => {
    const cfg = createVrpCostConfig({ fixedRouteCost: 0 })
    expect(cfg.fixedRouteCost).toBe(0)
  })
})

describe('computeRouteCost', () => {
  const drivers = [makeDriver()]
  const ctx = makeCtx()

  it('retourne 0 pour route vide', () => {
    const cost = computeRouteCost({ driverId: 'driver-1', missions: [] }, ctx, drivers)
    expect(cost).toBe(0)
  })

  it('retourne Infinity pour driver inconnu', () => {
    const cost = computeRouteCost({ driverId: 'inconnu', missions: [makeMission()] }, ctx, drivers)
    expect(cost).toBe(Infinity)
  })

  it('une seule mission → coût fini', () => {
    const cost = computeRouteCost({ driverId: 'driver-1', missions: [makeMission()] }, ctx, drivers)
    expect(cost).toBeLessThan(Infinity)
    expect(cost).toBeGreaterThanOrEqual(0)
  })

  it('plus de missions → coût >= route courte', () => {
    const cost1 = computeRouteCost({
      driverId: 'driver-1',
      missions: [makeMission({ latitude: 46.0, longitude: 6.5 })],
    }, ctx, drivers)
    const cost5 = computeRouteCost({
      driverId: 'driver-1',
      missions: Array.from({ length: 5 }, (_, i) =>
        makeMission({ latitude: 46.0 + i * 0.2, longitude: 6.5 + i * 0.2 })
      ),
    }, ctx, drivers)
    expect(cost5).toBeGreaterThanOrEqual(cost1)
  })

  it('missions très éloignées coûtent plus (distances réelles)', () => {

    const close = [makeMission({ latitude: 45.91, longitude: 6.11 })]
    const far = [makeMission({ latitude: 48.0, longitude: 10.0 })]
    const costClose = computeRouteCost({ driverId: 'driver-1', missions: close }, ctx, drivers)
    const costFar = computeRouteCost({ driverId: 'driver-1', missions: far }, ctx, drivers)
    expect(costFar).toBeGreaterThanOrEqual(costClose)
  })
})

describe('computeSolutionCost', () => {
  const drivers = [
    makeDriver({ id: 'driver-1' }),
    makeDriver({ id: 'driver-2' }),
  ]
  const ctx = makeCtx()

  it('retourne 0 pour aucune route', () => {
    expect(computeSolutionCost([], ctx, drivers)).toBe(0)
  })

  it('routes vides → coût minimal (pas de fixedRouteCost)', () => {
    const routes: Route[] = [
      { driverId: 'driver-1', missions: [] },
      { driverId: 'driver-2', missions: [] },
    ]
    expect(computeSolutionCost(routes, ctx, drivers)).toBe(0)
  })

  it('solution déséquilibrée a une pénalité de balance non nulle', () => {
    const missions = Array.from({ length: 8 }, (_, i) =>
      makeMission({ id: `m-${i}`, latitude: 45.9 + i * 0.05, longitude: 6.1 + i * 0.05 })
    )
    const ctxBal: CostContext = { ...ctx, weights: { distance: 0.5, punctuality: 0.5, balance: 1.0 } }
    const unbalanced: Route[] = [
      { driverId: 'driver-1', missions: missions },
      { driverId: 'driver-2', missions: [] },
    ]
    const ctxNoBalance: CostContext = { ...ctx, weights: { distance: 0.5, punctuality: 0.5, balance: 0 } }
    const costWithBalance = computeSolutionCost(unbalanced, ctxBal, drivers)
    const costNoBalance = computeSolutionCost(unbalanced, ctxNoBalance, drivers)

    expect(costWithBalance).toBeGreaterThanOrEqual(costNoBalance)
  })

  it('inclut le coût fixe par route active', () => {
    const route: Route = { driverId: 'driver-1', missions: [makeMission()] }
    const costDefault = computeSolutionCost([route], ctx, drivers)
    const costNoFixed = computeSolutionCost([route], ctx, drivers, createVrpCostConfig({ fixedRouteCost: 0 }))
    expect(costDefault).toBeGreaterThan(costNoFixed)
  })
})
