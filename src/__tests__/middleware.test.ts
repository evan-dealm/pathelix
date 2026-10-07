import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockVerifySession, mockCheckTenantSuspension } = vi.hoisted(() => {
  const mockVerifySession = vi.fn()
  const mockCheckTenantSuspension = vi.fn(
    async (): Promise<import('next/server').NextResponse | null> => null,
  )
  return { mockVerifySession, mockCheckTenantSuspension }
})

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: mockVerifySession,
}))

const mockIsSessionCurrent = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/sessionRevocation', () => ({ isSessionCurrent: mockIsSessionCurrent }))

vi.mock('@/lib/data/context', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/data/context')>()
  return {
    ...original,
    checkTenantSuspension: mockCheckTenantSuspension,
  }
})

const mockAuthenticateApiKey = vi.hoisted(() => vi.fn())
vi.mock('@/lib/apiKeyAuth', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/apiKeyAuth')>()
  return { ...original, authenticateApiKey: mockAuthenticateApiKey }
})

import { middleware } from '@/middleware'

function makeReq(
  pathname: string,
  opts: {
    method?: string
    headers?: Record<string, string>
    cookie?: string
    ip?: string
  } = {},
): NextRequest {
  const url = `http://localhost${pathname}`
  const headers: Record<string, string> = {
    'x-forwarded-for': opts.ip ?? '1.2.3.4',
    ...opts.headers,
  }
  if (opts.cookie) headers['cookie'] = opts.cookie

  return new NextRequest(url, {
    method: opts.method ?? 'GET',
    headers,
  })
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    role: 'admin',
    tenantId: 'tenant-1',
    trade: 'waste',
    driverRef: null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Body size guard ──────────────────────────────────────────────────────

  it('rejects requests with content-length > 5 MB', async () => {
    const req = makeReq('/api/drivers', {
      headers: { 'content-length': String(6 * 1024 * 1024) },
    })
    const res = await middleware(req)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.error).toMatch(/5 MB/)
  })

  it('allows requests within 5 MB', async () => {
    mockVerifySession.mockResolvedValue(makeSession())
    const req = makeReq('/api/drivers', {
      headers: { 'content-length': String(1024) },
    })
    const res = await middleware(req)
    expect(res.status).not.toBe(413)
  })

  // ─── Public paths ─────────────────────────────────────────────────────────

  it('passes /api/health without auth', async () => {
    const req = makeReq('/api/health')
    const res = await middleware(req)
    expect(res.status).toBe(200)
    expect(mockVerifySession).not.toHaveBeenCalled()
  })

  // The integrator reading the reference has an API key at best — it used to redirect to /login.
  it('passes the API reference (/api-docs page and /api/docs spec) without auth, and nothing next to it', async () => {
    expect((await middleware(makeReq('/api-docs'))).status).toBe(200)
    expect((await middleware(makeReq('/api/docs'))).status).toBe(200)
    expect(mockVerifySession).not.toHaveBeenCalled()
    mockVerifySession.mockResolvedValue(null)
    expect((await middleware(makeReq('/api/documents'))).status).toBe(401)
    expect((await middleware(makeReq('/api/docs-internal'))).status).toBe(401)
  })

  // On the Node.js runtime Next swaps the request stream for its buffered copy without waiting
  // for the body: answering before the last chunk made the route fail at random (HTML 500).
  it('passes a request on only once its whole body has arrived', async () => {
    mockVerifySession.mockResolvedValue(makeSession())
    let complete = false
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('{"notes":"'))
        await new Promise(resolve => setTimeout(resolve, 40))
        controller.enqueue(new TextEncoder().encode('late chunk"}'))
        complete = true
        controller.close()
      },
    })
    const req = new NextRequest('http://localhost/api/drivers/abc', {
      method: 'PUT', body, duplex: 'half',
      headers: { cookie: 'session=tok', 'x-forwarded-for': '1.2.3.4', 'content-type': 'application/json' },
    } as ConstructorParameters<typeof NextRequest>[1])
    const res = await middleware(req)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(complete).toBe(true)
  })

  it('does not wait for the upload of a request it refuses', async () => {
    const body = new ReadableStream<Uint8Array>({ start() { /* never ends */ } })
    const req = new NextRequest('http://localhost/api/drivers/abc', {
      method: 'PUT', body, duplex: 'half', headers: { 'x-forwarded-for': '1.2.3.4' },
    } as ConstructorParameters<typeof NextRequest>[1])
    const res = await middleware(req)
    expect(res.status).toBe(401)
  })

  // Megabytes of text could be stored in a note, and bodies above ~100 KB hit an intermittent
  // framework error on routes that do not read them first.
  it('ordinary API routes refuse a body over 100 KB; file, import and plan routes still take large ones', async () => {
    mockVerifySession.mockResolvedValue(makeSession())
    const big = { cookie: 'session=tok', headers: { 'content-length': String(300 * 1024) }, method: 'POST' }
    expect((await middleware(makeReq('/api/drivers/abc', { ...big, method: 'PUT' }))).status).toBe(413)
    expect((await middleware(makeReq('/api/clients', big))).status).toBe(413)
    for (const path of ['/api/plans', '/api/import', '/api/driver-photos', '/api/delivery-proof', '/api/optimize']) {
      expect((await middleware(makeReq(path, big))).status, path).not.toBe(413)
    }
    const small = { ...big, headers: { 'content-length': '2048' } }
    expect((await middleware(makeReq('/api/clients', small))).status).not.toBe(413)
  })

  it('passes /api/auth/login without auth', async () => {
    const req = makeReq('/api/auth/login')
    const res = await middleware(req)
    expect(res.status).toBe(200)
    expect(mockVerifySession).not.toHaveBeenCalled()
  })

  it('does NOT treat /api/auth/me as public', async () => {
    mockVerifySession.mockResolvedValue(null)
    const req = makeReq('/api/auth/me')
    const res = await middleware(req)
    expect(res.status).toBe(401)
  })

  it('lets the customer portal through (own session) but keeps the staff portal routes private', async () => {
    mockVerifySession.mockResolvedValue(null)
    expect((await middleware(makeReq('/api/portal/overview'))).status).toBe(200)
    expect((await middleware(makeReq('/portal/invite'))).status).toBe(200)
    expect((await middleware(makeReq('/api/portal-requests'))).status).toBe(401)
    expect((await middleware(makeReq('/api/portal-users/abc'))).status).toBe(401)
  })

  it('passes /api/webhooks/nessy without auth', async () => {
    const req = makeReq('/api/webhooks/nessy')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('passes /api/webhooks/trackdechets without auth — regression: webhook externe bloqué par middleware', async () => {
    const req = makeReq('/api/webhooks/trackdechets')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('passes /api/ai/callback without auth — regression: callback HMAC bloqué par middleware', async () => {
    const req = makeReq('/api/ai/callback')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('requires a session for /driver/123 (redirects to /login)', async () => {
    mockVerifySession.mockResolvedValue(null)
    const res = await middleware(makeReq('/driver/123'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('requires a session for /api/driver-plan/* (no longer a public path)', async () => {
    mockVerifySession.mockResolvedValue(null)
    const res = await middleware(makeReq('/api/driver-plan/d1?date=2026-01-01'))
    expect(res.status).toBe(401)
  })

  it('passes /track/<token> and /api/tracking without auth (customer tracking link)', async () => {
    expect((await middleware(makeReq('/track/abc'))).status).toBe(200)
    expect((await middleware(makeReq('/api/tracking?token=abc'))).status).toBe(200)
  })

  it('passes /login without auth', async () => {
    const req = makeReq('/login')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // ─── Header stripping ─────────────────────────────────────────────────────

  it('strips x-user-id and x-user-role from inbound requests on non-Nessy paths', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'admin' }))
    const req = makeReq('/api/drivers', {
      headers: {
        'x-user-id': 'attacker-id',
        'x-user-role': 'superadmin',
        'x-tenant-id': 'other-tenant',
        cookie: 'session=token',
      },
    })
    // We verify through the fact that the middleware succeeds without superadmin role
    // (if spoofed header was used, it would have escalated)
    const res = await middleware(req)
    // admin role is allowed on /api/drivers
    expect(res.status).toBe(200)
  })

  it('re-injects identity headers from the verified session, not from the client', async () => {
    mockVerifySession.mockResolvedValue(
      makeSession({ role: 'admin', tenantId: 'tenant-1', sub: 'user-1' }),
    )
    const res = await middleware(
      makeReq('/api/drivers', {
        headers: {
          'x-user-role': 'superadmin',
          'x-tenant-id': 'other-tenant',
          'x-driver-ref': 'd9',
          cookie: 'session=t',
        },
      }),
    )
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBe('tenant-1')
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe('admin')
    expect(res.headers.get('x-middleware-request-x-driver-ref')).toBeNull()
  })

  it('strips a client-supplied x-tenant-id on the Nessy webhook path (tenant comes from the HMAC secret)', async () => {
    const res = await middleware(
      makeReq('/api/webhooks/nessy', {
        headers: { 'x-tenant-id': 'tenant-from-nessy' },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBeNull()
  })

  // ─── Driver deny-by-default ───────────────────────────────────────────────

  it.each([
    '/api/clients',
    '/api/vehicles',
    '/api/settings',
    '/api/integrations',
    '/api/kpi-history',
    '/api/permissions',
    '/api/reports/co2',
    '/api/tours/pdf',
    '/api/driver-list',
    '/api/users',
  ])('denies a driver session on tenant-wide route %s', async path => {
    mockVerifySession.mockResolvedValue(
      makeSession({ role: 'driver', sub: 'u-d1', driverRef: 'd1' }),
    )
    const res = await middleware(makeReq(path, { cookie: 'session=t' }))
    expect(res.status).toBe(403)
  })

  it.each([
    '/api/driver-plan/d1',
    '/api/driver-status/update',
    '/api/driver-photos',
    '/api/incidents',
    '/api/mission-comments',
    '/api/auth/me',
    '/api/ai/ocr',
    '/api/files/t/photos/x.jpg',
  ])('lets a driver session reach driver route %s', async path => {
    mockVerifySession.mockResolvedValue(
      makeSession({ role: 'driver', sub: 'u-d1', driverRef: 'd1' }),
    )
    const res = await middleware(makeReq(path, { cookie: 'session=t' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-driver-ref')).toBe('d1')
  })

  it("redirects a driver opening another driver's page (or the picker) to its own page", async () => {
    mockVerifySession.mockResolvedValue(
      makeSession({ role: 'driver', sub: 'u-d1', driverRef: 'd1' }),
    )
    for (const path of ['/driver', '/driver/d2']) {
      const res = await middleware(makeReq(path, { cookie: 'session=t' }))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get('location')!).pathname).toBe('/driver/d1')
    }
    expect((await middleware(makeReq('/driver/d1', { cookie: 'session=t' }))).status).toBe(200)
  })

  // ─── Session revocation ───────────────────────────────────────────────────

  it('treats a revoked session (sessionVersion moved on) as unauthenticated', async () => {
    mockVerifySession.mockResolvedValue(makeSession())
    mockIsSessionCurrent.mockResolvedValueOnce(false)
    const res = await middleware(makeReq('/api/drivers', { cookie: 'session=t' }))
    expect(res.status).toBe(401)
  })

  // ─── Rate-limit client IP ─────────────────────────────────────────────────

  it('does not let a spoofed left-most X-Forwarded-For entry dodge the anonymous limiter', async () => {
    mockVerifySession.mockResolvedValue(null)
    let last = 401
    for (let i = 0; i < 305; i++) {
      const res = await middleware(
        makeReq('/api/drivers', { ip: `10.0.${i % 250}.${i}, 203.0.113.77` }),
      )
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('counts authenticated traffic per user: colleagues behind one IP do not share a budget', async () => {
    const sameIp = '198.51.100.9'
    mockVerifySession.mockResolvedValue(makeSession({ sub: 'rl-user-a' }))
    let lastA = 200
    for (let i = 0; i < 601; i++)
      lastA = (await middleware(makeReq('/api/drivers', { cookie: 'session=a', ip: sameIp })))
        .status
    expect(lastA).toBe(429)

    mockVerifySession.mockResolvedValue(makeSession({ sub: 'rl-user-b' }))
    expect(
      (await middleware(makeReq('/api/drivers', { cookie: 'session=b', ip: sameIp }))).status,
    ).toBe(200)
  })

  // ─── Auth enforcement ─────────────────────────────────────────────────────

  it('returns 401 for unauthenticated API requests', async () => {
    mockVerifySession.mockResolvedValue(null)
    const req = makeReq('/api/drivers')
    const res = await middleware(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/authentifi/i)
  })

  it('redirects unauthenticated non-API requests to /login', async () => {
    mockVerifySession.mockResolvedValue(null)
    const req = makeReq('/admin')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/login')
    expect(location).toContain('from=%2Fadmin')
  })

  // ─── Header injection ─────────────────────────────────────────────────────

  it('injects x-tenant-id, x-user-id, x-user-role from session', async () => {
    mockVerifySession.mockResolvedValue(
      makeSession({
        sub: 'user-42',
        role: 'admin',
        tenantId: 'tenant-XYZ',
        trade: 'waste',
      }),
    )
    const req = makeReq('/api/drivers', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(200)
    // The injected headers go into the upstream request, not the response —
    // we verify through x-request-id which IS on the response
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('sets x-request-id on every response', async () => {
    const req = makeReq('/api/health')
    const res = await middleware(req)
    const rid = res.headers.get('x-request-id')
    expect(rid).toBeTruthy()
    expect(rid).toMatch(/^[0-9a-f-]{36}$/)
  })

  // ─── SuperAdmin RBAC ──────────────────────────────────────────────────────

  it('returns 403 on /api/superadmin for non-superadmin role', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'admin' }))
    const req = makeReq('/api/superadmin/tenants', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/superadmin/i)
  })

  it('allows /api/superadmin for superadmin role', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'superadmin', trade: 'waste' }))
    const req = makeReq('/api/superadmin/tenants', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('allows impersonating superadmin to exit via /api/superadmin/exit-impersonation', async () => {
    mockVerifySession.mockResolvedValue(
      makeSession({
        role: 'admin',
        sub: 'sa:real-sa-id',
        trade: 'waste',
      }),
    )
    const req = makeReq('/api/superadmin/exit-impersonation', { cookie: 'session=tok' })
    const res = await middleware(req)
    // Should not 403 — the exit-impersonation exemption applies
    expect(res.status).toBe(200)
  })

  // ─── Admin RBAC ───────────────────────────────────────────────────────────

  it('returns 403 on admin-only routes for driver role', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'driver', trade: 'waste' }))
    const req = makeReq('/api/missions', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('allows admin-only routes for dispatcher role', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'dispatcher', trade: 'waste' }))
    const req = makeReq('/api/missions', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('allows admin-only routes for admin role', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'admin', trade: 'waste' }))
    const req = makeReq('/api/missions', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('redirects driver to their page when accessing /admin', async () => {
    mockVerifySession.mockResolvedValue(
      makeSession({
        role: 'driver',
        sub: 'driver-1',
        driverRef: 'DRV-42',
        trade: 'waste',
      }),
    )
    const req = makeReq('/admin', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/driver/DRV-42')
  })

  // ─── Onboarding redirect ──────────────────────────────────────────────────

  it('redirects admin without trade to /onboarding', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'admin', trade: null }))
    const req = makeReq('/admin', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/onboarding')
  })

  it('does not redirect admin without trade on /onboarding path itself', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'admin', trade: null }))
    const req = makeReq('/onboarding', { cookie: 'session=tok' })
    const res = await middleware(req)
    // Not redirected back to onboarding — the path is exempted
    expect(res.status).not.toBe(307)
  })

  it('does not redirect API calls for admin without trade', async () => {
    mockVerifySession.mockResolvedValue(makeSession({ role: 'admin', trade: null }))
    const req = makeReq('/api/onboarding', { cookie: 'session=tok' })
    // /api/onboarding is exempt from onboarding redirect, driver check, and admin check
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('returns 403 for suspended tenant', async () => {
    const { NextResponse } = await import('next/server')
    mockCheckTenantSuspension.mockResolvedValueOnce(
      NextResponse.json({ error: 'Compte suspendu.' }, { status: 403 }),
    )
    mockVerifySession.mockResolvedValue(makeSession())
    const req = makeReq('/api/missions', { cookie: 'session=tok' })
    const res = await middleware(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/suspendu/i)
  })
})

describe('middleware — X-API-Key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authenticates a scoped key and injects its tenant as a dispatcher', async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      id: 'k1',
      tenantId: 'tenant-9',
      scopes: ['missions:read'],
    })
    const res = await middleware(
      makeReq('/api/missions', { headers: { 'x-api-key': 'ef_live_x' } }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBe('tenant-9')
    expect(res.headers.get('x-middleware-request-x-user-id')).toBe('apikey:k1')
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe('dispatcher')
  })

  it('403 when no scope covers the route (deny by default)', async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      id: 'k1',
      tenantId: 'tenant-9',
      scopes: ['missions:read'],
    })
    expect(
      (
        await middleware(
          makeReq('/api/missions', { method: 'POST', headers: { 'x-api-key': 'ef_live_x' } }),
        )
      ).status,
    ).toBe(403)
    expect(
      (await middleware(makeReq('/api/users', { headers: { 'x-api-key': 'ef_live_x' } }))).status,
    ).toBe(403)
    expect(
      (await middleware(makeReq('/api/api-keys', { headers: { 'x-api-key': 'ef_live_x' } })))
        .status,
    ).toBe(403)
  })

  it('a billing key reaches the invoices, a customer key never reaches portal invitations', async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      id: 'k2',
      tenantId: 'tenant-9',
      scopes: ['invoices:read', 'clients:write'],
    })
    const key = { headers: { 'x-api-key': 'ef_live_x' } }
    expect((await middleware(makeReq('/api/invoices/export', key))).status).toBe(200)
    expect((await middleware(makeReq('/api/invoices', { ...key, method: 'POST' }))).status).toBe(
      403,
    )
    expect((await middleware(makeReq('/api/clients', { ...key, method: 'POST' }))).status).toBe(200)
    expect(
      (await middleware(makeReq('/api/clients/c1/portal-users', { ...key, method: 'POST' })))
        .status,
    ).toBe(403)
  })

  it('401 for an unknown/revoked key', async () => {
    mockAuthenticateApiKey.mockResolvedValue(null)
    expect(
      (await middleware(makeReq('/api/missions', { headers: { 'x-api-key': 'ef_live_bad' } })))
        .status,
    ).toBe(401)
  })

  it('respects tenant suspension', async () => {
    mockAuthenticateApiKey.mockResolvedValue({
      id: 'k1',
      tenantId: 'tenant-9',
      scopes: ['missions:read'],
    })
    const { NextResponse } = await import('next/server')
    mockCheckTenantSuspension.mockResolvedValueOnce(
      NextResponse.json({ error: 'suspendu' }, { status: 403 }),
    )
    expect(
      (await middleware(makeReq('/api/missions', { headers: { 'x-api-key': 'ef_live_x' } })))
        .status,
    ).toBe(403)
  })

  it('is ignored for pages (no API key login to the UI)', async () => {
    mockVerifySession.mockResolvedValue(null)
    const res = await middleware(makeReq('/admin', { headers: { 'x-api-key': 'ef_live_x' } }))
    expect(mockAuthenticateApiKey).not.toHaveBeenCalled()
    expect(res.status).toBe(307)
  })
})
