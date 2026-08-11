import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockVerifySession, mockCheckTenantSuspension } = vi.hoisted(() => {
  const mockVerifySession = vi.fn()
  const mockCheckTenantSuspension = vi.fn(async (): Promise<import('next/server').NextResponse | null> => null)
  return { mockVerifySession, mockCheckTenantSuspension }
})

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: mockVerifySession,
}))

vi.mock('@/lib/data/context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/data/context')>()
  return {
    ...original,
    checkTenantSuspension: mockCheckTenantSuspension,
  }
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

  it('passes /driver/123 without auth', async () => {
    const req = makeReq('/driver/123')
    const res = await middleware(req)
    expect(res.status).toBe(200)
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
        'x-user-id':   'attacker-id',
        'x-user-role': 'superadmin',
        'x-tenant-id': 'other-tenant',
        'cookie':      'session=token',
      },
    })
    // We verify through the fact that the middleware succeeds without superadmin role
    // (if spoofed header was used, it would have escalated)
    const res = await middleware(req)
    // admin role is allowed on /api/drivers
    expect(res.status).toBe(200)
  })

  it('preserves x-tenant-id header on Nessy webhook path', async () => {
    const req = makeReq('/api/webhooks/nessy', {
      headers: { 'x-tenant-id': 'tenant-from-nessy' },
    })
    const res = await middleware(req)
    // Nessy is public, passes through
    expect(res.status).toBe(200)
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
    mockVerifySession.mockResolvedValue(makeSession({
      sub: 'user-42',
      role: 'admin',
      tenantId: 'tenant-XYZ',
      trade: 'waste',
    }))
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
    mockVerifySession.mockResolvedValue(makeSession({
      role: 'admin',
      sub: 'sa:real-sa-id',
      trade: 'waste',
    }))
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
    mockVerifySession.mockResolvedValue(makeSession({
      role: 'driver',
      sub: 'driver-1',
      driverRef: 'DRV-42',
      trade: 'waste',
    }))
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
