/**
 * Tests the weekly-plan API result contract consumed by WeeklyPlanTab:
 * - result keys must be YYYY-MM-DD dates (not day names)
 * - each day entry has missions, score fields
 * - skipped days have skipped:true and missions:0
 * - response shape: { id, weekStart, status, result }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

const mockRunVRP = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  weeklyPlan: {
    findUnique: vi.fn(),
    findMany:   vi.fn(),
    upsert:     vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),
  },
  mission: { findMany: vi.fn() },
  plan:    { upsert:   vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/data/drivers', () => ({
  getAllDrivers: vi.fn(() => Promise.resolve([
    { id: 'd-1', firstName: 'Bob', lastName: 'D', sector: 'S1', depotName: 'Depot', depotLat: 45.0, depotLng: 5.0, archived: false },
  ])),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getAllExutoires: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/vrp/index', () => ({ runVRP: mockRunVRP }))

import { POST, GET } from '@/app/api/weekly-plan/route'
import { getRequestContext } from '@/lib/data/context'

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/weekly-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeGet(params = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/weekly-plan${params}`)
}

const VRP_RESULT = {
  assignments: { 'd-1': [{ id: 'm-1', sequenceOrder: 1 }] },
  unassignedMissions: [],
  stats: { assignedMissions: 1, totalMissions: 1, score: 82, timeTakenMs: 300, totalDistanceKm: 45.5 },
  warnings: [],
}

const MISSION_ROW = {
  id: 'm-1', type: 'POSER', date: '2026-01-05', address: '1 rue test',
  latitude: 48.86, longitude: 2.33, estimatedDurationMin: 30, maneuverTimeMin: 15,
  clientName: null, wasteTypeLabel: null, priority: null, linkedExutoireId: null,
  accessNotes: null, binSize: null, binSizeM3: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.weeklyPlan.upsert.mockResolvedValue({ id: 'wp-1', status: 'optimizing' })
  mockPrisma.weeklyPlan.update.mockResolvedValue({ id: 'wp-1', status: 'published' })
  mockPrisma.plan.upsert.mockResolvedValue({})
  mockRunVRP.mockResolvedValue(VRP_RESULT)
})

describe('GET /api/weekly-plan', () => {
  it('returns 404 when specific week not found', async () => {
    mockPrisma.weeklyPlan.findUnique.mockResolvedValue(null)
    const res = await GET(makeGet('?weekStart=2026-01-05'))
    expect(res.status).toBe(404)
  })

  it('returns plan when found', async () => {
    mockPrisma.weeklyPlan.findUnique.mockResolvedValue({ id: 'wp-1', weekStart: '2026-01-05', status: 'published', result: {} })
    const res = await GET(makeGet('?weekStart=2026-01-05'))
    expect(res.status).toBe(200)
  })

  it('returns list when no weekStart param', async () => {
    mockPrisma.weeklyPlan.findMany.mockResolvedValue([{ id: 'wp-1', weekStart: '2026-01-05', status: 'published', createdAt: new Date(), createdBy: 'u1' }])
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /api/weekly-plan — result contract for WeeklyPlanTab', () => {
  it('result keys are YYYY-MM-DD dates (not day names)', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([MISSION_ROW])
    const res = await POST(makePost({ weekStart: '2026-01-05' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    const keys = Object.keys(body.result)
    keys.forEach(k => {
      expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  it('response includes id, weekStart, status, result', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([])
    const res = await POST(makePost({ weekStart: '2026-01-05' }))
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('weekStart', '2026-01-05')
    expect(body).toHaveProperty('status', 'published')
    expect(body).toHaveProperty('result')
  })

  it('day with no missions → result entry has missions:0 and skipped:true', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([])
    const res = await POST(makePost({ weekStart: '2026-01-05' }))
    const body = await res.json()
    const firstDay = body.result['2026-01-05']
    expect(firstDay).toBeDefined()
    expect(firstDay.missions).toBe(0)
    expect(firstDay.skipped).toBe(true)
  })

  it('day with missions → result entry has missions count and score', async () => {
    mockPrisma.mission.findMany.mockImplementation(({ where }: { where: { date: string } }) => {
      if (where.date === '2026-01-05') return Promise.resolve([MISSION_ROW])
      return Promise.resolve([])
    })
    const res = await POST(makePost({ weekStart: '2026-01-05' }))
    const body = await res.json()
    const day = body.result['2026-01-05']
    expect(day).toBeDefined()
    expect(day.missions).toBeGreaterThan(0)
    expect(day.score).toBeDefined()
  })

  it('covers all 5 weekdays starting from weekStart', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([])
    const res = await POST(makePost({ weekStart: '2026-01-05' }))
    const body = await res.json()
    const keys = Object.keys(body.result)
    expect(keys.length).toBe(5)
    expect(keys[0]).toBe('2026-01-05')
    expect(keys[4]).toBe('2026-01-09')
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValueOnce({ tenantId: 't', userId: 'u', role: 'driver' } as never)
    const res = await POST(makePost({ weekStart: '2026-01-05' }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid weekStart format', async () => {
    const res = await POST(makePost({ weekStart: 'not-a-date' }))
    expect(res.status).toBe(422)
  })

  it('missions query filters needsGeocode=false', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([MISSION_ROW])
    await POST(makePost({ weekStart: '2026-01-05' }))
    const callArgs = mockPrisma.mission.findMany.mock.calls[0][0]
    expect(callArgs.where.needsGeocode).toBe(false)
  })
})
