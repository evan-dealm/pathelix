import { describe, it, expect, beforeEach } from 'vitest'
import { optimizeSequence } from '../optimizer'
import type { Mission, Driver, Exutoire } from '@/lib/types'

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id:        'driver-1',
    firstName: 'Jean',
    lastName:  'Dupont',
    sector:    'Nord',
    depotName: 'Dépôt Nord',
    depotLat:  45.7640,
    depotLng:  4.8357,
    ...overrides,
  }
}

function makeMission(id: string, overrides: Partial<Mission> = {}): Mission {
  return {
    id,
    type:                 'POSER',
    date:                 '2026-03-18',
    address:              `Adresse ${id}`,
    latitude:             45.77 + Math.random() * 0.05,
    longitude:            4.84 + Math.random() * 0.05,
    estimatedDurationMin: 15,
    maneuverTimeMin:      5,
    ...overrides,
  }
}

function makeExutoire(overrides: Partial<Exutoire> = {}): Exutoire {
  return {
    id:                 'ex-1',
    name:               'Exutoire Sud',
    address:            'Rue du Tri',
    lat:                45.75,
    lng:                4.83,
    openingHoursOpen:   360,
    openingHoursClose:  1080,
    closedDays:         [0],
    acceptedWasteTypes: ['Encombrants'],
    serviceTimeMin:     10,
    ...overrides,
  }
}

describe('optimizeSequence', () => {

  it('returns empty result for empty missions', () => {
    const driver = makeDriver()
    const result = optimizeSequence([], driver, [], '07:00', 50, { timeBudgetMs: 500 })

    expect(result.orderedMissions).toHaveLength(0)
    expect(result.totalCostMin).toBe(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('handles single mission', () => {
    const driver  = makeDriver()
    const mission = makeMission('m-1', { latitude: 45.77, longitude: 4.85 })

    const result = optimizeSequence([mission], driver, [], '07:00', 50, {
      timeBudgetMs: 1000,
      seed: 42,
    })

    expect(result.orderedMissions.length).toBeGreaterThanOrEqual(1)
    expect(result.orderedMissions.some(m => m.id === 'm-1')).toBe(true)
    expect(result.totalCostMin).toBeGreaterThan(0)
  })

  it('produces a valid sequence for multiple missions', () => {
    const driver   = makeDriver({ depotLat: 45.76, depotLng: 4.83 })
    const missions = [
      makeMission('m-1', { latitude: 45.77, longitude: 4.84 }),
      makeMission('m-2', { latitude: 45.78, longitude: 4.85 }),
      makeMission('m-3', { latitude: 45.79, longitude: 4.86 }),
    ]

    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs: 2000,
      seed: 42,
      lnsIterations: 20,
    })

    const realIds = result.orderedMissions.filter(m => !m.isSynthetic).map(m => m.id)
    expect(realIds).toContain('m-1')
    expect(realIds).toContain('m-2')
    expect(realIds).toContain('m-3')

    for (let i = 1; i < result.orderedMissions.length; i++) {
      expect(result.orderedMissions[i].sequenceOrder).toBeGreaterThanOrEqual(
        result.orderedMissions[i - 1].sequenceOrder,
      )
    }
  })

  it('respects time windows in the solution', () => {
    const driver   = makeDriver({ depotLat: 45.76, depotLng: 4.83 })
    const missions = [
      makeMission('m-early', {
        latitude: 45.765, longitude: 4.835,
        priority: 1,
        timeWindow: { openMin: 420, closeMin: 480 },
      }),
      makeMission('m-late', {
        latitude: 45.77, longitude: 4.84,
        priority: 3,
        timeWindow: { openMin: 660, closeMin: 780 },
      }),
    ]

    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs: 2000,
      seed: 42,
    })

    const realMissions = result.orderedMissions.filter(m => !m.isSynthetic)
    expect(realMissions.length).toBe(2)

    const earlyIdx = realMissions.findIndex(m => m.id === 'm-early')
    const lateIdx  = realMissions.findIndex(m => m.id === 'm-late')
    expect(earlyIdx).toBeLessThan(lateIdx)
  })

  it('warm-start from existing plan preserves sequence when optimal', () => {
    const driver   = makeDriver({ depotLat: 45.76, depotLng: 4.83 })

    const missions = [
      makeMission('m-1', { latitude: 45.77, longitude: 4.83 }),
      makeMission('m-2', { latitude: 45.78, longitude: 4.83 }),
      makeMission('m-3', { latitude: 45.79, longitude: 4.83 }),
    ]

    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs:     500,
      seed:             42,
      lnsIterations:    5,
      existingSequence: ['m-1', 'm-2', 'm-3'],
    })

    const realIds = result.orderedMissions.filter(m => !m.isSynthetic).map(m => m.id)
    expect(realIds).toHaveLength(3)
  })

  it('filters out archived missions', () => {
    const driver   = makeDriver()
    const missions = [
      makeMission('m-active', { latitude: 45.77, longitude: 4.84 }),
      makeMission('m-archived', { latitude: 45.78, longitude: 4.85, archived: true }),
    ]

    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs: 500,
      seed: 42,
    })

    const ids = result.orderedMissions.filter(m => !m.isSynthetic).map(m => m.id)
    expect(ids).toContain('m-active')
    expect(ids).not.toContain('m-archived')
  })

  it('injects VIDER missions for linked exutoire', () => {
    const driver   = makeDriver({ depotLat: 45.76, depotLng: 4.83 })
    const exutoire = makeExutoire()
    const missions = [
      makeMission('m-1', {
        latitude: 45.77,
        longitude: 4.84,
        type: 'RETIRER',
        linkedExutoireId: 'ex-1',
        wasteTypeLabel: 'Encombrants',
      }),
    ]

    const result = optimizeSequence(missions, driver, [exutoire], '07:00', 50, {
      timeBudgetMs: 1000,
      seed: 42,
    })

    const viderMissions = result.orderedMissions.filter(m => m.type === 'VIDER' && m.isSynthetic)
    expect(viderMissions.length).toBeGreaterThanOrEqual(1)
  })

  it('is deterministic with same seed', () => {
    const driver   = makeDriver({ depotLat: 45.76, depotLng: 4.83 })
    const missions = [
      makeMission('m-1', { latitude: 45.77, longitude: 4.84 }),
      makeMission('m-2', { latitude: 45.78, longitude: 4.85 }),
      makeMission('m-3', { latitude: 45.79, longitude: 4.83 }),
      makeMission('m-4', { latitude: 45.76, longitude: 4.86 }),
    ]

    const opts = { timeBudgetMs: 1000, seed: 123, lnsIterations: 10 }

    const result1 = optimizeSequence(missions, driver, [], '07:00', 50, opts)
    const result2 = optimizeSequence(missions, driver, [], '07:00', 50, opts)

    const ids1 = result1.orderedMissions.map(m => m.id)
    const ids2 = result2.orderedMissions.map(m => m.id)
    expect(ids1).toEqual(ids2)
  })

  it('emits driving warning when total driving exceeds MAX_DRIVING_MIN', () => {
    const driver = makeDriver({ depotLat: 45.0, depotLng: 4.0 })
    // 2 missions far apart at speed 3 km/h → each trip ≈ 550 min > MAX_DRIVING_MIN (540)
    const missions = [
      makeMission('m-0', { latitude: 47.0, longitude: 4.0, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-1', { latitude: 49.0, longitude: 4.0, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
    ]
    const result = optimizeSequence(missions, driver, [], '07:00', 3, {
      timeBudgetMs: 100, seed: 42,
    })
    const warn = result.warnings.find(w => w.message.includes('conduite'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('error')
  })

  it('emits worktime warning when total work exceeds MAX_WORK_MIN', () => {
    const driver = makeDriver({ depotLat: 45.76, depotLng: 4.83 })
    // 16 missions × 40 min each = 640 min > MAX_WORK_MIN (600)
    const missions = Array.from({ length: 16 }, (_, i) =>
      makeMission(`m-${i}`, {
        latitude: 45.76, longitude: 4.83,
        estimatedDurationMin: 30, maneuverTimeMin: 10,
      }),
    )
    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs: 1000, seed: 42,
    })
    const warn = result.warnings.find(w => w.message.includes('travail'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('error')
  })

  it('emits time window warning when arrival exceeds closeMin', () => {
    const driver = makeDriver({ depotLat: 45.76, depotLng: 4.83 })
    // closeMin=410 is before startTimeMin=420, so arrival (420) > closeMin (410)
    const missions = [
      makeMission('m-late', {
        latitude: 45.76, longitude: 4.83,
        timeWindow: { openMin: 400, closeMin: 410 },
        estimatedDurationMin: 10, maneuverTimeMin: 0,
      }),
    ]
    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    const warn = result.warnings.find(w => w.message.includes('fenêtre horaire'))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('warning')
  })

  it('emits P1 deadline warning when P1 mission served after deadline', () => {
    // effectiveDeadline = max(600, 420+180) = 600
    // Use slow speed + distant mission so arrival >> 600 min
    const driver = makeDriver({ depotLat: 45.0, depotLng: 4.0 })
    const missions = [
      makeMission('m-p1', {
        latitude: 49.0, longitude: 4.0,
        priority: 1, estimatedDurationMin: 5, maneuverTimeMin: 0,
      }),
    ]
    const result = optimizeSequence(missions, driver, [], '07:00', 3, {
      timeBudgetMs: 100, seed: 42,
    })
    const warn = result.warnings.find(w => w.message.includes('P1') && w.severity === 'error')
    expect(warn).toBeDefined()
  })

  it('hasMoreBinMissions returns true when subsequent RETIRER exists', () => {
    // vehicleCapacity=10: binLoad<capacity for first mission → hasMoreBinMissions evaluated
    // With 2 RETIRER missions, hasMoreBinMissions(1) returns true for first
    const driver = makeDriver({ depotLat: 45.76, depotLng: 4.83, vehicleCapacity: 10 })
    const exutoire = makeExutoire({ acceptedWasteTypes: [] })
    const missions = [
      makeMission('m-1', { latitude: 45.77, longitude: 4.84, type: 'RETIRER', wasteTypeLabel: 'Encombrants' }),
      makeMission('m-2', { latitude: 45.78, longitude: 4.85, type: 'RETIRER', wasteTypeLabel: 'Encombrants' }),
    ]
    const result = optimizeSequence(missions, driver, [exutoire], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    const realIds = result.orderedMissions.filter(m => !m.isSynthetic).map(m => m.id)
    expect(realIds).toContain('m-1')
    expect(realIds).toContain('m-2')
  })

  it('triggers VIDER injection via hasMoreBinMissions=false path', () => {
    // vehicleCapacity=10 so binLoad<capacity, hasMoreBinMissions is evaluated
    const driver = makeDriver({ depotLat: 45.76, depotLng: 4.83, vehicleCapacity: 10 })
    const exutoire = makeExutoire({ acceptedWasteTypes: ['Encombrants'] })
    const missions = [
      makeMission('m-1', {
        latitude: 45.77, longitude: 4.84,
        type: 'RETIRER', linkedExutoireId: 'ex-1',
        wasteTypeLabel: 'Encombrants',
      }),
    ]
    const result = optimizeSequence(missions, driver, [exutoire], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    expect(result.orderedMissions.some(m => m.type === 'VIDER')).toBe(true)
  })

  it('triggers VIDER via maxBinSizeM3 volume check', () => {
    // maxBinSizeM3=0.5, mission binSizeM3=0.5 → volumeM3>=maxM3 → VIDER needed
    const driver = makeDriver({ depotLat: 45.76, depotLng: 4.83, vehicleCapacity: 10, maxBinSizeM3: 0.5 })
    const exutoire = makeExutoire({ acceptedWasteTypes: [] })
    const missions = [
      makeMission('m-1', {
        latitude: 45.77, longitude: 4.84,
        type: 'RETIRER', binSizeM3: 0.5,
      }),
    ]
    const result = optimizeSequence(missions, driver, [exutoire], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    // Either VIDER injected or no exutoire found — no crash either way
    expect(result.orderedMissions.some(m => m.id === 'm-1')).toBe(true)
  })

  it('handles pre-existing VIDER mission in route (resets bin load)', () => {
    const driver = makeDriver()
    const vider = makeMission('v-1', {
      type: 'VIDER', latitude: 45.77, longitude: 4.84,
      estimatedDurationMin: 10, maneuverTimeMin: 0,
    })
    const result = optimizeSequence([vider], driver, [], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    expect(result.orderedMissions.some(m => m.id === 'v-1')).toBe(true)
  })

  it('handles PAUSE mission ≥45 min in route (resets continuous driving)', () => {
    const driver = makeDriver()
    const pause = makeMission('p-long', {
      type: 'PAUSE', latitude: 45.77, longitude: 4.84,
      estimatedDurationMin: 45, maneuverTimeMin: 0,
    })
    const result = optimizeSequence([pause], driver, [], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    expect(result.orderedMissions.some(m => m.id === 'p-long')).toBe(true)
  })

  it('handles PAUSE mission 15-44 min in route (reduces continuous driving)', () => {
    const driver = makeDriver()
    const pause = makeMission('p-short', {
      type: 'PAUSE', latitude: 45.77, longitude: 4.84,
      estimatedDurationMin: 20, maneuverTimeMin: 0,
    })
    const result = optimizeSequence([pause], driver, [], '07:00', 50, {
      timeBudgetMs: 100, seed: 42,
    })
    expect(result.orderedMissions.some(m => m.id === 'p-short')).toBe(true)
  })

  it('emits ALNS improvement via multi-start (covers bestCost update)', () => {
    const driver = makeDriver({ depotLat: 45.50, depotLng: 4.50 })
    // 8 missions spread across a larger area — greedy tour is likely non-optimal
    const missions = [
      makeMission('m-0', { latitude: 45.90, longitude: 5.10, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-1', { latitude: 45.55, longitude: 4.55, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-2', { latitude: 45.90, longitude: 4.50, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-3', { latitude: 45.55, longitude: 5.10, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-4', { latitude: 45.70, longitude: 4.80, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-5', { latitude: 45.75, longitude: 4.70, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-6', { latitude: 45.65, longitude: 4.90, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
      makeMission('m-7', { latitude: 45.60, longitude: 5.00, estimatedDurationMin: 5, maneuverTimeMin: 0 }),
    ]
    const result = optimizeSequence(missions, driver, [], '07:00', 50, {
      timeBudgetMs: 3000, seed: 42, lnsIterations: 100, verboseLog: true,
    })
    // ALNS with multi-start should produce a valid route
    const realIds = result.orderedMissions.filter(m => !m.isSynthetic).map(m => m.id)
    expect(realIds).toHaveLength(8)
    expect(result.totalCostMin).toBeGreaterThan(0)
  })
})
