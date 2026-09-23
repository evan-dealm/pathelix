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
const mockRecordOBDReading = vi.fn()
const mockEmitEvent = vi.fn()
const mockGetAllCurrentPositions = vi.fn(() => [])
const mockGetAllSpeedHistories = vi.fn(() => ({}))

vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    driver: {
      findMany:  (args: unknown) => mockFindMany(args),
      findFirst: (args: unknown) => mockFindFirst(args),
    },
    driverPosition: { createMany: vi.fn(async () => ({ count: 0 })) },
  }),
}))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession:  (...args: unknown[]) => mockVerifySession(...args),
}))
vi.mock('@/lib/data/drivers', () => ({
  getDriver: (...args: unknown[]) => mockGetDriver(...args),
}))
vi.mock('@/lib/obdStore', () => ({
  recordOBDReading:        (r: unknown) => mockRecordOBDReading(r),
  getAllCurrentPositions:   () => mockGetAllCurrentPositions(),
  getAllSpeedHistories:     () => mockGetAllSpeedHistories(),
  getSpeedHistoryForDate:  vi.fn(() => []),
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

describe('GET /api/driver-position — cache driver IDs sous volume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifySession.mockResolvedValue(ADMIN_SESSION)
    mockFindMany.mockResolvedValue(DRIVER_IDS.map(id => ({ id })))
    mockGetAllCurrentPositions.mockReturnValue(
      DRIVER_IDS.map((id, i) => ({ driverId: id, lat: 45.7 + i * 0.001, lng: 4.8, speedKmh: 50, ignition: true, updatedAt: Date.now() })) as ReturnType<typeof mockGetAllCurrentPositions>,
    )
    mockGetAllSpeedHistories.mockReturnValue({})
  })

  it('30 requêtes GET simultanées ne font qu\'une seule requête DB findMany (cache actif)', async () => {
    // Warm cache with first call
    await GET(makeGetReq())
    const callsAfterWarm = mockFindMany.mock.calls.length

    // 29 more calls — should all hit cache
    await Promise.all(Array.from({ length: 29 }, () => GET(makeGetReq())))

    // Cache should have absorbed all subsequent calls
    expect(mockFindMany.mock.calls.length).toBe(callsAfterWarm)
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
    mockRecordOBDReading.mockReturnValue(undefined)
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
  })
})
