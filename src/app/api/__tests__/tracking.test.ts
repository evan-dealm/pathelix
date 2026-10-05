import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
const mockVerifySession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session', () => ({ verifySession: mockVerifySession, SESSION_COOKIE: 'session' }))

const mockMissionFindFirst = vi.hoisted(() => vi.fn())
const mockMissionUpdate    = vi.hoisted(() => vi.fn())
const mockPlanFindMany     = vi.hoisted(() => vi.fn())
const mockPosFindFirst     = vi.hoisted(() => vi.fn())
const mockTrackingDb = vi.hoisted(() => ({
  mission:        { findFirst: mockMissionFindFirst, update: mockMissionUpdate },
  plan:           { findMany:  mockPlanFindMany },
  driverPosition: { findFirst: mockPosFindFirst },
}))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: mockTrackingDb,
  getTenantDb:    () => mockTrackingDb,
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
    headers: { 'content-type': 'application/json', cookie: 'session=tok' },
    body: JSON.stringify(body),
  })
}

const VALID_TOKEN = 'A'.repeat(32)
const FUTURE = new Date(Date.now() + 86_400_000)

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifySession.mockResolvedValue({ sub: 'u1', role: 'admin', tenantId: 't1', exp: 9999999999 })
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
    const res = await GET(makeGET(VALID_TOKEN))
    expect(res.status).toBe(404)
  })

  it('returns 404 without hitting the DB for a malformed token (e.g. a legacy JWT)', async () => {
    const res = await GET(makeGET('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0cmFjazptMSJ9.sig'))
    expect(res.status).toBe(404)
    expect(mockMissionFindFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when the tracking link has expired', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm1', type: 'POSER', address: '1 Rue Test', clientName: 'A',
      completedAt: null, cancelledAt: null, driverComment: '', actualDurationMin: null,
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: new Date(Date.now() - 1000),
      latitude: 48.85, longitude: 2.35,
    })
    const res = await GET(makeGET(VALID_TOKEN))
    expect(res.status).toBe(404)
  })

  it('looks up plans on the mission date, not on the server clock', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm9', type: 'POSER', address: 'x', clientName: 'x',
      completedAt: null, cancelledAt: null, driverComment: '', actualDurationMin: null,
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.85, longitude: 2.35,
    })
    mockPlanFindMany.mockResolvedValueOnce([])
    await GET(makeGET(VALID_TOKEN))
    expect(mockPlanFindMany.mock.calls[0][0].where).toEqual({ date: '2026-06-15' })
  })

  it('returns status=completed when completedAt is set', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm1', type: 'POSER', address: '1 Rue Test', clientName: 'Client A',
      completedAt: new Date('2026-06-15T10:00:00Z'),
      cancelledAt: null,
      driverComment: 'RAS', actualDurationMin: 30,
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.85, longitude: 2.35,
    })
    const res = await GET(makeGET(VALID_TOKEN))
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
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.85, longitude: 2.35,
    })
    const res = await GET(makeGET(VALID_TOKEN))
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
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.85, longitude: 2.35,
    })
    mockPlanFindMany.mockResolvedValueOnce([])
    const res = await GET(makeGET(VALID_TOKEN))
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
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.85, longitude: 2.35,
    })
    mockPlanFindMany.mockResolvedValueOnce([
      { driverId: 'd1', missions: [{ id: 'm3' }] },
    ])
    mockPosFindFirst.mockResolvedValueOnce(null)
    const res = await GET(makeGET(VALID_TOKEN))
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
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE,
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
    const res = await GET(makeGET(VALID_TOKEN))
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
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.85, longitude: 2.35,
    })
    // Plan contains different mission id
    mockPlanFindMany.mockResolvedValueOnce([
      { driverId: 'd3', missions: [{ id: 'other-mission' }] },
    ])
    const res = await GET(makeGET(VALID_TOKEN))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.eta).toBeNull()
    // driverPosition should not have been queried
    expect(mockPosFindFirst).not.toHaveBeenCalled()
  })

  it('returns 500 on DB error', async () => {
    mockMissionFindFirst.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeGET(VALID_TOKEN))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/erreur serveur/i)
  })

  it('includes mission fields in response', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      id: 'm6', type: 'CHARGER_IMMEDIAT', address: '7 Av de la Gare', clientName: 'ACME',
      completedAt: new Date(), cancelledAt: null,
      driverComment: 'Bonne livraison', actualDurationMin: 15,
      tenantId: 't1', date: '2026-06-15', trackingTokenExpiresAt: FUTURE, latitude: 48.0, longitude: 2.0,
    })
    const res = await GET(makeGET(VALID_TOKEN))
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
  it('returns 401 without a session', async () => {
    mockVerifySession.mockResolvedValueOnce(null)
    const res = await POST(makePOST({ missionId: 'm1' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for a driver session (staff only)', async () => {
    mockVerifySession.mockResolvedValueOnce({ sub: 'd1', driverRef: 'd1', role: 'driver', tenantId: 't1', exp: 9999999999 })
    const res = await POST(makePOST({ missionId: 'm1' }))
    expect(res.status).toBe(403)
    expect(mockMissionFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/tracking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=tok' },
      body: 'not json{{{',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when missionId is missing', async () => {
    const res = await POST(makePOST({}))
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

  it('returns the existing token while it is still valid', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: 'm1', trackingToken: VALID_TOKEN, trackingTokenExpiresAt: FUTURE })
    const res = await POST(makePOST({ missionId: 'm1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).token).toBe(VALID_TOKEN)
    expect(mockMissionUpdate).not.toHaveBeenCalled()
  })

  it('creates a new opaque token (not a JWT) with a ~7 day expiry', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: 'm2', trackingToken: null, trackingTokenExpiresAt: null })
    mockMissionUpdate.mockResolvedValueOnce({})
    const res = await POST(makePOST({ missionId: 'm2' }))
    expect(res.status).toBe(200)
    const { token } = await res.json()
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(token.split('.')).toHaveLength(1)
    const data = mockMissionUpdate.mock.calls[0][0].data
    expect(data.trackingToken).toBe(token)
    const ttl = data.trackingTokenExpiresAt.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(6.9 * 86_400_000)
    expect(ttl).toBeLessThanOrEqual(7 * 86_400_000)
  })

  it('replaces an expired token instead of returning it', async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: 'm3', trackingToken: VALID_TOKEN, trackingTokenExpiresAt: new Date(Date.now() - 1) })
    mockMissionUpdate.mockResolvedValueOnce({})
    const { token } = await (await POST(makePOST({ missionId: 'm3' }))).json()
    expect(token).not.toBe(VALID_TOKEN)
  })
})
