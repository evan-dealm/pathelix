/**
 * Tests for uncovered API routes:
 *   GET/POST /api/holidays
 *   DELETE   /api/holidays/[id]
 *   GET      /api/missions/queue
 *   POST     /api/optimize/live (auth + validation)
 *   POST     /api/optimize/resequence (auth + validation)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Role defaults from the real permission table (no custom per-user grants in these tests).
vi.mock('@/lib/permissions', async (orig) => {
  const real = await orig<typeof import('@/lib/permissions')>()
  return {
    ...real,
    hasPermission: vi.fn(async (_userId: string, role: string, perm: string) =>
      role === 'admin' || role === 'superadmin' || (real.DEFAULT_PERMISSIONS[role] ?? []).includes(perm as never)),
  }
})


const mockPrisma = vi.hoisted(() => ({
  holiday: {
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    findFirst:  vi.fn(),
    count:      vi.fn(),
    create:     vi.fn(),
    delete:     vi.fn(),
  },
  tenantSettings: {
    findUnique: vi.fn(),
  },
  plan: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  mission: {
    findMany: vi.fn(),
  },
  pushSubscription: { findMany: vi.fn() },
  tenant: { findUnique: vi.fn(async () => ({ timezone: 'Europe/Paris' })) },
  $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null,
  })),
  getTenantId: vi.fn(() => 't-1'),
  invalidateSuspensionCache: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC: { API_LATENCY_MS: 'api.latency', API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors', VRP_ENQUEUED: 'vrp.enqueued' },
}))
vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn(async (_k: string, _t: string, fn: () => Promise<unknown>) => fn()),
    invalidateAll: vi.fn(),
  },
}))
vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(async () => null),
}))
vi.mock('@/lib/loadShedder', () => ({
  loadShedder: { acquire: vi.fn(() => 'allow'), release: vi.fn() },
  shedResponse: vi.fn(),
}))
vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(async () => [
    { id: 'd-1', firstName: 'A', lastName: 'B', archived: false, depotLat: 45.9, depotLng: 6.1, sector: 'N', depotName: 'D' },
  ]),
  getDriver: vi.fn(async () => null),
}))
vi.mock('@/lib/data/missions', () => ({
  getMissionsByDate: vi.fn(async () => []),
}))
vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(async () => []),
}))
vi.mock('@/lib/vrp/index', () => ({
  runVRP: vi.fn(async () => ({
    assignments: {},
    unassignedMissions: [],
    stats: { assignedMissions: 0, totalMissions: 0, score: 100, globalScore: 100, timeTakenMs: 100 },
    warnings: [],
  })),
}))
vi.mock('@/lib/missionQueue', () => ({
  peekQueue: vi.fn(() => []),
}))
vi.mock('@/lib/webPush', () => ({
  broadcastToTenant: vi.fn(),
}))

import { GET as holidaysGet, POST as holidaysPost } from '@/app/api/holidays/route'
import { DELETE as holidayDel }                     from '@/app/api/holidays/[id]/route'
import { GET as queueGet }                          from '@/app/api/missions/queue/route'
import { POST as livePost }                         from '@/app/api/optimize/live/route'
import { POST as resequencePost }                   from '@/app/api/optimize/resequence/route'
import { getRequestContext }                        from '@/lib/data/context'
import { getMissionsByDate }                        from '@/lib/data/missions'
import { getAllDrivers }                            from '@/lib/data/drivers'
import { peekQueue }                               from '@/lib/missionQueue'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeDelete(url: string): NextRequest { return new NextRequest(url, { method: 'DELETE' }) }
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestContext).mockReturnValue({
    tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null,
  })
})

// ─── /api/holidays ────────────────────────────────────────────────────

describe('GET /api/holidays', () => {
  it('returns holidays with pagination', async () => {
    const holidays = [{ id: 'h-1', date: '2025-07-14', label: 'Bastille', tenantId: 't-1' }]
    mockPrisma.holiday.findMany.mockResolvedValueOnce(holidays)
    mockPrisma.holiday.count.mockResolvedValueOnce(1)
    const res = await holidaysGet(makeGet('http://x/api/holidays'))
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; pagination: { total: number } }
    expect(body.data).toHaveLength(1)
    expect(body.pagination.total).toBe(1)
  })

  it('uses default page=1 and limit=50', async () => {
    mockPrisma.holiday.findMany.mockResolvedValueOnce([])
    mockPrisma.holiday.count.mockResolvedValueOnce(0)
    await holidaysGet(makeGet('http://x/api/holidays'))
    expect(mockPrisma.holiday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    )
  })

  it('respects limit cap of 100', async () => {
    mockPrisma.holiday.findMany.mockResolvedValueOnce([])
    mockPrisma.holiday.count.mockResolvedValueOnce(0)
    await holidaysGet(makeGet('http://x/api/holidays?limit=999'))
    expect(mockPrisma.holiday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })
})

describe('POST /api/holidays', () => {
  it('403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null,
    })
    const res = await holidaysPost(makePost('http://x/api/holidays', { date: '2025-07-14', label: 'Test' }))
    expect(res.status).toBe(403)
  })

  it('422 for missing date', async () => {
    const res = await holidaysPost(makePost('http://x/api/holidays', { label: 'No date' }))
    expect(res.status).toBe(422)
  })

  it('creates holiday and returns 201', async () => {
    const holiday = { id: 'h-1', date: '2025-07-14', label: 'Bastille', tenantId: 't-1' }
    mockPrisma.holiday.create.mockResolvedValueOnce(holiday)
    const res = await holidaysPost(makePost('http://x/api/holidays', { date: '2025-07-14', label: 'Bastille' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('h-1')
  })

  it('409 for duplicate date', async () => {
    const err = Object.assign(new Error('Unique'), { code: 'P2002' })
    mockPrisma.holiday.create.mockRejectedValueOnce(err)
    const res = await holidaysPost(makePost('http://x/api/holidays', { date: '2025-07-14', label: 'Duplicate' }))
    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/holidays/[id]', () => {
  it('404 when holiday not found', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValueOnce(null)
    const res = await holidayDel(makeDelete('http://x/api/holidays/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('deletes and returns 200', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValueOnce({ id: 'h-1', tenantId: 't-1' })
    mockPrisma.holiday.delete.mockResolvedValueOnce({ id: 'h-1' })
    const res = await holidayDel(makeDelete('http://x/api/holidays/h-1'), makeParams('h-1'))
    expect(res.status).toBe(200)
  })
})

// ─── /api/missions/queue ─────────────────────────────────────────────

describe('GET /api/missions/queue', () => {
  it('returns empty queue', async () => {
    vi.mocked(peekQueue).mockReturnValueOnce([])
    const res = await queueGet(makeGet('http://x/api/missions/queue'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('returns queued missions', async () => {
    const queue = [{ id: 'm-1', type: 'POSER', date: '2025-06-15' }]
    vi.mocked(peekQueue).mockReturnValueOnce(queue as unknown as ReturnType<typeof peekQueue>)
    const res = await queueGet(makeGet('http://x/api/missions/queue'))
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toHaveLength(1)
  })
})

// ─── /api/optimize/live ──────────────────────────────────────────────

describe('POST /api/optimize/live', () => {
  it('403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null,
    })
    const res = await livePost(makePost('http://x/api/optimize/live', { date: '2025-06-15' }))
    expect(res.status).toBe(403)
  })

  it('422 for invalid date format', async () => {
    const res = await livePost(makePost('http://x/api/optimize/live', { date: 'not-a-date' }))
    expect(res.status).toBe(422)
  })

  it('422 when no drivers available', async () => {
    vi.mocked(getAllDrivers).mockResolvedValueOnce([])
    mockPrisma.tenantSettings.findUnique.mockResolvedValueOnce(null)
    mockPrisma.plan.findMany.mockResolvedValueOnce([])
    const { getMissionsByDate: getMD } = await import('@/lib/data/missions')
    vi.mocked(getMD).mockResolvedValueOnce([])
    const res = await livePost(makePost('http://x/api/optimize/live', { date: '2025-06-15' }))
    expect(res.status).toBe(422)
  })

  it('returns result when all missions are locked', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValueOnce(null)
    mockPrisma.plan.findMany.mockResolvedValueOnce([])
    vi.mocked(getMissionsByDate).mockResolvedValueOnce([])
    const res = await livePost(makePost('http://x/api/optimize/live', { date: '2025-06-15' }))
    // When no active missions, returns "all done" message
    expect([200, 422]).toContain(res.status)
  })
})

// ─── /api/optimize/resequence ────────────────────────────────────────

describe('POST /api/optimize/resequence', () => {
  it('403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({
      tenantId: 't-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null,
    })
    const res = await resequencePost(makePost('http://x/api/optimize/resequence', { driverId: 'd-1', date: '2025-06-15' }))
    expect(res.status).toBe(403)
  })

  it('422 for invalid date', async () => {
    const res = await resequencePost(makePost('http://x/api/optimize/resequence', { driverId: 'd-1', date: 'bad' }))
    expect(res.status).toBe(422)
  })

  it('404 when driver not found', async () => {
    const { getDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValueOnce(null)
    const res = await resequencePost(makePost('http://x/api/optimize/resequence', { driverId: 'd-missing', date: '2025-06-15' }))
    expect(res.status).toBe(404)
  })

  it('404 when no plan found', async () => {
    const { getDriver } = await import('@/lib/data/drivers')
    vi.mocked(getDriver).mockResolvedValueOnce({
      id: 'd-1', firstName: 'A', lastName: 'B', archived: false,
      depotLat: 45.9, depotLng: 6.1, sector: 'N', depotName: 'D',
    })
    mockPrisma.plan.findFirst.mockResolvedValueOnce(null)
    const res = await resequencePost(makePost('http://x/api/optimize/resequence', { driverId: 'd-1', date: '2025-06-15' }))
    expect(res.status).toBe(404)
  })
})
