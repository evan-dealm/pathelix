/**
 * Security tests for POST /api/driver-position
 * Critical invariant: a driver can only write their own position.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockVerifySession = vi.fn()
const mockGetDriver = vi.fn()
const mockRecordOBDReading = vi.fn()
const mockEmitEvent = vi.fn()

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: (...args: unknown[]) => mockVerifySession(...args),
}))

vi.mock('@/lib/data/drivers', () => ({
  getDriver: (...args: unknown[]) => mockGetDriver(...args),
}))

vi.mock('@/lib/obdStore', () => ({
  recordOBDReading: (...args: unknown[]) => mockRecordOBDReading(...args),
  getAllCurrentPositions: vi.fn(() => []),
  getSpeedHistoryForDate: vi.fn(() => []),
  getAllSpeedHistories: vi.fn(() => ({})),
}))

vi.mock('@/lib/integrationEvents', () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/db', () => ({
  default: { driver: { findMany: vi.fn(async () => [{ id: 'driver-a' }]) } },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: unknown, cookie = 'valid-token') {
  return new NextRequest('http://localhost/api/driver-position', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: `session=${cookie}`,
    },
  })
}

const TENANT = 'tenant-1'
const DRIVER_A = 'driver-a'
const DRIVER_B = 'driver-b'

const validBody = {
  driverId: DRIVER_A,
  latitude: 45.75,
  longitude: 4.83,
  speedKmh: 30,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDriver.mockResolvedValue({ id: DRIVER_A, tenantId: TENANT })
  mockEmitEvent.mockResolvedValue(undefined)
})

// ── 1. Auth ───────────────────────────────────────────────────────────────────

describe('POST /api/driver-position — authentication', () => {
  it('returns 401 when no session cookie', async () => {
    mockVerifySession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/driver-position/route')

    const req = new NextRequest('http://localhost/api/driver-position', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when session is invalid', async () => {
    mockVerifySession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq(validBody, 'bad-token'))
    expect(res.status).toBe(401)
  })
})

// ── 2. Security: C1 — driver can only write own position ─────────────────────

describe('POST /api/driver-position — C1 own-driver security', () => {
  it('allows driver to write own position via driverRef match', async () => {
    mockVerifySession.mockResolvedValue({
      sub: 'user-a', role: 'driver', tenantId: TENANT, driverRef: DRIVER_A,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean }
    expect(json.ok).toBe(true)
  })

  it('allows driver to write own position via sub match', async () => {
    mockVerifySession.mockResolvedValue({
      sub: DRIVER_A, role: 'driver', tenantId: TENANT,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(200)
  })

  it('blocks driver from writing another driver position (403)', async () => {
    mockVerifySession.mockResolvedValue({
      sub: 'user-b', role: 'driver', tenantId: TENANT, driverRef: DRIVER_B,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    // body targets DRIVER_A but session is DRIVER_B
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(403)
    const json = await res.json() as { error: string }
    expect(json.error).toMatch(/Accès refusé/i)
  })

  it('allows admin to write any driver position', async () => {
    mockVerifySession.mockResolvedValue({
      sub: 'admin-1', role: 'admin', tenantId: TENANT,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(200)
  })

  it('allows dispatcher to write any driver position', async () => {
    mockVerifySession.mockResolvedValue({
      sub: 'dispatch-1', role: 'dispatcher', tenantId: TENANT,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq(validBody))
    expect(res.status).toBe(200)
  })
})

// ── 3. Validation ─────────────────────────────────────────────────────────────

describe('POST /api/driver-position — input validation', () => {
  beforeEach(() => {
    mockVerifySession.mockResolvedValue({
      sub: DRIVER_A, role: 'driver', tenantId: TENANT,
    })
  })

  it('rejects NaN latitude (schema validation → 422)', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, latitude: 'not-a-number' }))
    expect(res.status).toBe(422)
  })

  it('rejects latitude > 90 (out of range)', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, latitude: 91 }))
    expect(res.status).toBe(422)
  })

  it('rejects latitude < -90', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, latitude: -91 }))
    expect(res.status).toBe(422)
  })

  it('rejects longitude > 180', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, longitude: 181 }))
    expect(res.status).toBe(422)
  })

  it('rejects speedKmh > 200', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, speedKmh: 201 }))
    expect(res.status).toBe(422)
  })

  it('rejects invalid JSON body', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const req = new NextRequest('http://localhost/api/driver-position', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json', cookie: 'session=valid-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects invalid timestamp', async () => {
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, timestamp: 'not-a-date' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when driver not found in tenant', async () => {
    // POST uses getTenantDriverIds cache — use unique tenant + nonexistent driverId
    mockVerifySession.mockResolvedValue({ sub: 'u', role: 'driver', tenantId: 'tenant-404', driverRef: 'nonexistent' })
    const { POST } = await import('@/app/api/driver-position/route')
    const res = await POST(makeReq({ ...validBody, driverId: 'nonexistent' }))
    expect(res.status).toBe(404)
  })
})

// ── 4. Happy path: position recorded ─────────────────────────────────────────

describe('POST /api/driver-position — position recording', () => {
  it('calls recordOBDReading with correct coords', async () => {
    mockVerifySession.mockResolvedValue({
      sub: DRIVER_A, role: 'driver', tenantId: TENANT,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    await POST(makeReq(validBody))

    expect(mockRecordOBDReading).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: DRIVER_A,
        lat: 45.75,
        lng: 4.83,
        speedKmh: 30,
      }),
    )
  })

  it('emits driver.position event', async () => {
    mockVerifySession.mockResolvedValue({
      sub: DRIVER_A, role: 'driver', tenantId: TENANT,
    })
    const { POST } = await import('@/app/api/driver-position/route')
    await POST(makeReq(validBody))

    expect(mockEmitEvent).toHaveBeenCalledWith(
      TENANT, 'driver.position',
      expect.objectContaining({ driverId: DRIVER_A, latitude: 45.75 }),
    )
  })
})
