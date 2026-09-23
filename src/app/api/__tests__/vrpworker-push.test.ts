/**
 * Tests push notification behavior after VRP optimization.
 * Covers: throttle, feature flag, Redis down, notificationsEnabled=false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique  = vi.hoisted(() => vi.fn())
const mockFindMany    = vi.hoisted(() => vi.fn())
const mockBroadcast   = vi.hoisted(() => vi.fn())
const mockGetRedis    = vi.hoisted(() => vi.fn())
const mockRedisGet    = vi.hoisted(() => vi.fn())
const mockRedisSetex  = vi.hoisted(() => vi.fn())

const mockRedis = vi.hoisted(() => ({
  get:   mockRedisGet,
  setex: mockRedisSetex,
}))

vi.mock('@/lib/webPush', () => ({
  broadcastToTenant: mockBroadcast,
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: mockGetRedis,
}))

// We test the logic by importing and calling the helper via the route
// Since maybeSendOptimizationPush is not exported, we test it indirectly
// through the optimize route's sync path

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/permissions', () => ({
  hasPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(() => Promise.resolve([
    { id: 'd-1', firstName: 'A', lastName: 'B', sector: 'S1', depotName: 'D', depotLat: 45.0, depotLng: 5.0, archived: false },
  ])),
}))

vi.mock('@/lib/data/missions', () => ({
  getMissionsByDate: vi.fn(() => Promise.resolve([
    { id: 'm-1', type: 'POSER', date: '2026-01-06', address: 'x', latitude: 48.86, longitude: 2.33, estimatedDurationMin: 30, maneuverTimeMin: 15, archived: false, needsGeocode: false },
  ])),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/missionQueue', () => ({
  drainByDate: vi.fn(() => []),
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
    tenantSettings: { findUnique: mockFindUnique },
    pushSubscription: { findMany: mockFindMany },
  }),
}))

vi.mock('@/lib/queue/vrpQueue', () => ({
  enqueueVrpJob: vi.fn(() => Promise.reject(new Error('no workers'))),
  getVrpQueue: vi.fn(() => ({ getWorkers: vi.fn(() => Promise.resolve([])) })),
}))

vi.mock('@/lib/vrp/index', () => ({
  runVRP: vi.fn(() => Promise.resolve({
    assignments: { 'd-1': [] },
    unassignedMissions: [],
    stats: { assignedMissions: 1, totalMissions: 1, score: 85, timeTakenMs: 300 },
    warnings: [],
  })),
}))

import { POST } from '@/app/api/optimize/route'
import { NextRequest } from 'next/server'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBroadcast.mockResolvedValue({ sent: 1, failed: 0, expired: [] })
  mockGetRedis.mockResolvedValue(mockRedis)
  mockRedisGet.mockResolvedValue(null)
  mockRedisSetex.mockResolvedValue('OK')
  mockFindMany.mockResolvedValue([
    { endpoint: 'https://fcm.example.com/push/1', p256dh: 'key1', auth: 'auth1' },
  ])
})

describe('Push notifications after VRP optimization', () => {
  it('no push when notificationsEnabled=false', async () => {
    mockFindUnique.mockResolvedValue({ notificationsEnabled: false })
    await POST(makeRequest({ date: '2026-01-06' }))
    // Wait a tick for void promises
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('no push when notificationsEnabled=null (settings missing)', async () => {
    mockFindUnique.mockResolvedValue(null)
    await POST(makeRequest({ date: '2026-01-06' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('sends push when notificationsEnabled=true and no throttle', async () => {
    mockFindUnique.mockResolvedValue({ notificationsEnabled: true })
    await POST(makeRequest({ date: '2026-01-06' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockBroadcast).toHaveBeenCalledOnce()
    const payload = mockBroadcast.mock.calls[0][1]
    expect(payload.tag).toContain('vrp-')
    expect(payload.data.type).toBe('vrp_complete')
  })

  it('throttle: no push when Redis key already set', async () => {
    mockFindUnique.mockResolvedValue({ notificationsEnabled: true })
    mockRedisGet.mockResolvedValue('1')
    await POST(makeRequest({ date: '2026-01-06' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('throttle: sets Redis key after sending push', async () => {
    mockFindUnique.mockResolvedValue({ notificationsEnabled: true })
    await POST(makeRequest({ date: '2026-01-06' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining('push:throttle:'),
      120,
      '1',
    )
  })

  it('Redis down: still sends push (no throttle)', async () => {
    mockFindUnique.mockResolvedValue({ notificationsEnabled: true })
    mockGetRedis.mockResolvedValue(null)
    await POST(makeRequest({ date: '2026-01-06' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockBroadcast).toHaveBeenCalledOnce()
  })

  it('no subs: broadcastToTenant not called', async () => {
    mockFindUnique.mockResolvedValue({ notificationsEnabled: true })
    mockFindMany.mockResolvedValue([])
    await POST(makeRequest({ date: '2026-01-06' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mockBroadcast).not.toHaveBeenCalled()
  })
})
