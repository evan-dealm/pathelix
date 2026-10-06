import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), timer: () => () => 1 }) }))
vi.mock('@/lib/env', () => ({ validateEnv: vi.fn() }))
vi.mock('@/services/trafficAggregator', () => ({ startTrafficAggregation: vi.fn(), stopTrafficAggregation: vi.fn() }))
vi.mock('@/lib/redisClient', () => ({ getRedisClient: async () => null }))
vi.mock('@/lib/webPush', () => ({ broadcastToTenant: vi.fn() }))
vi.mock('@/generated/prisma', () => ({
  PrismaClient: class {
    plan = { findMany: async () => [] }
    tenantSettings = { findUnique: async () => null }
    pushSubscription = { findMany: async () => [] }
    $disconnect = async () => undefined
  },
}))
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }))

const runVRP = vi.hoisted(() => vi.fn(async () => ({
  assignments: {}, unassignedMissions: [], warnings: [],
  stats: { assignedMissions: 0, totalMissions: 0, score: 0, timeTakenMs: 1 },
})))
vi.mock('@/lib/vrp/index', () => ({ runVRP }))

import { processJob } from '../vrpWorker'

const job = (data: Record<string, unknown>) => ({ id: 'j1', data, updateProgress: vi.fn() }) as never

const DATA = {
  tenantId: 't-1', date: '2026-10-05', exutoires: [],
  missions: [{ id: 'm1', latitude: 45, longitude: 5 }],
  drivers: [{ id: 'd1', depotLat: 45, depotLng: 5 }],
  existingPlans: {},
  options: { timeBudgetMs: 5000, defaultStartTime: '06:30', defaultSpeedKmh: 42, valhallaFactor: 1.4, usePareto: true },
}

beforeEach(() => runVRP.mockClear())

describe('vrpWorker.processJob', () => {
  it('forwards the tenant options resolved by the route (start time, speed, Valhalla factor, Pareto)', async () => {
    await processJob(job(DATA))
    const opts = (runVRP.mock.calls[0] as unknown[])[4] as Record<string, unknown>
    expect(opts).toMatchObject({ defaultStartTime: '06:30', defaultSpeedKmh: 42, valhallaFactor: 1.4, usePareto: true, tenantId: 't-1' })
    // Not forced: the engine scales iterations to the instance when unset.
    expect(opts.lnsIterations).toBeUndefined()
  })

  it('fails invalid input as unrecoverable (no pointless retries)', async () => {
    await expect(processJob(job({ ...DATA, date: 'bad' }))).rejects.toMatchObject({ name: 'UnrecoverableError' })
  })
})
