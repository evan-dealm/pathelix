import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

// ── top-level mocks registered before ANY import ─────────────────────────────

const mockRlCheck = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: vi.fn(() => ({
    check: mockRlCheck,
    headers: vi.fn(() => ({ 'Retry-After': '60' })),
  })),
  getClientIp: vi.fn(() => '10.0.0.1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn() },
  METRIC: { AUTH_LOGIN_OK: 'auth.login_ok', AUTH_LOGIN_FAIL: 'auth.login_fail' },
}))

vi.mock('@/lib/session', () => ({
  signSession: vi.fn(async () => 'mock-session-token'),
  SESSION_COOKIE: 'session',
  COOKIE_OPTIONS: { httpOnly: true, secure: true, sameSite: 'strict' as const },
}))

const mockBcryptCompare = vi.hoisted(() => vi.fn(async () => true))
vi.mock('bcryptjs', () => ({ compare: mockBcryptCompare }))

const mockUserFindFirst  = vi.hoisted(() => vi.fn())
const mockTenantFindUniq = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: { tenant: { findUnique: mockTenantFindUniq } },
  prisma:  { user: { findFirst: mockUserFindFirst } },
}))

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLogin(body: unknown) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BASE_USER = {
  id: 'u1',
  email: 'admin@tenant.com',
  passwordHash: '$2a$10$mocked-hash',
  role: 'ADMIN',
  tenantId: 't1',
  driverRef: null,
  tenant: { trade: 'déchets', suspendedAt: null },
}

// ── Real DB mode ──────────────────────────────────────────────────────────────

describe('POST /api/auth/login — real DB mode', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()

    vi.mock('@/lib/rateLimit', () => ({
      createRateLimiter: vi.fn(() => ({
        check: mockRlCheck,
        headers: vi.fn(() => ({ 'Retry-After': '60' })),
      })),
      getClientIp: vi.fn(() => '10.0.0.1'),
    }))
    vi.mock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))
    vi.mock('@/lib/metrics', () => ({
      metrics: { increment: vi.fn() },
      METRIC: { AUTH_LOGIN_OK: 'auth.login_ok', AUTH_LOGIN_FAIL: 'auth.login_fail' },
    }))
    vi.mock('@/lib/session', () => ({
      signSession: vi.fn(async () => 'mock-session-token'),
      SESSION_COOKIE: 'session',
      COOKIE_OPTIONS: { httpOnly: true, secure: true, sameSite: 'strict' as const },
    }))
    vi.mock('bcryptjs', () => ({ compare: mockBcryptCompare }))
    vi.mock('@/lib/db', () => ({
      default: { tenant: { findUnique: mockTenantFindUniq } },
      prisma:  { user: { findFirst: mockUserFindFirst } },
    }))

    const mod = await import('@/app/api/auth/login/route')
    POST = mod.POST
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockRlCheck.mockReset()
    mockRlCheck.mockResolvedValue(true)
    mockBcryptCompare.mockReset()
    mockBcryptCompare.mockResolvedValue(true)
    mockUserFindFirst.mockResolvedValue({ ...BASE_USER })
  })

  // ── rate limit ─────────────────────────────────────────────────────────────

  it('429 on brute-force (rate limiter tripped)', async () => {
    mockRlCheck.mockResolvedValueOnce(false)
    const res = await POST(makeLogin({ email: 'x@x.com', password: 'pass' }))
    expect(res.status).toBe(429)
  })

  // ── JSON parse ─────────────────────────────────────────────────────────────

  it('400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  // ── email required ─────────────────────────────────────────────────────────

  it('400 when email missing (real DB requires email)', async () => {
    const res = await POST(makeLogin({ password: 'password123' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })

  // ── user not found ─────────────────────────────────────────────────────────

  it('401 when user not found in DB', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makeLogin({ email: 'ghost@tenant.com', password: 'pass' }))
    expect(res.status).toBe(401)
  })

  // ── wrong password ─────────────────────────────────────────────────────────

  it('401 on wrong password (bcrypt compare false)', async () => {
    mockBcryptCompare.mockResolvedValueOnce(false)
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'wrongpass' }))
    expect(res.status).toBe(401)
  })

  // ── suspended tenant ───────────────────────────────────────────────────────

  it('403 on suspended tenant for non-superadmin', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      tenant: { trade: 'déchets', suspendedAt: new Date('2026-01-01') },
    })
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'pass' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/suspendu/i)
  })

  it('200 for superadmin even if tenant suspended', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      role: 'SUPERADMIN',
      tenantId: null,
      tenant: { trade: null, suspendedAt: new Date('2026-01-01') },
    })
    const res = await POST(makeLogin({ email: 'sa@system.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectTo).toBe('/superadmin')
  })

  // ── unknown role ───────────────────────────────────────────────────────────

  it('500 on unknown role in DB', async () => {
    mockUserFindFirst.mockResolvedValueOnce({ ...BASE_USER, role: 'UNKNOWN_ROLE' })
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'pass' }))
    expect(res.status).toBe(500)
  })

  // ── successful logins ──────────────────────────────────────────────────────

  it('200 admin → redirectTo /admin', async () => {
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.redirectTo).toBe('/admin')
  })

  it('200 admin without trade → redirectTo /onboarding', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      tenant: { trade: null, suspendedAt: null },
    })
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectTo).toBe('/onboarding')
  })

  it('200 superadmin → redirectTo /superadmin', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      role: 'SUPERADMIN',
      tenantId: null,
      tenant: null,
    })
    const res = await POST(makeLogin({ email: 'sa@system.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectTo).toBe('/superadmin')
  })

  it('200 driver → redirectTo /driver/{driverRef}', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      role: 'DRIVER',
      driverRef: 'DR-007',
    })
    const res = await POST(makeLogin({ email: 'driver@tenant.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectTo).toBe('/driver/DR-007')
  })

  it('200 driver without driverRef → redirectTo /driver/{userId}', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      role: 'DRIVER',
      driverRef: null,
    })
    const res = await POST(makeLogin({ email: 'driver@tenant.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectTo).toBe('/driver/u1')
  })

  it('200 dispatcher → redirectTo /admin', async () => {
    mockUserFindFirst.mockResolvedValueOnce({
      ...BASE_USER,
      role: 'DISPATCHER',
    })
    const res = await POST(makeLogin({ email: 'dispatch@tenant.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectTo).toBe('/admin')
  })

  it('sets session cookie on success', async () => {
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'pass' }))
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toMatch(/session=mock-session-token/)
  })

  // ── DB error ───────────────────────────────────────────────────────────────

  it('500 on DB error (findFirst throws)', async () => {
    mockUserFindFirst.mockRejectedValueOnce(new Error('DB connection lost'))
    const res = await POST(makeLogin({ email: 'admin@tenant.com', password: 'pass' }))
    expect(res.status).toBe(500)
  })
})
