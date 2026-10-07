import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import { revokeUserSessions, sessionUserId } from '@/lib/sessionRevocation'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/auth/logout')
const MAX_BODY_BYTES = 1024

/**
 * Signs the user out for real. Clearing the cookie alone left the token valid until its expiry
 * (24 h): a copy of it — shared computer, proxy log, stolen device backup — kept working after
 * the user had clicked "Se déconnecter". The user's session version is bumped, which invalidates
 * every token issued before, on every instance. Signing out therefore signs out of all devices.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      const session = await verifySession(token)
      if (session) await revokeUserSessions(sessionUserId(session))
    } catch (err) {
      // The cookie is cleared whatever happens: a database hiccup must not keep the user signed in.
      log.warn('Session revocation failed at logout', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  })
  return response
}
