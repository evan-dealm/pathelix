import { describe, it, expect, beforeEach } from 'vitest'
import {
  enqueueMission,
  drainByDate,
  peekQueue,
  queueSize,
  clearQueue,
} from '../missionQueue'
import type { Mission } from '@/lib/types'

function makeMissionData(overrides: Partial<Omit<Mission, 'id'>> = {}): Omit<Mission, 'id'> {
  return {
    type:                 'POSER',
    date:                 '2026-03-18',
    address:              '10 rue de Rivoli, Paris',
    latitude:             48.8566,
    longitude:            2.3522,
    estimatedDurationMin: 15,
    maneuverTimeMin:      5,
    ...overrides,
  }
}

describe('missionQueue', () => {
  beforeEach(() => {
    clearQueue()
  })

  describe('enqueueMission', () => {
    it('adds a mission to the queue with tenantId', () => {
      enqueueMission(makeMissionData(), 'tenant-a')
      expect(queueSize()).toBe(1)

      const items = peekQueue()
      expect(items[0].tenantId).toBe('tenant-a')
      expect(items[0].address).toBe('10 rue de Rivoli, Paris')
    })

    it('adds multiple missions', () => {
      enqueueMission(makeMissionData({ address: 'Addr 1' }), 'tenant-a')
      enqueueMission(makeMissionData({ address: 'Addr 2' }), 'tenant-a')
      enqueueMission(makeMissionData({ address: 'Addr 3' }), 'tenant-b')

      expect(queueSize()).toBe(3)
    })

    it('sets receivedAt timestamp', () => {
      enqueueMission(makeMissionData(), 'tenant-a')
      const items = peekQueue()
      expect(items[0].receivedAt).toBeDefined()

      expect(new Date(items[0].receivedAt).getTime()).not.toBeNaN()
    })
  })

  describe('drainByDate', () => {
    it('returns all missions for the given date', () => {
      enqueueMission(makeMissionData({ date: '2026-03-18', address: 'Addr A' }), 'tenant-a')
      enqueueMission(makeMissionData({ date: '2026-03-18', address: 'Addr B' }), 'tenant-a')
      enqueueMission(makeMissionData({ date: '2026-03-19', address: 'Addr C' }), 'tenant-a')

      const drained = drainByDate('2026-03-18')
      expect(drained).toHaveLength(2)
      expect(queueSize()).toBe(1)
    })

    it('filters by tenantId when provided', () => {
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-a')
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-b')

      const drained = drainByDate('2026-03-18', 'tenant-a')
      expect(drained).toHaveLength(1)
      expect(drained[0].tenantId).toBe('tenant-a')
      expect(queueSize()).toBe(1)
    })

    it('returns empty array when no missions match', () => {
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-a')

      const drained = drainByDate('2026-12-25')
      expect(drained).toHaveLength(0)
      expect(queueSize()).toBe(1)
    })

    it('drains all tenants when tenantId is undefined', () => {
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-a')
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-b')

      const drained = drainByDate('2026-03-18')
      expect(drained).toHaveLength(2)
      expect(queueSize()).toBe(0)
    })
  })

  describe('peekQueue', () => {
    it('returns a copy without draining', () => {
      enqueueMission(makeMissionData(), 'tenant-a')
      enqueueMission(makeMissionData(), 'tenant-b')

      const peeked = peekQueue()
      expect(peeked).toHaveLength(2)
      expect(queueSize()).toBe(2)
    })

    it('returns empty array for empty queue', () => {
      expect(peekQueue()).toHaveLength(0)
    })
  })

  describe('queue state after drain', () => {
    it('queue is empty after draining all missions', () => {
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-a')
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-a')

      drainByDate('2026-03-18', 'tenant-a')
      expect(queueSize()).toBe(0)
      expect(peekQueue()).toHaveLength(0)
    })

    it('draining the same date twice returns empty on second call', () => {
      enqueueMission(makeMissionData({ date: '2026-03-18' }), 'tenant-a')

      const first  = drainByDate('2026-03-18', 'tenant-a')
      const second = drainByDate('2026-03-18', 'tenant-a')

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(0)
    })
  })

  describe('clearQueue', () => {
    it('empties the entire queue', () => {
      enqueueMission(makeMissionData(), 'tenant-a')
      enqueueMission(makeMissionData(), 'tenant-b')

      clearQueue()
      expect(queueSize()).toBe(0)
    })
  })
})
