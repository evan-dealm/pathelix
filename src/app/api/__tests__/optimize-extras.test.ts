/**
 * Tests for:
 *   GET  /api/optimize/[jobId]
 *   POST /api/optimize/resequence
 *   GET  /api/plans/p1-risk
 *   POST /api/missions/parse-natural
 *   GET  /api/missions/queue
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  plan:                  { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  mission:               { findMany: vi.fn() },
  driver:                { findUnique: vi.fn() },
  interventionMetric:    { findMany: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/queue/vrpQueue', () => ({
  getVrpJobStatus: vi.fn(),
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => true) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/missionQueue', () => ({
  peekQueue: vi.fn(() => []),
}))

vi.mock('@/lib/data/drivers', () => ({
  getDriver: vi.fn(),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(async () => []),
}))

vi.mock('@/lib/vrp/mvAlns', () => ({
  runMvAlns: vi.fn((solution: unknown) => solution),
}))

vi.mock('@/lib/vrp/formatSolution', () => ({
  buildInitialSolution: vi.fn(() => ({ routes: [], cost: 999 })),
  formatSolutionForAPI: vi.fn(() => ({ assignments: {} })),
}))

vi.mock('@/lib/vrp/routeCost', () => ({
  computeSolutionCost: vi.fn(() => 100),
}))

vi.mock('@/lib/prismaMappers', () => ({
  prismaRowToMission: vi.fn((row: Record<string, unknown>) => row),
}))

import { GET as jobGet }               from '@/app/api/optimize/[jobId]/route'
import { POST as resequencePost }       from '@/app/api/optimize/resequence/route'
import { GET as p1RiskGet }            from '@/app/api/plans/p1-risk/route'
import { POST as parseNaturalPost }    from '@/app/api/missions/parse-natural/route'
import { GET as missionQueueGet }      from '@/app/api/missions/queue/route'
import { getVrpJobStatus }             from '@/lib/queue/vrpQueue'
import { getRequestContext, getTenantId } from '@/lib/data/context'
import { getDriver }                   from '@/lib/data/drivers'
import { peekQueue }                   from '@/lib/missionQueue'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }
function makeJobParams(jobId: string) { return { params: Promise.resolve({ jobId }) } }

// ── GET /api/optimize/[jobId] ─────────────────────────────────────────────────

describe('GET /api/optimize/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantId).mockReturnValue('tenant-1')
  })

  it('returns job status when found (200)', async () => {
    vi.mocked(getVrpJobStatus).mockResolvedValue({ status: 'completed', result: { assignments: {}, unassignedMissions: [], stats: { assignedMissions: 0, totalMissions: 0, score: 0, timeTakenMs: 0 }, warnings: [] } } as never)
    const res  = await jobGet(makeGet('http://localhost/api/optimize/tenant-1:job-123'), makeJobParams('tenant-1:job-123'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.status).toBe('completed')
  })

  it('returns 404 when job unknown', async () => {
    vi.mocked(getVrpJobStatus).mockResolvedValue({ status: 'unknown' })
    const res = await jobGet(makeGet('http://localhost/api/optimize/tenant-1:job-missing'), makeJobParams('tenant-1:job-missing'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when jobId does not start with tenantId (IDOR protection)', async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-A')
    const res = await jobGet(makeGet('http://localhost/api/optimize/tenant-B:job-123'), makeJobParams('tenant-B:job-123'))
    expect(res.status).toBe(403)
  })

  it("returns 403 for another tenant whose id merely starts with the caller's id (t_demo vs t_demo2)", async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-A')
    const res = await jobGet(makeGet('http://localhost/api/optimize/tenant-A2:job-1'), makeJobParams('tenant-A2:job-1'))
    expect(res.status).toBe(403)
  })

  it('adds Retry-After header when job is active', async () => {
    vi.mocked(getVrpJobStatus).mockResolvedValue({ status: 'active' })
    const res = await jobGet(makeGet('http://localhost/api/optimize/tenant-1:job-active'), makeJobParams('tenant-1:job-active'))
    expect(res.headers.get('Retry-After')).toBe('2')
  })

  it('returns 500 on error', async () => {
    vi.mocked(getVrpJobStatus).mockRejectedValue(new Error('Queue error'))
    const res = await jobGet(makeGet('http://localhost/api/optimize/tenant-1:job-err'), makeJobParams('tenant-1:job-err'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/optimize/resequence ─────────────────────────────────────────────

describe('POST /api/optimize/resequence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null })
    const res = await resequencePost(makePost('http://localhost/api/optimize/resequence', { driverId: 'd-1', date: '2026-05-15' }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for missing driverId', async () => {
    const res = await resequencePost(makePost('http://localhost/api/optimize/resequence', { date: '2026-05-15' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid date', async () => {
    const res = await resequencePost(makePost('http://localhost/api/optimize/resequence', { driverId: 'd-1', date: 'invalid' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/optimize/resequence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await resequencePost(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when driver not found', async () => {
    vi.mocked(getDriver).mockResolvedValue(null)
    const res = await resequencePost(makePost('http://localhost/api/optimize/resequence', { driverId: 'd-missing', date: '2026-05-15' }))
    expect(res.status).toBe(404)
  })

  it('returns 404 when no plan found for driver', async () => {
    vi.mocked(getDriver).mockResolvedValue({ id: 'd-1', tenantId: 'tenant-1', depotLat: 45.7, depotLng: 4.8 } as never)
    mockPrisma.plan.findFirst.mockResolvedValue(null)
    const res = await resequencePost(makePost('http://localhost/api/optimize/resequence', { driverId: 'd-1', date: '2026-05-15' }))
    expect(res.status).toBe(404)
  })

  it('returns message when not enough missions to resequence', async () => {
    vi.mocked(getDriver).mockResolvedValue({ id: 'd-1', tenantId: 'tenant-1', depotLat: 45.7, depotLng: 4.8 } as never)
    mockPrisma.plan.findFirst.mockResolvedValue({ id: 'p-1', driverId: 'd-1', date: '2026-05-15', missions: [{ id: 'm-1' }], statuses: {}, startTime: '07:00', speedKmh: 50 })
    mockPrisma.mission.findMany.mockResolvedValue([])
    const res  = await resequencePost(makePost('http://localhost/api/optimize/resequence', { driverId: 'd-1', date: '2026-05-15' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.message).toBeDefined()
  })
})

// ── GET /api/plans/p1-risk ────────────────────────────────────────────────────

describe('GET /api/plans/p1-risk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('returns p1Risks array for date (200)', async () => {
    mockPrisma.plan.findMany.mockResolvedValue([])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([])
    const res  = await p1RiskGet(makeGet('http://localhost/api/plans/p1-risk?date=2026-05-15'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json.p1Risks)).toBe(true)
    expect(json.date).toBe('2026-05-15')
  })

  it('returns 400 for invalid date format', async () => {
    const res = await p1RiskGet(makeGet('http://localhost/api/plans/p1-risk?date=notadate'))
    expect(res.status).toBe(400)
  })

  it('defaults to today when no date provided', async () => {
    mockPrisma.plan.findMany.mockResolvedValue([])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([])
    const res  = await p1RiskGet(makeGet('http://localhost/api/plans/p1-risk'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('computes risk scores for P1 missions', async () => {
    const missions = [
      {
        id: 'm-1', priority: 1, isSynthetic: false,
        latitude: 45.75, longitude: 4.85,
        estimatedDurationMin: 30, maneuverTimeMin: 10,
        timeWindow: { openMin: 480, closeMin: 520 },
        address: '14 rue Test',
      },
    ]
    mockPrisma.plan.findMany.mockResolvedValue([{
      driverId: 'd-1',
      missions,
      driver: { id: 'd-1', firstName: 'Jean', lastName: 'Dupont', depotLat: 45.7, depotLng: 4.8 },
    }])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([])
    const res  = await p1RiskGet(makeGet('http://localhost/api/plans/p1-risk?date=2026-05-15'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.p1Risks.length).toBeGreaterThan(0)
    expect(['low', 'medium', 'high']).toContain(json.p1Risks[0].risk)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.plan.findMany.mockRejectedValue(new Error('DB fail'))
    const res = await p1RiskGet(makeGet('http://localhost/api/plans/p1-risk?date=2026-05-15'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/missions/parse-natural ──────────────────────────────────────────

describe('POST /api/missions/parse-natural', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 503 when Ollama service unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network error') }))
    const res = await parseNaturalPost(makePost('http://localhost/api/missions/parse-natural', { text: 'Poser benne 8m3 chez Dupont BTP demain matin' }))
    expect(res.status).toBe(503)
    vi.unstubAllGlobals()
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/missions/parse-natural', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await parseNaturalPost(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when text too short (< 5 chars)', async () => {
    const res = await parseNaturalPost(makePost('http://localhost/api/missions/parse-natural', { text: 'hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when text too long (> 500 chars)', async () => {
    const res = await parseNaturalPost(makePost('http://localhost/api/missions/parse-natural', { text: 'x'.repeat(501) }))
    expect(res.status).toBe(400)
  })
})

// ── GET /api/missions/queue ───────────────────────────────────────────────────

describe('GET /api/missions/queue', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns queued missions for tenant (200)', async () => {
    vi.mocked(peekQueue).mockReturnValue([{ id: 'm-1', type: 'POSER' }] as never)
    const res  = await missionQueueGet(makeGet('http://localhost/api/missions/queue'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json)).toBe(true)
    expect(json[0].id).toBe('m-1')
  })

  it('returns empty array when queue empty', async () => {
    vi.mocked(peekQueue).mockReturnValue([])
    const res  = await missionQueueGet(makeGet('http://localhost/api/missions/queue'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toHaveLength(0)
  })

  it('returns 500 on error', async () => {
    vi.mocked(peekQueue).mockImplementation(() => { throw new Error('Queue error') })
    const res = await missionQueueGet(makeGet('http://localhost/api/missions/queue'))
    expect(res.status).toBe(500)
  })
})
