/**
 * Additional planningStore tests covering actions missing from planningStore.test.ts:
 * updateMission, addDriver family, bulk ops, lock, unavailable, reorder,
 * copyPlansToDate, updatePlannedMission, setManualStartMin, savePlansToDB.
 *
 * debouncedSyncPlan/debouncedSyncAllForDate are no-ops in Node (window undefined).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePlanningStore } from '../planningStore'
import type { Driver, Mission, PlannedMission } from '@/lib/types'

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

const DRIVER_A: Driver = { id: 'd-1', firstName: 'Jean', lastName: 'Dupont', sector: 'Nord', depotName: 'Dépôt Nord', depotLat: 45.76, depotLng: 4.84 }
const DRIVER_B: Driver = { id: 'd-2', firstName: 'Marie', lastName: 'Curie', sector: 'Sud', depotName: 'Dépôt Sud', depotLat: 45.70, depotLng: 4.80 }

const MISSION_1: Mission = { id: 'm-1', type: 'POSER', date: '2026-03-18', address: '10 rue Rivoli', latitude: 48.856, longitude: 2.352, estimatedDurationMin: 15, maneuverTimeMin: 5 }
const MISSION_2: Mission = { id: 'm-2', type: 'RETIRER', date: '2026-03-18', address: '20 av Champs', latitude: 48.869, longitude: 2.308, estimatedDurationMin: 20, maneuverTimeMin: 10 }

const DATE = '2026-03-18'
const DATE2 = '2026-03-19'

function resetStore() {
  usePlanningStore.setState({
    drivers: [], missions: [], plans: {}, startTimes: {}, speeds: {},
    unavailable: {}, lockedPlans: {}, syncStatus: 'idle', lastSyncedAt: null,
    _history: [], _historyIdx: -1,
  })
}

function st() { return usePlanningStore.getState() }

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

describe('updateMission', () => {
  it('updates mission in pool', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().updateMission('m-1', { address: 'Nouvelle adresse' })
    expect(st().missions[0].address).toBe('Nouvelle adresse')
  })

  it('updates mission in plan if already assigned', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().updateMission('m-1', { estimatedDurationMin: 99 })
    const plan = st().plans['d-1|2026-03-18']
    expect(plan[0].estimatedDurationMin).toBe(99)
  })

  it('no-op for unknown id', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().updateMission('non-existent', { address: 'X' })
    expect(st().missions[0].address).toBe('10 rue Rivoli')
  })
})

describe('addDriver / updateDriver / removeDriver', () => {
  it('addDriver adds a driver with generated id', () => {
    st().setInitialData([], [])
    st().addDriver({ firstName: 'Bob', lastName: 'Smith', sector: 'Est', depotName: 'Dépôt Est', depotLat: 45.0, depotLng: 5.0 })
    expect(st().drivers).toHaveLength(1)
    expect(st().drivers[0].firstName).toBe('Bob')
    expect(st().drivers[0].id).toBeTruthy()
  })

  it('addDriver uses provided serverId', () => {
    st().setInitialData([], [])
    st().addDriver({ firstName: 'Bob', lastName: 'Smith', sector: 'Est', depotName: 'Dépôt Est', depotLat: 45.0, depotLng: 5.0 }, 'server-d-99')
    expect(st().drivers[0].id).toBe('server-d-99')
  })

  it('updateDriver changes driver fields', () => {
    st().setInitialData([DRIVER_A], [])
    st().updateDriver('d-1', { firstName: 'Pierre' })
    expect(st().drivers[0].firstName).toBe('Pierre')
  })

  it('removeDriver removes driver and cleans up plans', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().removeDriver('d-1')
    expect(st().drivers).toHaveLength(0)
    expect(st().plans['d-1|2026-03-18']).toBeUndefined()
  })
})

describe('addDriversBulk', () => {
  it('adds multiple drivers', () => {
    st().setInitialData([], [])
    st().addDriversBulk([
      { firstName: 'A', lastName: 'X', sector: 'N', depotName: 'D1', depotLat: 45, depotLng: 5 },
      { firstName: 'B', lastName: 'Y', sector: 'S', depotName: 'D2', depotLat: 44, depotLng: 4 },
    ])
    expect(st().drivers).toHaveLength(2)
    expect(st().drivers[0].firstName).toBe('A')
  })
})

describe('addMissionsBulk', () => {
  it('adds new missions without duplicates', () => {
    st().setInitialData([], [MISSION_1])
    st().addMissionsBulk([MISSION_1, MISSION_2]) // MISSION_1 already exists
    expect(st().missions).toHaveLength(2)
    expect(st().missions[1].id).toBe('m-2')
  })

  it('no-op when all missions already exist', () => {
    st().setInitialData([], [MISSION_1])
    st().addMissionsBulk([MISSION_1])
    expect(st().missions).toHaveLength(1)
  })
})

describe('mergePlansFromDB', () => {
  it('merges plans and startTimes from DB', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    const planned: PlannedMission = { ...MISSION_1, sequenceOrder: 1 }
    st().mergePlansFromDB([
      { driverId: 'd-1', date: DATE, missions: [planned], startTime: '08:00', speedKmh: 55 },
    ])
    expect(st().plans['d-1|2026-03-18']).toHaveLength(1)
    expect(st().startTimes['d-1|2026-03-18']).toBe('08:00')
    expect(st().speeds['d-1']).toBe(55)
  })
})

describe('toggleUnavailable / isUnavailable', () => {
  it('toggles unavailability on and off', () => {
    expect(st().isUnavailable('d-1', DATE)).toBe(false)
    st().toggleUnavailable('d-1', DATE)
    expect(st().isUnavailable('d-1', DATE)).toBe(true)
    st().toggleUnavailable('d-1', DATE)
    expect(st().isUnavailable('d-1', DATE)).toBe(false)
  })
})

describe('togglePlanLock / isPlanLocked', () => {
  it('toggles lock state', () => {
    expect(st().isPlanLocked('d-1', DATE)).toBe(false)
    st().togglePlanLock('d-1', DATE)
    expect(st().isPlanLocked('d-1', DATE)).toBe(true)
    st().togglePlanLock('d-1', DATE)
    expect(st().isPlanLocked('d-1', DATE)).toBe(false)
  })

  it('locked plan prevents assignToDriver', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().togglePlanLock('d-1', DATE)
    st().assignToDriver('m-1', 'd-1', DATE)
    expect(st().plans['d-1|2026-03-18']).toBeUndefined()
  })

  it('locked plan prevents unassignFromDriver', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().togglePlanLock('d-1', DATE)
    st().unassignFromDriver('m-1', 'd-1', DATE)
    expect(st().plans['d-1|2026-03-18']).toHaveLength(1)
  })

  it('locked plan prevents clearDriverPlan', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().togglePlanLock('d-1', DATE)
    st().clearDriverPlan('d-1', DATE)
    expect(st().plans['d-1|2026-03-18']).toHaveLength(1)
  })
})

describe('reorderMissions', () => {
  beforeEach(() => {
    st().setInitialData([DRIVER_A], [MISSION_1, MISSION_2])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().assignToDriver('m-2', 'd-1', DATE)
  })

  it('moves mission from index 0 to 1', () => {
    st().reorderMissions('d-1', DATE, 0, 1)
    const plan = st().plans['d-1|2026-03-18'].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    expect(plan[0].id).toBe('m-2')
    expect(plan[1].id).toBe('m-1')
  })

  it('no-op when fromIndex === toIndex', () => {
    st().reorderMissions('d-1', DATE, 0, 0)
    const plan = st().plans['d-1|2026-03-18'].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    expect(plan[0].id).toBe('m-1')
  })

  it('no-op for out-of-bounds indices', () => {
    st().reorderMissions('d-1', DATE, 0, 99)
    const plan = st().plans['d-1|2026-03-18'].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    expect(plan[0].id).toBe('m-1') // unchanged
  })
})

describe('copyPlansToDate', () => {
  it('copies plans from one date to another', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    const planned: PlannedMission = { ...MISSION_1, sequenceOrder: 1 }
    st().mergePlansFromDB([{ driverId: 'd-1', date: DATE, missions: [planned], startTime: '07:30' }])
    st().copyPlansToDate(DATE, DATE2)
    expect(st().plans['d-1|2026-03-19']).toHaveLength(1)
    expect(st().startTimes['d-1|2026-03-19']).toBe('07:30')
  })

  it('does not copy to locked target date', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    const planned: PlannedMission = { ...MISSION_1, sequenceOrder: 1 }
    st().mergePlansFromDB([{ driverId: 'd-1', date: DATE, missions: [planned] }])
    st().togglePlanLock('d-1', DATE2)
    st().copyPlansToDate(DATE, DATE2)
    expect(st().plans['d-1|2026-03-19']).toBeUndefined()
  })
})

describe('updatePlannedMission', () => {
  it('updates a field in a planned mission', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().updatePlannedMission('m-1', 'd-1', DATE, { estimatedDurationMin: 99 })
    expect(st().plans['d-1|2026-03-18'][0].estimatedDurationMin).toBe(99)
  })

  it('no-op for unknown mission in plan', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().updatePlannedMission('non-existent', 'd-1', DATE, { estimatedDurationMin: 99 })
    expect(st().plans['d-1|2026-03-18'][0].estimatedDurationMin).toBe(15)
  })
})

describe('setManualStartMin', () => {
  it('sets manualStartMin on a planned mission', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().setManualStartMin('m-1', 'd-1', DATE, 480)
    expect(st().plans['d-1|2026-03-18'][0].manualStartMin).toBe(480)
  })

  it('clears manualStartMin when undefined passed', () => {
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    st().setManualStartMin('m-1', 'd-1', DATE, 480)
    st().setManualStartMin('m-1', 'd-1', DATE, undefined)
    expect(st().plans['d-1|2026-03-18'][0].manualStartMin).toBeUndefined()
  })
})

describe('savePlansToDB', () => {
  it('calls fetch /api/plans with plan data', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    await st().savePlansToDB(DATE)
    expect(mockFetch).toHaveBeenCalledWith('/api/plans', expect.objectContaining({ method: 'POST' }))
  })

  it('no-op when no plans for date', async () => {
    await st().savePlansToDB(DATE)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    st().setInitialData([DRIVER_A], [MISSION_1])
    st().assignToDriver('m-1', 'd-1', DATE)
    await expect(st().savePlansToDB(DATE)).resolves.toBeUndefined()
  })
})

describe('addMission with serverId', () => {
  it('uses provided serverId', () => {
    st().setInitialData([], [])
    st().addMission({ type: 'POSER', date: DATE, address: 'X', latitude: 1, longitude: 1, estimatedDurationMin: 10, maneuverTimeMin: 2 }, 'server-m-42')
    expect(st().missions[0].id).toBe('server-m-42')
  })
})
