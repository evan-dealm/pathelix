import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanningStore } from '../planningStore'
import type { Driver, Mission, PlannedMission } from '@/lib/types'

const DRIVER_A: Driver = {
  id:        'd-1',
  firstName: 'Jean',
  lastName:  'Dupont',
  sector:    'Nord',
  depotName: 'Dépôt Nord',
  depotLat:  45.764,
  depotLng:  4.836,
}

const DRIVER_B: Driver = {
  id:        'd-2',
  firstName: 'Marie',
  lastName:  'Curie',
  sector:    'Sud',
  depotName: 'Dépôt Sud',
  depotLat:  45.700,
  depotLng:  4.800,
}

const MISSION_1: Mission = {
  id:                   'm-1',
  type:                 'POSER',
  date:                 '2026-03-18',
  address:              '10 rue de Rivoli',
  latitude:             48.856,
  longitude:            2.352,
  estimatedDurationMin: 15,
  maneuverTimeMin:      5,
}

const MISSION_2: Mission = {
  id:                   'm-2',
  type:                 'RETIRER',
  date:                 '2026-03-18',
  address:              '20 avenue des Champs',
  latitude:             48.869,
  longitude:            2.308,
  estimatedDurationMin: 20,
  maneuverTimeMin:      10,
}

const MISSION_3: Mission = {
  id:                   'm-3',
  type:                 'ECHANGER',
  date:                 '2026-03-18',
  address:              '5 place de la Concorde',
  latitude:             48.865,
  longitude:            2.321,
  estimatedDurationMin: 25,
  maneuverTimeMin:      8,
}

const DATE = '2026-03-18'

function resetStore() {
  usePlanningStore.setState({
    drivers:     [],
    missions:    [],
    plans:       {},
    startTimes:  {},
    speeds:      {},
    unavailable: {},
    _history:    [],
    _historyIdx: -1,
  })
}

describe('planningStore', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('setInitialData', () => {
    it('populates drivers and missions', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A, DRIVER_B], [MISSION_1, MISSION_2])

      const state = usePlanningStore.getState()
      expect(state.drivers).toHaveLength(2)
      expect(state.missions).toHaveLength(2)
      expect(state.drivers[0].id).toBe('d-1')
      expect(state.missions[0].id).toBe('m-1')
    })

    it('replaces existing data', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1])
      usePlanningStore.getState().setInitialData([DRIVER_B], [MISSION_2, MISSION_3])

      const state = usePlanningStore.getState()
      expect(state.drivers).toHaveLength(1)
      expect(state.drivers[0].id).toBe('d-2')
      expect(state.missions).toHaveLength(2)
    })
  })

  describe('assignToDriver', () => {
    beforeEach(() => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2])
    })

    it('moves mission from pool to driver plan', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)

      const state = usePlanningStore.getState()
      const plan  = state.plans['d-1|2026-03-18']

      expect(plan).toBeDefined()
      expect(plan).toHaveLength(1)
      expect(plan[0].id).toBe('m-1')
      expect(plan[0].sequenceOrder).toBe(1)
    })

    it('assigns multiple missions with correct sequence order', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan).toHaveLength(2)
      expect(plan[0].sequenceOrder).toBe(1)
      expect(plan[1].sequenceOrder).toBe(2)
    })

    it('does nothing if mission does not exist', () => {
      usePlanningStore.getState().assignToDriver('non-existent', 'd-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan).toBeUndefined()
    })
  })

  describe('unassignFromDriver', () => {
    beforeEach(() => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2, MISSION_3])
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-3', 'd-1', DATE)
    })

    it('removes mission from driver plan', () => {
      usePlanningStore.getState().unassignFromDriver('m-2', 'd-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan).toHaveLength(2)
      expect(plan.find(m => m.id === 'm-2')).toBeUndefined()
    })

    it('re-sequences remaining missions', () => {
      usePlanningStore.getState().unassignFromDriver('m-1', 'd-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan[0].sequenceOrder).toBe(1)
      expect(plan[1].sequenceOrder).toBe(2)
    })
  })

  describe('clearDriverPlan', () => {
    it('empties a specific driver plan', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1])
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().clearDriverPlan('d-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan).toHaveLength(0)
    })
  })

  describe('clearAllPlansForDate', () => {
    it('clears all driver plans for the given date', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A, DRIVER_B], [MISSION_1, MISSION_2])
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-2', DATE)

      usePlanningStore.getState().clearAllPlansForDate(DATE)

      const state = usePlanningStore.getState()
      expect(state.plans['d-1|2026-03-18']).toHaveLength(0)
      expect(state.plans['d-2|2026-03-18']).toHaveLength(0)
    })
  })

  describe('undo / redo', () => {
    beforeEach(() => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2])
    })

    it('canUndo returns false initially', () => {
      expect(usePlanningStore.getState().canUndo()).toBe(false)
    })

    it('canUndo returns true after two actions (history needs 2+ snapshots)', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)
      expect(usePlanningStore.getState().canUndo()).toBe(true)
    })

    it('undo restores previous snapshot', () => {

      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)

      expect(usePlanningStore.getState().plans['d-1|2026-03-18']).toHaveLength(2)

      usePlanningStore.getState().undo()

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan === undefined || plan.length === 0).toBe(true)
    })

    it('redo goes forward in history', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)
      usePlanningStore.getState().undo()

      usePlanningStore.getState().redo()

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan).toBeDefined()
      expect(plan).toHaveLength(1)
      expect(plan[0].id).toBe('m-1')
    })

    it('canRedo returns false when at latest state', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)
      expect(usePlanningStore.getState().canRedo()).toBe(false)
    })

    it('canRedo returns true after undo', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)
      usePlanningStore.getState().undo()
      expect(usePlanningStore.getState().canRedo()).toBe(true)
    })
  })

  describe('archiveMission / restoreMission', () => {
    beforeEach(() => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2])
    })

    it('archiveMission sets archived flag to true', () => {
      usePlanningStore.getState().archiveMission('m-1')

      const m = usePlanningStore.getState().missions.find(m => m.id === 'm-1')
      expect(m?.archived).toBe(true)
    })

    it('archiveMission removes from driver plan', () => {
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().archiveMission('m-1')

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan.find(m => m.id === 'm-1')).toBeUndefined()
    })

    it('restoreMission sets archived flag to false', () => {
      usePlanningStore.getState().archiveMission('m-1')
      usePlanningStore.getState().restoreMission('m-1')

      const m = usePlanningStore.getState().missions.find(m => m.id === 'm-1')
      expect(m?.archived).toBe(false)
    })
  })

  describe('archiveDriver / restoreDriver', () => {
    beforeEach(() => {
      usePlanningStore.getState().setInitialData([DRIVER_A, DRIVER_B], [])
    })

    it('archiveDriver sets archived flag to true', () => {
      usePlanningStore.getState().archiveDriver('d-1')

      const d = usePlanningStore.getState().drivers.find(d => d.id === 'd-1')
      expect(d?.archived).toBe(true)
    })

    it('restoreDriver sets archived flag to false', () => {
      usePlanningStore.getState().archiveDriver('d-1')
      usePlanningStore.getState().restoreDriver('d-1')

      const d = usePlanningStore.getState().drivers.find(d => d.id === 'd-1')
      expect(d?.archived).toBe(false)
    })
  })

  describe('applyOptimization', () => {
    it('applies optimizer result to plans', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2])

      const planned: PlannedMission = { ...MISSION_1, sequenceOrder: 1 }
      const assignments = { 'd-1': [planned] }

      usePlanningStore.getState().applyOptimization(DATE, assignments, [MISSION_2])

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      expect(plan).toHaveLength(1)
      expect(plan[0].id).toBe('m-1')
    })
  })

  describe('setStartTime', () => {
    it('stores start time for a driver/date combination', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [])
      usePlanningStore.getState().setStartTime('d-1', DATE, '08:30')

      const startTimes = usePlanningStore.getState().startTimes
      expect(startTimes['d-1|2026-03-18']).toBe('08:30')
    })
  })

  describe('setSpeed', () => {
    it('stores speed for a driver', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [])
      usePlanningStore.getState().setSpeed('d-1', 60)

      const speeds = usePlanningStore.getState().speeds
      expect(speeds['d-1']).toBe(60)
    })
  })

  describe('moveUp / moveDown', () => {
    beforeEach(() => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2, MISSION_3])
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-2', 'd-1', DATE)
      usePlanningStore.getState().assignToDriver('m-3', 'd-1', DATE)
    })

    it('moveUp swaps mission with the one above', () => {
      usePlanningStore.getState().moveUp('m-2', 'd-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      const sorted = [...plan].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      expect(sorted[0].id).toBe('m-2')
      expect(sorted[1].id).toBe('m-1')
    })

    it('moveDown swaps mission with the one below', () => {
      usePlanningStore.getState().moveDown('m-1', 'd-1', DATE)

      const plan = usePlanningStore.getState().plans['d-1|2026-03-18']
      const sorted = [...plan].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      expect(sorted[0].id).toBe('m-2')
      expect(sorted[1].id).toBe('m-1')
    })
  })

  describe('addMission', () => {
    it('adds a new mission to the pool', () => {
      usePlanningStore.getState().setInitialData([], [])
      usePlanningStore.getState().addMission({
        type: 'POSER', date: DATE, address: 'New', latitude: 48.8, longitude: 2.3,
        estimatedDurationMin: 10, maneuverTimeMin: 3,
      })

      expect(usePlanningStore.getState().missions).toHaveLength(1)
      expect(usePlanningStore.getState().missions[0].address).toBe('New')
    })
  })

  describe('removeMission', () => {
    it('removes mission from pool and all plans', () => {
      usePlanningStore.getState().setInitialData([DRIVER_A], [MISSION_1, MISSION_2])
      usePlanningStore.getState().assignToDriver('m-1', 'd-1', DATE)

      usePlanningStore.getState().removeMission('m-1')

      const state = usePlanningStore.getState()
      expect(state.missions.find(m => m.id === 'm-1')).toBeUndefined()
      const plan = state.plans['d-1|2026-03-18']
      expect(plan.find(m => m.id === 'm-1')).toBeUndefined()
    })
  })
})
