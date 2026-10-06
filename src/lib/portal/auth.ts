import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { unscopedPrisma, getTenantDb, type TenantDb } from '@/lib/tenantDb'

/**
 * Customer portal sessions. Completely separate from staff sessions:
 * - own cookie (`pathelix_portal`), own signing key (derived from SESSION_SECRET with a distinct
 *   label) and a `customer` role the staff verifier rejects — a portal token can never pass the
 *   admin middleware, and a staff token is never read here;
 * - every portal query is scoped to the tenant AND the customer (clientId) of the session;
 * - `sv` (session version) is checked against the database on each request: disabling a user or
 *   resetting their password revokes their sessions at once.
 */

export const PORTAL_COOKIE = 'pathelix_portal'
const TTL_SEC = 8 * 3600

export interface PortalSession { sub: string; tenantId: string; clientId: string; sv: number; exp: number }

function key(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is required')
  return `${s}:customer-portal`
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

export function signPortalToken(p: Omit<PortalSession, 'exp'>, ttlSec = TTL_SEC): string {
  const body = b64(JSON.stringify({ ...p, role: 'customer', exp: Math.floor(Date.now() / 1000) + ttlSec }))
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'PORTAL' }))
  const sig = createHmac('sha256', key()).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export function verifyPortalToken(token: string | undefined): PortalSession | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = createHmac('sha256', key()).update(`${parts[0]}.${parts[1]}`).digest()
  const got = Buffer.from(parts[2], 'base64url')
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  try {
    const raw = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    if (raw.role !== 'customer' || typeof raw.sub !== 'string' || typeof raw.tenantId !== 'string' || typeof raw.clientId !== 'string') return null
    if (typeof raw.exp !== 'number' || raw.exp < Math.floor(Date.now() / 1000)) return null
    return { sub: raw.sub, tenantId: raw.tenantId, clientId: raw.clientId, sv: typeof raw.sv === 'number' ? raw.sv : -1, exp: raw.exp }
  } catch {
    return null
  }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export function setPortalCookie(res: NextResponse, token: string): void {
  res.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', path: '/', maxAge: TTL_SEC,
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS !== 'false',
  })
}

export interface PortalContext { session: PortalSession; db: TenantDb; user: { id: string; name: string; email: string } }

/**
 * Resolves the portal session of a request (cookie → signature → user still enabled with the same
 * session version, tenant not suspended). Returns a 401 response otherwise.
 */
export async function requirePortal(req: NextRequest): Promise<PortalContext | NextResponse> {
  const session = verifyPortalToken(req.cookies.get(PORTAL_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'Session expirée — reconnectez-vous', code: 'UNAUTHENTICATED' }, { status: 401 })
  // Portal user lookup by id: the id comes from our own signed token (cross-tenant resolution).
  const user = await unscopedPrisma.portalUser.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, tenantId: true, clientId: true, sessionVersion: true, disabled: true, tenant: { select: { suspendedAt: true } } },
  })
  if (!user || user.disabled || user.sessionVersion !== session.sv || user.tenantId !== session.tenantId || user.clientId !== session.clientId || user.tenant.suspendedAt) {
    return NextResponse.json({ error: 'Session expirée — reconnectez-vous', code: 'UNAUTHENTICATED' }, { status: 401 })
  }
  return { session, db: getTenantDb(session.tenantId), user: { id: user.id, name: user.name, email: user.email } }
}
