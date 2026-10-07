/**
 * Scale tests for /api/driver-position
 * Validates caching behavior under high-frequency polling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockVerifySession = vi.fn()
const mockGetDriver = vi.fn()
const mockEmitEvent = vi.fn()
const mockLatestPositions = vi.fn()
const mockSpeedHistory = vi.fn()
const mockPositionCreateMany = vi.fn(async (_args: unknown) => ({ count: 1 }))

vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    driver: {
      findMany:  (args: unknown) => mockFindMany(args),
      findFirst: (args: unknown) => mockFindFirst(args),
    },
    driverPosition: { createMany: (args: unknown) => mockPositionCreateMany(args) },
    tenantSettings: { findUnique: vi.fn(async () => ({ timezone: 'Europe/Paris' })) },
  }),
}))
vi.mock('@/lib/positions', () => ({
  latestPositions: (...args: unknown[]) => mockLatestPositions(...args),
  speedHistory:    (...args: unknown[]) => mockSpeedHistory(...args),
}))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession:  (...args: unknown[]) => mockVerifySession(...args),
}))
vi.mock('@/lib/data/drivers', () => ({
  getDriver: (...args: unknown[]) => mockGetDriver(...args),
}))
vi.mock('@/lib/integrationEvents', () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const ADMIN_SESSION = { sub: 'user-1', role: 'admin' as const, tenantId: 'tenant-perf', iat: 0, exp: 9999999999 }
const DRIVER_IDS = Array.from({ length: 150 }, (_, i) => `driver-${i + 1}`)

function makeGetReq(date = '2026-06-19'): NextRequest {
  return new NextRequest(`http://localhost/api/driver-position?date=${date}`, {
    headers: { Cookie: 'session=token' },
  })
}

function makePostReq(driverId: string): NextRequest {
  return new NextRequest('http://localhost/api/driver-position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'session=token' },
    body: JSON.stringify({ driverId, latitude: 45.7, longitude: 4.8, speedKmh: 50 }),
  })
}

import { GET, POST } from '@/app/api/driver-position/route'

describe('GET /api/driver-position — positions lues en base sous volume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifySession.mockResolvedValue(ADMIN_SESSION)
    mockFindMany.mockResolvedValue(DRIVER_IDS.map(id => ({ id })))
    mockLatestPositions.mockResolvedValue(
      DRIVER_IDS.map((id, i) => ({ driverId: id, lat: 45.7 + i * 0.001, lng: 4.8, speedKmh: 50, ignition: true, updatedAt: Date.now() })),
    )
    mockSpeedHistory.mockResolvedValue({})
  })

  // Positions come from the table shared by every instance; the cost must not grow with the fleet.
  it('une requête GET lit 150 chauffeurs en 2 lectures (dernières positions + historique), pas une par chauffeur', async () => {
    await GET(makeGetReq())
    expect(mockLatestPositions).toHaveBeenCalledTimes(1)
    expect(mockLatestPositions).toHaveBeenCalledWith('tenant-perf', expect.objectContaining({ since: expect.any(Date) }))
    expect(mockSpeedHistory).toHaveBeenCalledTimes(1)
    expect(mockSpeedHistory).toHaveBeenCalledWith('tenant-perf', '2026-06-19', 'Europe/Paris')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  // The live map polls every 15 s and never draws the speed graph.
  it("history=0 : la carte ne paie pas l'historique de la journée", async () => {
    const res = await GET(new NextRequest('http://localhost/api/driver-position?date=2026-06-19&history=0', { headers: { Cookie: 'session=token' } }))
    expect(res.status).toBe(200)
    expect((await res.json()).positions).toHaveLength(150)
    expect(mockSpeedHistory).not.toHaveBeenCalled()
  })

  it('30 requêtes GET simultanées répondent toutes 200', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => GET(makeGetReq())))
    expect(results.every(r => r.status === 200)).toBe(true)
    expect(mockLatestPositions).toHaveBeenCalledTimes(30)
  })

  it('réponse GET contient positions des 150 chauffeurs', async () => {
    const res  = await GET(makeGetReq())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json.positions)).toBe(true)
    expect(json.positions.length).toBe(150)
  })
})

describe('POST /api/driver-position — driver validation sous volume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Admin/dispatcher peut poster pour n'importe quel chauffeur du tenant
    mockVerifySession.mockResolvedValue(ADMIN_SESSION)
    // Each driver exists and belongs to tenant
    mockGetDriver.mockImplementation(async (_tenantId: string, driverId: string) =>
      DRIVER_IDS.includes(driverId) ? { id: driverId, tenantId: 'tenant-perf' } : null,
    )
    mockFindMany.mockResolvedValue(DRIVER_IDS.map(id => ({ id })))
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('POST position accepté sans erreur pour un chauffeur valide', async () => {
    const res = await POST(makePostReq('driver-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('60 requêtes POST simultanées (6 chauffeurs × 10 updates) toutes acceptées', async () => {
    const requests = Array.from({ length: 60 }, (_, i) =>
      POST(makePostReq(`driver-${(i % 6) + 1}`)),
    )
    const results = await Promise.all(requests)
    const successes = results.filter(r => r.status === 200).length
    expect(successes).toBe(60)
    // Every accepted position is written before the 200: nothing left in process memory.
    expect(mockPositionCreateMany).toHaveBeenCalledTimes(60)
  })
})
