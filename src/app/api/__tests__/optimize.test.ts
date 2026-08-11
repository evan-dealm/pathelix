import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { MissionType } from '@/lib/types'

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId: vi.fn(() => 'tenant-test'),
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
  getAllExutoires: vi.fn(),
}))

vi.mock('@/lib/missionQueue', () => ({
  drainByDate: vi.fn(() => []),
}))

vi.mock('@/lib/loadShedder', () => ({
  loadShedder: {
    acquire: vi.fn(() => 'ok'),
    release: vi.fn(),
  },
  shedResponse: vi.fn(() => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ error: 'Service surchargé' }, { status: 503 })
  }),
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({
    check:   vi.fn(() => true),
    headers: vi.fn(() => ({ 'X-RateLimit-Limit': '10', 'X-RateLimit-Remaining': '9' })),
  }),
  createTenantRateLimiter: () => ({
    check:   vi.fn(() => true),
    headers: vi.fn(() => ({})),
  }),
  getClientIp:         vi.fn(() => '127.0.0.1'),
  getTenantPlanLimit:  vi.fn(() => Promise.resolve(10)),
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: {
    increment: vi.fn(),
    histogram: vi.fn(),
  },
  METRIC: {
    API_LATENCY_MS: 'api.latency_ms',
    API_REQUESTS:   'api.requests',
    API_ERRORS:     'api.errors',
    VRP_ENQUEUED:   'vrp.enqueued',
  },
}))

vi.mock('@/lib/db', () => ({
  default: {
    tenantSettings: {
      findUnique: vi.fn(() => Promise.resolve(null)),
    },
  },
}))

vi.mock('@/lib/queue/vrpQueue', () => ({
  enqueueVrpJob: vi.fn(() => Promise.reject(new Error('Redis unavailable'))),
  getVrpQueue:   vi.fn(() => ({ getWorkers: vi.fn(() => Promise.resolve([])) })),
}))

vi.mock('@/lib/vrp', () => ({
  runVRP: vi.fn(() => ({
    assignments:        { 'd-1': [] },
    unassignedMissions: [],
    stats:              { assignedMissions: 0, totalMissions: 0, score: 0, timeTakenMs: 100 },
    warnings:           [],
  })),
}))

import { POST } from '@/app/api/optimize/route'
import { getAllDrivers } from '@/lib/data/drivers'
import { getMissionsByDate } from '@/lib/data/missions'
import { getAllExutoires } from '@/lib/data/exutoires'
import { loadShedder } from '@/lib/loadShedder'
import { runVRP } from '@/lib/vrp'
import { hasPermission } from '@/lib/permissions'
import { getRequestContext } from '@/lib/data/context'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/optimize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const sampleDriver = {
  id: 'd-1', firstName: 'Jean', lastName: 'Dupont',
  sector: 'Nord', depotName: 'D', depotLat: 45.76, depotLng: 4.83,
}

const sampleMission = {
  id: 'm-1', type: 'POSER' as MissionType, date: '2026-03-18',
  address: 'Test', latitude: 45.77, longitude: 4.84,
  estimatedDurationMin: 15, maneuverTimeMin: 5,
}

describe('POST /api/optimize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadShedder.acquire).mockReturnValue('ok')
    vi.mocked(getAllDrivers).mockResolvedValue([sampleDriver])
    vi.mocked(getMissionsByDate).mockResolvedValue([sampleMission])
    vi.mocked(getAllExutoires).mockResolvedValue([])
  })

  it('triggers optimization with valid request', async () => {
    const res  = await POST(makeRequest({ date: '2026-03-18', driverIds: ['d-1'] }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(runVRP).toHaveBeenCalled()
    expect(json.result).toBeDefined()
  })

  it('rejects invalid date format (422)', async () => {
    const res = await POST(makeRequest({ date: 'not-a-date' }))
    expect(res.status).toBe(422)
  })

  it('rejects missing date (422)', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(422)
  })

  it('returns 422 when no drivers available', async () => {
    vi.mocked(getAllDrivers).mockResolvedValue([])

    const res = await POST(makeRequest({ date: '2026-03-18' }))
    expect(res.status).toBe(422)

    const json = await res.json()
    expect(json.error).toContain('chauffeur')
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/optimize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{broken',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 503 when load shedder rejects', async () => {
    vi.mocked(loadShedder.acquire).mockReturnValue('shed')

    const res = await POST(makeRequest({ date: '2026-03-18' }))
    expect(res.status).toBe(503)
  })

  it('filters drivers by driverIds when provided', async () => {
    const drivers = [
      { ...sampleDriver, id: 'd-1' },
      { ...sampleDriver, id: 'd-2' },
    ]
    vi.mocked(getAllDrivers).mockResolvedValue(drivers)

    await POST(makeRequest({ date: '2026-03-18', driverIds: ['d-1'] }))

    expect(runVRP).toHaveBeenCalled()
    const call = vi.mocked(runVRP).mock.calls[0]
    if (call) {
      const passedDrivers = call[1] as typeof drivers
      expect(passedDrivers).toHaveLength(1)
      expect(passedDrivers[0].id).toBe('d-1')
    }
  })

  it('releases load shedder slot even on error', async () => {
    vi.mocked(getAllDrivers).mockRejectedValue(new Error('DB error'))

    await POST(makeRequest({ date: '2026-03-18' }))

    expect(loadShedder.release).toHaveBeenCalled()
  })

  it('passes options to VRP engine', async () => {
    await POST(makeRequest({
      date:    '2026-03-18',
      options: { timeBudgetMs: 5000, seed: 99 },
    }))

    expect(runVRP).toHaveBeenCalled()
    const call = vi.mocked(runVRP).mock.calls[0]
    if (call) {
      const opts = call[4] as { timeBudgetMs?: number; seed?: number } | undefined
      expect(opts?.timeBudgetMs).toBe(5000)
      expect(opts?.seed).toBe(99)
    }
  })

  it('rejects timeBudgetMs above 300000 (422) — regression: budget non borné', async () => {
    const res = await POST(makeRequest({
      date:    '2026-03-18',
      options: { timeBudgetMs: 3_600_000 },
    }))
    expect(res.status).toBe(422)
  })

  it('caps direct-mode time budget at 15s — regression: fallback synchrone monopolisait le process web', async () => {
    await POST(makeRequest({
      date:    '2026-03-18',
      options: { timeBudgetMs: 120_000 },
    }))

    expect(runVRP).toHaveBeenCalled()
    const call = vi.mocked(runVRP).mock.calls.at(-1)
    const opts = call?.[4] as { timeBudgetMs?: number } | undefined
    expect(opts?.timeBudgetMs).toBeLessThanOrEqual(15_000)
  })

  it('returns 403 when user lacks optimize permission (driver role)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'driver-1', role: 'driver', requestId: 'req-1', trade: null })
    vi.mocked(hasPermission).mockResolvedValue(false)
    const res = await POST(makeRequest({ date: '2026-03-18' }))
    expect(res.status).toBe(403)
  })
})
