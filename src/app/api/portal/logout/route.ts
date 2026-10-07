import { NextRequest, NextResponse } from 'next/server'
import { PORTAL_COOKIE, verifyPortalToken } from '@/lib/portal/auth'
import { unscopedPrisma } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/portal/logout')

/**
 * Signs the customer out for real: the session version of the portal user is bumped, so the
 * token — which used to stay valid for its whole lifetime after "Se déconnecter" — is refused
 * from now on (requirePortal compares it on every request).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = verifyPortalToken(req.cookies.get(PORTAL_COOKIE)?.value)
  if (session) {
    try {
      // The id comes from our own signed token; the version check keeps a replayed old token
      // from signing out a session opened since.
      await unscopedPrisma.portalUser.updateMany({
        where: { id: session.sub, tenantId: session.tenantId, sessionVersion: session.sv },
        data:  { sessionVersion: { increment: 1 } },
      })
    } catch (err) {
      log.warn('Portal session revocation failed at logout', { err: err instanceof Error ? err.message : String(err) })
    }
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(PORTAL_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return res
}
