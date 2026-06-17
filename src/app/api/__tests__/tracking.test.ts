import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
}))

const mockSignSession = vi.hoisted(() => vi.fn(async (_payload: unknown) => 'new-tracking-token'))
vi.mock('@/lib/session', () => ({ signSession: mockSignSession }))

const mockMissionFindFirst = vi.hoisted(() => vi.fn())
const mockMissionUpdate    = vi.hoisted(() => vi.fn())
const mockPlanFindMany     = vi.hoisted(() => vi.fn())
const mockPosFindFirst     = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    mission:        { findFirst: mockMissionFindFirst, update: mockMissionUpdate },
    plan:           { findMany:  mockPlanFindMany },
    driverPosition: { findFirst: mockPosFindFirst },
  },
}))

import { GET, POST } from '@/app/api/tracking/route'

function makeGET(token?: string) {
  const url = new URL('http://localhost/api/tracking')
  if (token !== undefined) url.searchParams.set('token', token)
  return new NextRequest(url)
}

function makePOST(body: unknown) {
  return new NextRequest('http://localhost/api/tracking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/tracking', () => {
  it('returns 400 when token param absent', async () => {
    const res = await GET(makeGET())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/token/i)
  })

  it('returns 404 when token not found in DB', async () => {
    mockMissionFindFirst.mockResolvedValueOnce(null)
    const res = await GET(makeGET('unknown-token'))
    expect(res.status).toBe(404)
  })

  it('returns status=completed when completedAt is set', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm1', type: 'POSER', address: '1 Rue Test', clientName: 'Client A',
      completedAt: new Date('2026-06-15T10:00:00Z'),
      cancelledAt: null,
      driverComment: 'RAS', actualDurationMin: 30,
      tenantId: 't1', latitude: 48.85, longitude: 2.35,
    })
    const res = await GET(makeGET('tok'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.status).toBe('completed')
    expect(body.eta).toBeNull()
  })

  it('returns status=cancelled when cancelledAt is set', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm1', type: 'RETIRER', address: '2 Rue Test', clientName: 'Client B',
      completedAt: null,
      cancelledAt: new Date('2026-06-15T09:00:00Z'),
      driverComment: null, actualDurationMin: null,
      tenantId: 't1', latitude: 48.85, longitude: 2.35,
    })
    const res = await GET(makeGET('tok-cancel'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.status).toBe('cancelled')
    expect(body.eta).toBeNull()
  })

  it('returns status=in_progress with eta=null when no plan contains the mission', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm2', type: 'ECHANGER', address: '3 Rue Test', clientName: 'Client C',
      completedAt: null, cancelledAt: null,
      driverComment: null, actualDurationMin: null,
      tenantId: 't1', latitude: 48.85, longitude: 2.35,
    })
    mockPlanFindMany.mockResolvedValueOnce([])
    const res = await GET(makeGET('tok-progress'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.status).toBe('in_progress')
    expect(body.eta).toBeNull()
  })

  it('returns eta=null when plan found but no recent driver position', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm3', type: 'POSER', address: '4 Rue Test', clientName: 'Client D',
      completedAt: null, cancelledAt: null,
      driverComment: null, actualDurationMin: null,
      tenantId: 't1', latitude: 48.85, longitude: 2.35,
    })
    mockPlanFindMany.mockResolvedValueOnce([
      { driverId: 'd1', missions: [{ id: 'm3' }] },
    ])
    mockPosFindFirst.mockResolvedValueOnce(null)
    const res = await GET(makeGET('tok-no-pos'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.status).toBe('in_progress')
    expect(body.eta).toBeNull()
  })

  it('computes ETA when driver position is recent', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm4', type: 'VIDER', address: '5 Rue Test', clientName: 'Client E',
      completedAt: null, cancelledAt: null,
      driverComment: null, actualDurationMin: null,
      tenantId: 't1',
      latitude:  48.8000,
      longitude: 2.3000,
    })
    mockPlanFindMany.mockResolvedValueOnce([
      { driverId: 'd2', missions: [{ id: 'm4' }] },
    ])
    mockPosFindFirst.mockResolvedValueOnce({
      latitude:   48.8566,
      longitude:  2.3522,
      recordedAt: new Date(),
    })
    const res = await GET(makeGET('tok-eta'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.status).toBe('in_progress')
    expect(body.eta).not.toBeNull()
    expect(body.eta.minutes).toBeGreaterThanOrEqual(1)
    expect(typeof body.eta.distanceKm).toBe('number')
    expect(typeof body.eta.driverLat).toBe('number')
    expect(typeof body.eta.driverLng).toBe('number')
  })

  it('skips plan when missions array does not include the mission', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm5', type: 'POSER', address: '6 Rue Test', clientName: 'Client F',
      completedAt: null, cancelledAt: null,
      driverComment: null, actualDurationMin: null,
      tenantId: 't1', latitude: 48.85, longitude: 2.35,
    })
    // Plan contains different mission id
    mockPlanFindMany.mockResolvedValueOnce([
      { driverId: 'd3', missions: [{ id: 'other-mission' }] },
    ])
    const res = await GET(makeGET('tok-skip'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.eta).toBeNull()
    // driverPosition should not have been queried
    expect(mockPosFindFirst).not.toHaveBeenCalled()
  })

  it('returns 500 on DB error', async () => {
    mockMissionFindFirst.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeGET('tok-err'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/erreur serveur/i)
  })

  it('includes mission fields in response', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm6', type: 'CHARGER_IMMEDIAT', address: '7 Av de la Gare', clientName: 'ACME',
      completedAt: new Date(), cancelledAt: null,
      driverComment: 'Bonne livraison', actualDurationMin: 15,
      tenantId: 't1', latitude: 48.0, longitude: 2.0,
    })
    const res = await GET(makeGET('tok-fields'))
    const body = await res.json()
    expect(body.mission).toMatchObject({
      id:            'm6',
      type:          'CHARGER_IMMEDIAT',
      address:       '7 Av de la Gare',
      clientName:    'ACME',
      status:        'completed',
      driverComment: 'Bonne livraison',
    })
  })
})

// ─── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/tracking', () => {
  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/tracking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json{{{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when missionId is missing', async () => {
    const res = await POST(makePOST({}))
    expect(res.status).toBe(422)
  })

  it('returns 422 when missionId is empty string', async () => {
    const res = await POST(makePOST({ missionId: '' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when missionId exceeds 100 chars', async () => {
    const res = await POST(makePOST({ missionId: 'x'.repeat(101) }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when mission not found', async () => {
    mockMissionFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makePOST({ missionId: 'ghost-mission' }))
    expect(res.status).toBe(404)
  })

  it('returns existing token without creating new one', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: 'm1', trackingToken: 'existing-token' })
    const res = await POST(makePOST({ missionId: 'm1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('existing-token')
    expect(mockSignSession).not.toHaveBeenCalled()
    expect(mockMissionUpdate).not.toHaveBeenCalled()
  })

  it('creates and stores new token when mission has none', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: 'm2', trackingToken: null })
    mockMissionUpdate.mockResolvedValueOnce({})
    const res = await POST(makePOST({ missionId: 'm2' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('new-tracking-token')
    expect(mockSignSession).toHaveBeenCalledOnce()
    expect(mockSignSession.mock.calls[0][0]).toMatchObject({
      sub:     'track:m2',
      role:    'driver',
      tenantId: 't1',
    })
    expect(mockMissionUpdate).toHaveBeenCalledWith({
      where: { id: 'm2' },
      data:  { trackingToken: 'new-tracking-token' },
    })
  })

  it('token exp set ~7 days from now', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: 'm3', trackingToken: null })
    mockMissionUpdate.mockResolvedValueOnce({})
    await POST(makePOST({ missionId: 'm3' }))
    const payload = mockSignSession.mock.calls[0][0] as { exp: number }
    const sevenDays = 7 * 86400
    const now = Math.floor(Date.now() / 1000)
    expect(payload.exp).toBeGreaterThan(now + sevenDays - 10)
    expect(payload.exp).toBeLessThan(now + sevenDays + 10)
  })
})
