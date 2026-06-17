import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    update:    vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/session', () => ({
  verifySession:  vi.fn(),
  SESSION_COOKIE: 'session',
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => true), headers: vi.fn(() => ({})) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC:  { API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash:    vi.fn(),
  },
  compare: vi.fn(),
  hash:    vi.fn(),
}))

import { POST as changePasswordPOST } from '@/app/api/auth/change-password/route'
import { GET  as meGET }              from '@/app/api/auth/me/route'
import { verifySession }              from '@/lib/session'

function makePost(url: string, body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers['Cookie'] = cookie
  return new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

function makeGet(url: string): NextRequest {
  return new NextRequest(url)
}

// ── auth/change-password ──────────────────────────────────────────────────────

describe('POST /api/auth/change-password', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when no session cookie', async () => {
    vi.mocked(verifySession).mockResolvedValue(null)
    const res = await changePasswordPOST(makePost('http://localhost/api/auth/change-password', {
      currentPassword: 'OldPass123!',
      newPassword:     'NewPass123456!',
    }))
    expect(res.status).toBe(401)
  })

  it('changes password and returns ok (200)', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', passwordHash: '$2b$12$hash' })
    mockPrisma.user.update.mockResolvedValue({ id: 'user-1' })

    // Route uses dynamic import `const { compare, hash } = await import('bcryptjs')`
    // so we must mock the named exports, not default
    const bcrypt = await import('bcryptjs')
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(bcrypt.hash).mockResolvedValue('$2b$12$newhash' as never)

    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: JSON.stringify({ currentPassword: 'OldPass123!', newPassword: 'NewPass123456!' }),
    })
    const res  = await changePasswordPOST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 401 when current password is wrong', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', passwordHash: '$2b$12$hash' })

    const bcrypt = await import('bcryptjs')
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: JSON.stringify({ currentPassword: 'WrongPass!', newPassword: 'NewPass123456!' }),
    })
    const res = await changePasswordPOST(req)
    expect(res.status).toBe(401)
  })

  it('returns 404 when user not found in tenant', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: JSON.stringify({ currentPassword: 'OldPass123!', newPassword: 'NewPass123456!' }),
    })
    const res = await changePasswordPOST(req)
    expect(res.status).toBe(404)
  })

  it('returns 422 when newPassword too short (< 12 chars)', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: JSON.stringify({ currentPassword: 'OldPass123!', newPassword: 'short' }),
    })
    const res = await changePasswordPOST(req)
    expect(res.status).toBe(422)
  })

  it('returns 422 when currentPassword missing', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: JSON.stringify({ newPassword: 'NewPass123456!' }),
    })
    const res = await changePasswordPOST(req)
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: '{bad',
    })
    const res = await changePasswordPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(verifySession).mockResolvedValue({
      sub: 'user-1', tenantId: 'tenant-1', role: 'admin', iat: 0, exp: 9999999999,
    })
    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'))

    const req = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=valid-token' },
      body: JSON.stringify({ currentPassword: 'OldPass123!', newPassword: 'NewPass123456!' }),
    })
    const res = await changePasswordPOST(req)
    expect(res.status).toBe(500)
  })
})

// ── auth/me ──────────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns userId, role, tenantId from context (200)', async () => {
    const { getRequestContext } = await import('@/lib/data/context')
    vi.mocked(getRequestContext).mockReturnValue({
      userId: 'user-1', role: 'admin', tenantId: 'tenant-1', requestId: 'r1', trade: null,
    })

    const res  = await meGET(makeGet('http://localhost/api/auth/me'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.userId).toBe('user-1')
    expect(json.role).toBe('admin')
    expect(json.tenantId).toBe('tenant-1')
  })

  it('returns correct role for dispatcher', async () => {
    const { getRequestContext } = await import('@/lib/data/context')
    vi.mocked(getRequestContext).mockReturnValue({
      userId: 'user-2', role: 'dispatcher', tenantId: 'tenant-2', requestId: 'r2', trade: null,
    })

    const res  = await meGET(makeGet('http://localhost/api/auth/me'))
    const json = await res.json()

    expect(json.role).toBe('dispatcher')
    expect(json.tenantId).toBe('tenant-2')
  })
})
