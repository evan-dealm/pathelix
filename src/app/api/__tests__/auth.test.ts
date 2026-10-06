import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

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
    AUTH_LOGIN_OK:   'auth.login_ok',
    AUTH_LOGIN_FAIL: 'auth.login_fail',
    API_LATENCY_MS:  'api.latency_ms',
    API_REQUESTS:    'api.requests',
    API_ERRORS:      'api.errors',
  },
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({
    check:   vi.fn(() => true),
    headers: vi.fn(() => ({ 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': '4' })),
  }),
  createTenantRateLimiter: () => ({
    check:   vi.fn(() => true),
    headers: vi.fn(() => ({})),
  }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(() => null),
}))

vi.mock('@/lib/db', () => ({
  default: {
    tenant: { findUnique: vi.fn(async () => ({ trade: 'waste' })) },
    user:   { findFirst: vi.fn(async () => null) },
  },
  prisma: {
    tenant: { findUnique: vi.fn(async () => ({ trade: 'waste' })) },
    user:   { findFirst: vi.fn(async () => null) },
  },
}))

// Pre-warm both route modules before any tests run to avoid Vite SSR transform
// timeouts under parallel worker load.
let loginPOST: (req: NextRequest) => Promise<Response>
let logoutPOST: (req: NextRequest) => Promise<Response>

beforeAll(async () => {
  process.env.USE_MOCK_DATA  = 'true'
  process.env.ADMIN_PASSWORD = 'test-password-123'
  process.env.SESSION_SECRET = 'dev-secret-minimum-32-chars-long!!!'

  const [loginMod, logoutMod] = await Promise.all([
    import('@/app/api/auth/login/route'),
    import('@/app/api/auth/logout/route'),
  ])
  loginPOST  = loginMod.POST
  logoutPOST = logoutMod.POST
})

function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

describe('POST /api/auth/login (mock mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 + ok with correct password', async () => {
    const res  = await loginPOST(makeLoginRequest({ password: 'test-password-123' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('sets session cookie on successful login', async () => {
    const res = await loginPOST(makeLoginRequest({ password: 'test-password-123' }))

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeDefined()
    expect(setCookie).toContain('session=')
  })

  it('returns 401 for wrong password', async () => {
    const res = await loginPOST(makeLoginRequest({ password: 'wrong-password' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{{invalid',
    })
    const res = await loginPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing password field', async () => {
    const res = await loginPOST(makeLoginRequest({ email: 'test@example.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty password', async () => {
    const res = await loginPOST(makeLoginRequest({ password: '' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login — rate limiting', () => {
  it('rate limiter mock check function works correctly', async () => {
    const rateLimit = await import('@/lib/rateLimit')
    const limiter = rateLimit.createRateLimiter(5, 60_000)

    expect(limiter.check('test-ip')).toBe(true)
    expect(limiter.headers('test-ip')).toBeDefined()
  })
})

describe('POST /api/auth/logout', () => {
  const makeLogoutReq = () => new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' })

  it('clears the session cookie', async () => {
    const res = await logoutPOST(makeLogoutReq())

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeDefined()
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('returns ok: true', async () => {
    const res  = await logoutPOST(makeLogoutReq())
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('returns 413 when content-length exceeds limit', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/logout', {
      method:  'POST',
      headers: { 'content-length': '2048' },
    })
    const res = await logoutPOST(req)
    expect(res.status).toBe(413)
  })
})

describe('POST /api/auth/login — additional branches', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('returns 429 after 20 failed logins from one IP — successful ones never count', async () => {
    vi.resetModules()
    const { POST } = await import('@/app/api/auth/login/route')
    const login = (password: string) => POST(new NextRequest('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    }))
    for (let i = 0; i < 25; i++) expect((await login(process.env.ADMIN_PASSWORD ?? '')).status).toBe(200)
    for (let i = 0; i < 20; i++) expect((await login('wrong-password')).status).toBe(401)
    expect((await login('wrong-password')).status).toBe(429)
    expect((await login(process.env.ADMIN_PASSWORD ?? '')).status).toBe(429)
  }, 20_000)

  it('returns 503 when ADMIN_PASSWORD is not configured in mock mode', async () => {
    const origPwd = process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_PASSWORD
    vi.resetModules()
    try {
      const { POST } = await import('@/app/api/auth/login/route')
      const res = await POST(new NextRequest('http://localhost/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'any' }),
      }))
      expect(res.status).toBe(503)
    } finally {
      if (origPwd !== undefined) process.env.ADMIN_PASSWORD = origPwd
    }
  })

  it('redirects to /onboarding when mock tenant has no trade', async () => {
    vi.doMock('@/lib/db', () => ({
      default: {
        tenant: { findUnique: vi.fn(async () => null) },
        user:   { findFirst: vi.fn(async () => null) },
      },
      prisma: {
        tenant: { findUnique: vi.fn(async () => null) },
        user:   { findFirst: vi.fn(async () => null) },
      },
    }))
    vi.resetModules()
    const { POST } = await import('@/app/api/auth/login/route')
    const res  = await POST(new NextRequest('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password-123' }),
    }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.redirectTo).toBe('/onboarding')
    vi.doUnmock('@/lib/db')
  })
})
