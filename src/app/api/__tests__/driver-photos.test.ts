import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockVerifySession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session', () => ({
  verifySession:  mockVerifySession,
  SESSION_COOKIE: 'session',
}))

const mockDriverFindUnique = vi.hoisted(() => vi.fn())
const mockPlanFindFirst    = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { driver: { findUnique: mockDriverFindUnique } },
  getTenantDb:    () => ({ plan: { findFirst: mockPlanFindFirst } }),
}))

// fs mocks — used only in real mode tests
const mockMkdir     = vi.hoisted(() => vi.fn(async () => undefined))
const mockReaddir   = vi.hoisted(() => vi.fn(async () => [] as string[]))
const mockWriteFile = vi.hoisted(() => vi.fn(async () => undefined))
const mockUnlink    = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ name: 'local', put: mockWriteFile, get: vi.fn(async () => null), delete: mockUnlink, list: mockReaddir }),
  localRoot: () => '/tmp/uploads',
}))

import { GET, POST, DELETE } from '@/app/api/driver-photos/route'

const VALID_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const SESSION = { tenantId: 't1', userId: 'u1', role: 'admin' as const, sub: 'u1', iat: 0, exp: 9999999999 }
const DRIVER_D1 = { tenantId: 't1', role: 'driver' as const, sub: 'u-d1', driverRef: 'd1', iat: 0, exp: 9999999999 }

function makeGET(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/driver-photos')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const req = new NextRequest(url)
  if (params._cookie) req.cookies.set('session', params._cookie)
  return req
}
function makeGETAuth(params: Record<string, string>) {
  const url = new URL('http://localhost/api/driver-photos')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return addCookie(new NextRequest(url))
}
function makePOST(body: unknown) {
  return addCookie(new NextRequest('http://localhost/api/driver-photos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}
function makeDELETE(params: Record<string, string>) {
  const url = new URL('http://localhost/api/driver-photos')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return addCookie(new NextRequest(url, { method: 'DELETE' }))
}

function addCookie(req: NextRequest): NextRequest {
  req.cookies.set('session', 'tok')
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifySession.mockResolvedValue(SESSION)
  mockDriverFindUnique.mockResolvedValue({ tenantId: 't1' })
})

// ─── GET (mock mode) ──────────────────────────────────────────────────────────

describe('GET /api/driver-photos — mock mode', () => {
  it('returns 400 when driverId missing', async () => {
    const res = await GET(makeGETAuth({ date: '2026-06-01' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when date missing', async () => {
    const res = await GET(makeGETAuth({ driverId: 'd1' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no session cookie', async () => {
    mockVerifySession.mockResolvedValueOnce(null)
    const res = await GET(makeGETAuth({ driverId: 'd1', date: '2026-06-01' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 empty object when no photos stored', async () => {
    const res = await GET(makeGETAuth({ driverId: 'nophoto', date: '2026-06-01' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({})
  })
})

// ─── POST (mock mode) ─────────────────────────────────────────────────────────

describe('POST /api/driver-photos — mock mode', () => {
  it('returns 400 on invalid JSON', async () => {
    const req = addCookie(new NextRequest('http://localhost/api/driver-photos', {
      method: 'POST',
      body: '{bad json',
    }))
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when dataUrl missing', async () => {
    const res = await POST(makePOST({ driverId: 'd1', date: '2026-06-01', missionId: 'm1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when dataUrl format invalid', async () => {
    const res = await POST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: 'm1',
      dataUrl: 'not-a-data-url',
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when missionId has unsafe characters', async () => {
    const res = await POST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: '../../etc/passwd',
      dataUrl: VALID_DATA_URL,
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when date format invalid', async () => {
    const res = await POST(makePOST({
      driverId: 'd1', date: 'not-a-date', missionId: 'm1',
      dataUrl: VALID_DATA_URL,
    }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no session', async () => {
    mockVerifySession.mockResolvedValueOnce(null)
    const res = await POST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: 'm1',
      dataUrl: VALID_DATA_URL,
    }))
    expect(res.status).toBe(401)
  })

  it('returns 413 when image too large', async () => {
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(5_600_000)
    const res = await POST(makePOST({ driverId: 'd1', date: '2026-06-01', missionId: 'm1', dataUrl: huge }))
    expect(res.status).toBe(413)
  })

  it('returns 422 when the decoded bytes are not a real image (fake magic bytes)', async () => {
    const fakeJpeg = 'data:image/jpeg;base64,' + Buffer.from('not actually a jpeg').toString('base64')
    const res = await POST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: 'm1',
      dataUrl: fakeJpeg,
    }))
    expect(res.status).toBe(422)
  })

  it('returns 200 and stores photo in mock store', async () => {
    const res = await POST(makePOST({
      driverId: 'dmock', date: '2026-06-01', missionId: 'mmock',
      dataUrl: VALID_DATA_URL,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe(VALID_DATA_URL)
  })

  it('GET retrieves previously POSTed photo', async () => {
    const postRes = await POST(makePOST({
      driverId: 'd-get-test', date: '2026-06-02', missionId: 'm-get-test',
      dataUrl: VALID_DATA_URL,
    }))
    expect(postRes.status).toBe(200)

    const getRes = await GET(makeGETAuth({ driverId: 'd-get-test', date: '2026-06-02' }))
    expect(getRes.status).toBe(200)
    const photos = await getRes.json()
    expect(photos['m-get-test']).toBe(VALID_DATA_URL)
  })
})

// ─── DELETE (mock mode) ───────────────────────────────────────────────────────

describe('DELETE /api/driver-photos — mock mode', () => {
  it('returns 400 when params missing', async () => {
    const res = await DELETE(makeDELETE({ driverId: 'd1', date: '2026-06-01' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no session', async () => {
    mockVerifySession.mockResolvedValueOnce(null)
    const res = await DELETE(makeDELETE({ driverId: 'd1', date: '2026-06-01', missionId: 'm1' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 in mock mode', async () => {
    const res = await DELETE(makeDELETE({ driverId: 'd1', date: '2026-06-01', missionId: 'm1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

// ─── Real mode ────────────────────────────────────────────────────────────────

describe('driver-photos — real mode', () => {
  let rGET: typeof GET
  let rPOST: typeof POST
  let rDELETE: typeof DELETE

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    vi.mock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.mock('@/lib/session', () => ({
      verifySession:  mockVerifySession,
      SESSION_COOKIE: 'session',
    }))
    vi.mock('@/lib/tenantDb', () => ({
      unscopedPrisma: { driver: { findUnique: mockDriverFindUnique } },
      getTenantDb:    () => ({ plan: { findFirst: mockPlanFindFirst } }),
    }))
    vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ name: 'local', put: mockWriteFile, get: vi.fn(async () => null), delete: mockUnlink, list: mockReaddir }),
  localRoot: () => '/tmp/uploads',
}))
    const mod = await import('@/app/api/driver-photos/route')
    rGET    = mod.GET
    rPOST   = mod.POST
    rDELETE = mod.DELETE
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifySession.mockResolvedValue(SESSION)
    mockDriverFindUnique.mockResolvedValue({ tenantId: 't1' })
    mockMkdir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])
    mockWriteFile.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockPlanFindFirst.mockResolvedValue({ missions: [{ id: 'm1' }] })
  })

  it("GET/POST/DELETE: a driver cannot touch another driver's photos (same tenant)", async () => {
    mockVerifySession.mockResolvedValue(DRIVER_D1)
    expect((await rGET(makeGETAuth({ driverId: 'd2', date: '2026-06-01' }))).status).toBe(403)
    expect((await rPOST(makePOST({ driverId: 'd2', date: '2026-06-01', missionId: 'm1', dataUrl: VALID_DATA_URL }))).status).toBe(403)
    expect((await rDELETE(makeDELETE({ driverId: 'd2', date: '2026-06-01', missionId: 'm1' }))).status).toBe(403)
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it('POST: a driver can only attach a photo to a mission of its own plan', async () => {
    mockVerifySession.mockResolvedValue(DRIVER_D1)
    mockPlanFindFirst.mockResolvedValueOnce({ missions: [{ id: 'other' }] })
    const res = await rPOST(makePOST({ driverId: 'd1', date: '2026-06-01', missionId: 'm1', dataUrl: VALID_DATA_URL }))
    expect(res.status).toBe(404)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('POST: a driver signature (<missionId>_sig) is accepted for its own mission', async () => {
    mockVerifySession.mockResolvedValue(DRIVER_D1)
    const res = await rPOST(makePOST({ driverId: 'd1', date: '2026-06-01', missionId: 'm1_sig', dataUrl: VALID_DATA_URL }))
    expect(res.status).toBe(200)
  })

  it('GET: returns 403 when driver tenantId mismatch', async () => {
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 'other-tenant' })
    const res = await rGET(makeGETAuth({ driverId: 'd1', date: '2026-06-01' }))
    expect(res.status).toBe(403)
  })

  it('GET: lists files matching prefix', async () => {
    mockReaddir.mockResolvedValueOnce(['d1_2026-06-01_m1.jpg', 'd1_2026-06-01_m2.jpg', 'other.jpg'])
    const res = await rGET(makeGETAuth({ driverId: 'd1', date: '2026-06-01' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toHaveLength(2)
  })

  it('GET: returns 500 on readdir error', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('disk error'))
    const res = await rGET(makeGETAuth({ driverId: 'd1', date: '2026-06-01' }))
    expect(res.status).toBe(500)
  })

  it('POST: rejects fake magic bytes before touching disk', async () => {
    const fakeJpeg = 'data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64')
    const res = await rPOST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: 'm1',
      dataUrl: fakeJpeg,
    }))
    expect(res.status).toBe(422)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('POST: writes file and returns url', async () => {
    const res = await rPOST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: 'm1',
      dataUrl: VALID_DATA_URL,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Served by the authenticated files route, never from public/.
    expect(body.url).toBe('/api/files/t1/photos/d1_2026-06-01_m1.jpg')
    expect(mockWriteFile).toHaveBeenCalledOnce()
  })

  it('POST: returns 500 on writeFile error', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('no space'))
    const res = await rPOST(makePOST({
      driverId: 'd1', date: '2026-06-01', missionId: 'm1',
      dataUrl: VALID_DATA_URL,
    }))
    expect(res.status).toBe(500)
  })

  it('DELETE: calls unlink and returns ok', async () => {
    mockReaddir.mockResolvedValueOnce(['d1_2026-06-01_m1.jpg', 'd1_2026-06-01_m10.jpg'])
    const res = await rDELETE(makeDELETE({ driverId: 'd1', date: '2026-06-01', missionId: 'm1' }))
    expect(res.status).toBe(200)
    expect(mockUnlink).toHaveBeenCalledOnce()
  })
})
