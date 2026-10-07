import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

const verifySession = vi.hoisted(() => vi.fn())
const revokeUserSessions = vi.hoisted(() => vi.fn(async (_userId: string) => undefined))
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'session', verifySession }))
vi.mock('@/lib/sessionRevocation', () => ({
  revokeUserSessions,
  sessionUserId: (s: { sub: string }) => (s.sub.startsWith('sa:') ? s.sub.slice(3) : s.sub),
}))

const portalUpdateMany = vi.hoisted(() => vi.fn(async (_args: unknown) => ({ count: 1 })))
const verifyPortalToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: { portalUser: { updateMany: portalUpdateMany } } }))
vi.mock('@/lib/portal/auth', () => ({ PORTAL_COOKIE: 'pathelix_portal', verifyPortalToken }))

import { POST as logout } from '@/app/api/auth/logout/route'
import { POST as portalLogout } from '@/app/api/portal/logout/route'

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: cookie ? { cookie } : {} })

beforeEach(() => { vi.clearAllMocks() })

// Found by replaying a cookie after "Se déconnecter": it still opened the API for 24 hours.
describe('POST /api/auth/logout — the session is revoked, not only the cookie cleared', () => {
  it('invalidates the sessions of the user who signs out', async () => {
    verifySession.mockResolvedValue({ sub: 'user-1', role: 'dispatcher', tenantId: 't1' })
    const res = await logout(req('/api/auth/logout', 'session=tok'))
    expect(res.status).toBe(200)
    expect(revokeUserSessions).toHaveBeenCalledWith('user-1')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('an impersonation session revokes the superadmin behind it', async () => {
    verifySession.mockResolvedValue({ sub: 'sa:super-9', role: 'admin', tenantId: 't1' })
    await logout(req('/api/auth/logout', 'session=tok'))
    expect(revokeUserSessions).toHaveBeenCalledWith('super-9')
  })

  it('does nothing more than clearing the cookie without a valid session', async () => {
    verifySession.mockResolvedValue(null)
    expect((await logout(req('/api/auth/logout', 'session=forged'))).status).toBe(200)
    expect((await logout(req('/api/auth/logout'))).status).toBe(200)
    expect(revokeUserSessions).not.toHaveBeenCalled()
  })

  it('still clears the cookie when the database is down', async () => {
    verifySession.mockResolvedValue({ sub: 'user-1', role: 'admin', tenantId: 't1' })
    revokeUserSessions.mockRejectedValueOnce(new Error('db down'))
    const res = await logout(req('/api/auth/logout', 'session=tok'))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('POST /api/portal/logout — the customer session is revoked', () => {
  it('bumps the session version of that portal user, only if the token is the current one', async () => {
    verifyPortalToken.mockReturnValue({ sub: 'pu-1', tenantId: 't1', clientId: 'c1', sv: 3, exp: 9_999_999_999 })
    const res = await portalLogout(req('/api/portal/logout', 'pathelix_portal=tok'))
    expect(res.status).toBe(200)
    expect(portalUpdateMany).toHaveBeenCalledWith({
      where: { id: 'pu-1', tenantId: 't1', sessionVersion: 3 },
      data:  { sessionVersion: { increment: 1 } },
    })
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('touches nothing without a valid portal token', async () => {
    verifyPortalToken.mockReturnValue(null)
    expect((await portalLogout(req('/api/portal/logout'))).status).toBe(200)
    expect(portalUpdateMany).not.toHaveBeenCalled()
  })
})
