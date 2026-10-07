import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRunVRP = vi.hoisted(() => vi.fn())

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/permissions', () => ({
  hasPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(),
}))

vi.mock('@/lib/data/missions', () => ({
  getMissionsByDate: vi.fn(),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(() => Promise.resolve([])),
}))


vi.mock('@/lib/loadShedder', () => ({
  loadShedder: { acquire: vi.fn(() => 'ok'), release: vi.fn() },
  shedResponse: vi.fn(),
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(() => true), headers: vi.fn(() => ({})) }),
  createTenantRateLimiter: () => ({ check: vi.fn(() => true), headers: vi.fn(() => ({})) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getTenantPlanLimit: vi.fn(() => Promise.resolve(10)),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC: { VRP_ENQUEUED: 'vrp.enqueued', API_ERRORS: 'api.errors' },
}))

vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    tenantSettings: { findUnique: vi.fn(() => Promise.resolve(null)) },
    plan: { findMany: vi.fn(() => Promise.resolve([])) },
  }),
}))

vi.mock('@/lib/queue/vrpQueue', () => ({
  enqueueVrpJob: vi.fn(() => Promise.reject(new Error('no workers'))),
  getVrpQueue: vi.fn(() => ({ getWorkers: vi.fn(() => Promise.resolve([])) })),
}))

vi.mock('@/lib/vrp/index', () => ({
  runVRP: mockRunVRP,
}))

import { POST } from '@/app/api/optimize/route'
import { getAllDrivers } from '@/lib/data/drivers'
import { getMissionsByDate } from '@/lib/data/missions'

const DRIVER = {
  id: 'd-1', firstName: 'Alice', lastName: 'D', sector: 'S1', depotName: 'Depot',
  depotLat: 45.0, depotLng: 5.0, archived: false,
}

const MISSION = {
  id: 'm-1', type: 'POSER' as const, date: '2026-01-06', address: '1 rue test',
  latitude: 48.86, longitude: 2.33, estimatedDurationMin: 30, maneuverTimeMin: 15,
  archived: false, needsGeocode: false,
}

const VRP_RESULT = {
  assignments: { 'd-1': [] },
  unassignedMissions: [],
  stats: { assignedMissions: 1, totalMissions: 1, score: 85, timeTakenMs: 500 },
  warnings: [],
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAllDrivers).mockResolvedValue([DRIVER])
  vi.mocked(getMissionsByDate).mockResolvedValue([MISSION])
  mockRunVRP.mockResolvedValue(VRP_RESULT)
})

describe('POST /api/optimize — usePareto', () => {
  it('usePareto=true is forwarded to runVRP', async () => {
    await POST(makeRequest({ date: '2026-01-06', options: { usePareto: true } }))
    const opts = mockRunVRP.mock.calls[0][4]
    expect(opts.usePareto).toBe(true)
  })

  it('usePareto=false is forwarded to runVRP', async () => {
    await POST(makeRequest({ date: '2026-01-06', options: { usePareto: false } }))
    const opts = mockRunVRP.mock.calls[0][4]
    expect(opts.usePareto).toBe(false)
  })

  it('usePareto absent defaults to false', async () => {
    await POST(makeRequest({ date: '2026-01-06' }))
    const opts = mockRunVRP.mock.calls[0][4]
    expect(opts.usePareto).toBe(false)
  })

  it('usePareto is accepted by OptimizeRequestSchema (no 422)', async () => {
    const res = await POST(makeRequest({ date: '2026-01-06', options: { usePareto: true } }))
    expect(res.status).not.toBe(422)
  })

  it('needsGeocode missions are filtered before VRP', async () => {
    vi.mocked(getMissionsByDate).mockResolvedValue([
      MISSION,
      { ...MISSION, id: 'm-geo', needsGeocode: true, latitude: 0, longitude: 0 },
    ])
    await POST(makeRequest({ date: '2026-01-06' }))
    const missions = mockRunVRP.mock.calls[0][0]
    expect(missions.every((m: { needsGeocode?: boolean }) => !m.needsGeocode)).toBe(true)
    expect(missions.length).toBe(1)
  })

  it('archived missions are filtered before VRP', async () => {
    vi.mocked(getMissionsByDate).mockResolvedValue([
      MISSION,
      { ...MISSION, id: 'm-arch', archived: true },
    ])
    await POST(makeRequest({ date: '2026-01-06' }))
    const missions = mockRunVRP.mock.calls[0][0]
    expect(missions.every((m: { archived?: boolean }) => !m.archived)).toBe(true)
    expect(missions.length).toBe(1)
  })
})
