import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'r' })),
}))
vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({ tenantSettings: { findUnique: vi.fn(async () => null) } }),
}))
const { D, M } = vi.hoisted(() => ({
  D: (id: string) => ({
    id,
    firstName: id,
    lastName: '',
    sector: '',
    depotName: '',
    depotLat: 45,
    depotLng: 5,
  }),
  M: (id: string) => ({
    id,
    type: 'POSER',
    date: '2026-10-08',
    address: id,
    latitude: 45.01,
    longitude: 5.01,
    estimatedDurationMin: 15,
    maneuverTimeMin: 5,
  }),
}))
vi.mock('@/lib/data/planning', () => ({
  getPlanningDrivers: vi.fn(async () => ({ drivers: [D('a'), D('b')], excluded: [] })),
  withEstimatedWeights: vi.fn(async (_t: string, m: unknown[]) => m),
}))
vi.mock('@/lib/data/missions', () => ({
  getMissionsByDate: vi.fn(async () => [M('m1'), M('m2'), M('m3'), M('m4')]),
}))
vi.mock('@/lib/data/exutoires', () => ({ getAllExutoires: vi.fn(async () => []) }))
const runVRP = vi.hoisted(() =>
  vi.fn(async (missions: Array<{ id: string }>, drivers: Array<{ id: string }>) => ({
    assignments: { [drivers[0].id]: missions },
    unassignedMissions: [],
    unassignedReasons: {},
    stats: {},
    warnings: [],
  })),
)
// The route hands both searches to the solver pool; the pool itself (threads, fallback) has its
// own tests in src/lib/vrp/__tests__/solverPool.test.ts.
vi.mock('@/lib/vrp/solverPool', () => ({
  runVRPOffThread: runVRP,
  SolverBusyError: class SolverBusyError extends Error {},
}))

import { POST } from '@/app/api/optimize/simulate/route'

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/optimize/simulate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  runVRP.mockClear()
})

describe('POST /api/optimize/simulate', () => {
  it('optimises as-is then with the scenario, same seed and budget, nothing saved', async () => {
    const res = await POST(
      req({
        date: '2026-10-08',
        scenario: {
          removeDriverIds: ['b'],
          addTrucks: { like: 'a', count: 2 },
          startTime: '06:00',
          surgePct: 50,
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(runVRP).toHaveBeenCalledTimes(2)
    const [baseCall, simCall] = runVRP.mock.calls as unknown as Array<
      [
        Array<{ id: string }>,
        Array<{ id: string }>,
        unknown,
        string,
        { seed: number; timeBudgetMs: number; defaultStartTime: string },
      ]
    >
    expect(baseCall[1].map(d => d.id)).toEqual(['a', 'b'])
    expect(simCall[1].map(d => d.id)).toEqual(['a', 'sim-truck-1', 'sim-truck-2'])
    expect(simCall[0]).toHaveLength(6)
    expect(simCall[4]).toMatchObject({
      seed: baseCall[4].seed,
      timeBudgetMs: baseCall[4].timeBudgetMs,
      defaultStartTime: '06:00',
    })
    const body = await res.json()
    expect(body.baseline.assigned).toBe(4)
    expect(body.scenario.assigned).toBe(6)
  })

  it('refuses a scenario that leaves no driver', async () => {
    const res = await POST(req({ date: '2026-10-08', scenario: { removeDriverIds: ['a', 'b'] } }))
    expect(res.status).toBe(422)
  })
})
