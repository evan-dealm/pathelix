/**
 * Matrice 2.2 — RBAC on superadmin routes
 * Defense-in-depth: route-level role checks independent of middleware.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/session', () => ({
  signSession: vi.fn(async () => 'signed-token'),
  SESSION_COOKIE: 'session',
  COOKIE_OPTIONS: {},
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-sa', userId: 'sa-1', role: 'superadmin', requestId: 'req-1' })),
  invalidateSuspensionCache: vi.fn(),
}))

vi.mock('@/lib/superadminAudit', () => ({
  logSuperadminAction: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  signSession: vi.fn(async () => 'tok'),
  revokeSessionsForTenant: vi.fn(),
  unrevokeSessionsForTenant: vi.fn(),
  SESSION_COOKIE: 'session',
  COOKIE_OPTIONS: {},
}))

import { getRequestContext } from '@/lib/data/context'

function makeReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function setRole(role: string) {
  vi.mocked(getRequestContext).mockReturnValue({
    tenantId: 'tenant-sa', userId: 'u-1', role, requestId: 'req-1', trade: null,
  })
}

const TENANT_ID = 'tenant-target'
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

// ── POST /api/superadmin/impersonate ────────────────────────────────────────

describe('[SEC-M2.2] /api/superadmin/impersonate — role enforcement', () => {
  beforeEach(() => { vi.clearAllMocks(); setRole('superadmin') })

  it('returns 403 for admin role', async () => {
    setRole('admin')
    const { POST } = await import('@/app/api/superadmin/impersonate/route')
    const res = await POST(makeReq('http://localhost', { tenantId: TENANT_ID }))
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher role', async () => {
    setRole('dispatcher')
    const { POST } = await import('@/app/api/superadmin/impersonate/route')
    const res = await POST(makeReq('http://localhost', { tenantId: TENANT_ID }))
    expect(res.status).toBe(403)
  })

  it('returns 403 for driver role', async () => {
    setRole('driver')
    const { POST } = await import('@/app/api/superadmin/impersonate/route')
    const res = await POST(makeReq('http://localhost', { tenantId: TENANT_ID }))
    expect(res.status).toBe(403)
  })

  it('superadmin can impersonate valid tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme', trade: null })
    mockPrisma.auditLog.create.mockResolvedValue({})
    const { POST } = await import('@/app/api/superadmin/impersonate/route')
    const res = await POST(makeReq('http://localhost', { tenantId: TENANT_ID }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('returns 404 for unknown tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/superadmin/impersonate/route')
    const res = await POST(makeReq('http://localhost', { tenantId: 'nonexistent' }))
    expect(res.status).toBe(404)
  })
})

// ── POST /api/superadmin/tenants/[id]/suspend ───────────────────────────────

describe('[SEC-M2.2] /api/superadmin/tenants/[id]/suspend — role enforcement', () => {
  beforeEach(() => { vi.clearAllMocks(); setRole('superadmin') })

  it('returns 403 for admin role', async () => {
    setRole('admin')
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/suspend/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher role', async () => {
    setRole('dispatcher')
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/suspend/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(403)
  })

  it('superadmin can suspend existing unsuspended tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme', suspendedAt: null })
    mockPrisma.tenant.update.mockResolvedValue({ id: TENANT_ID })
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/suspend/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('returns 409 if tenant already suspended', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme', suspendedAt: new Date() })
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/suspend/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(409)
  })
})

// ── POST /api/superadmin/tenants/[id]/activate ──────────────────────────────

describe('[SEC-M2.2] /api/superadmin/tenants/[id]/activate — role enforcement', () => {
  beforeEach(() => { vi.clearAllMocks(); setRole('superadmin') })

  it('returns 403 for admin role', async () => {
    setRole('admin')
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/activate/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(403)
  })

  it('superadmin can activate suspended tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme', suspendedAt: new Date() })
    mockPrisma.tenant.update.mockResolvedValue({ id: TENANT_ID })
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/activate/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('returns 409 if tenant already active', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme', suspendedAt: null })
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/activate/route')
    const res = await POST(makeReq('http://localhost'), makeParams(TENANT_ID))
    expect(res.status).toBe(409)
  })
})
