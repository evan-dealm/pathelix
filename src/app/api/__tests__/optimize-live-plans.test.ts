import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('@/lib/permissions', () => ({ hasPermission: vi.fn(async () => true) }))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: () => ({ tenantId: 't-1', userId: 'u-1', role: 'dispatcher', requestId: 'r', trade: null }),
}))
vi.mock('@/lib/loadShedder', () => ({ loadShedder: { acquire: () => 'ok', release: vi.fn() }, shedResponse: vi.fn() }))
vi.mock('@/lib/redisClient', () => ({ getRedisClient: async () => null }))

const DRIVERS = [
  { id: 'd1', firstName: 'A', lastName: 'A', depotLat: 45, depotLng: 5 },
  { id: 'd2', firstName: 'B', lastName: 'B', depotLat: 45, depotLng: 5 },
  { id: 'd3', firstName: 'C', lastName: 'C', depotLat: 45, depotLng: 5 },
]
const mission = (id: string) => ({ id, type: 'POSER', date: '2026-10-05', address: id, latitude: 45.1, longitude: 5.1, estimatedDurationMin: 10, maneuverTimeMin: 5 })
const planned = (id: string, seq: number) => ({ ...mission(id), sequenceOrder: seq })

vi.mock('@/lib/data/drivers', () => ({ getAllDrivers: async () => DRIVERS }))
vi.mock('@/lib/data/missions', () => ({ getMissionsByDate: async () => ['m-done', 'm1', 'm2', 'm-other'].map(mission) }))
vi.mock('@/lib/data/exutoires', () => ({ getAllExutoires: async () => [] }))

const runVRP = vi.hoisted(() => vi.fn())
vi.mock('@/lib/vrp/index', () => ({ runVRP }))

const upserts: Array<{ driverId: string; missions: Array<{ id: string; sequenceOrder: number }> }> = []
const db = vi.hoisted(() => ({} as Record<string, unknown>))
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => db,
  unscopedPrisma: { tenant: { findUnique: async () => ({ timezone: 'Europe/Paris' }) } },
}))
vi.mock('@/lib/webPush', () => ({ broadcastToTenant: vi.fn() }))

import { POST } from '@/app/api/optimize/live/route'

beforeEach(() => {
  upserts.length = 0
  Object.assign(db, {
    tenantSettings: { findUnique: async () => null },
    pushSubscription: { findMany: async () => [] },
    plan: {
      // d1 already finished m-done; d3 (outside this re-optimisation) holds m-other.
      findMany: async () => [
        { driverId: 'd1', startTime: '07:00', missions: [planned('m-done', 0), planned('m1', 1)], statuses: { 'm-done': { status: 'done' } } },
        { driverId: 'd2', startTime: '07:00', missions: [planned('m2', 0)], statuses: {} },
        { driverId: 'd3', startTime: '07:00', missions: [planned('m-other', 0)], statuses: {} },
      ],
      upsert: vi.fn(async ({ where, update }: { where: { tenantId_driverId_date: { driverId: string } }; update: { missions: Array<{ id: string; sequenceOrder: number }> } }) => {
        upserts.push({ driverId: where.tenantId_driverId_date.driverId, missions: update.missions })
      }),
    },
    $transaction: async (fn: (_tx: unknown) => Promise<unknown>) => fn(db),
  })
  // The optimiser moves everything to d1 and leaves d2 empty.
  runVRP.mockResolvedValue({ assignments: { d1: [planned('m2', 0), planned('m1', 1)] }, stats: { assignedMissions: 2 }, unassignedMissions: [] })
})

const call = () => POST(new NextRequest('http://localhost/api/optimize/live', {
  method: 'POST', body: JSON.stringify({ date: '2026-10-05', driverIds: ['d1', 'd2'] }),
}))

describe('POST /api/optimize/live — plan rewrite', () => {
  it('keeps the steps already done at the head of the plan', async () => {
    expect((await call()).status).toBe(200)
    const d1 = upserts.find(u => u.driverId === 'd1')!
    expect(d1.missions.map(m => m.id)).toEqual(['m-done', 'm2', 'm1'])
    expect(d1.missions.map(m => m.sequenceOrder)).toEqual([0, 1, 2])
  })

  it('rewrites a driver left with nothing new, so a moved mission is not in two tours', async () => {
    await call()
    expect(upserts.find(u => u.driverId === 'd2')?.missions).toEqual([])
  })

  it('never re-plans a mission held by a driver outside the scope, nor a locked one', async () => {
    await call()
    const sent = (runVRP.mock.calls[0][0] as Array<{ id: string }>).map(m => m.id).sort()
    expect(sent).toEqual(['m1', 'm2'])
    expect(upserts.some(u => u.driverId === 'd3')).toBe(false)
  })
})
