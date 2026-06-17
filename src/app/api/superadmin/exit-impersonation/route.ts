import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { verifySession, signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '@/lib/session'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/superadmin/exit-impersonation')

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null

  if (!session || !session.sub.startsWith('sa:')) {
    return NextResponse.json({ error: 'Pas en mode impersonation' }, { status: 400 })
  }

  const realSuperadminId = session.sub.slice(3)

  try {

    const superadmin = await prisma.user.findUnique({
      where: { id: realSuperadminId },
      select: { id: true, tenantId: true, role: true },
    })

    if (!superadmin || superadmin.role !== 'SUPERADMIN') {

      const response = NextResponse.json({ ok: true, redirectTo: '/login' })
      response.cookies.delete(SESSION_COOKIE)
      return response
    }

    const newToken = await signSession({
      sub:      superadmin.id,
      role:     'superadmin',
      tenantId: superadmin.tenantId,
    })

    log.info('Exited impersonation', { superadminId: superadmin.id })

    const response = NextResponse.json({ ok: true, redirectTo: '/superadmin' })
    response.cookies.set(SESSION_COOKIE, newToken, {
      ...COOKIE_OPTIONS,
      maxAge: 86400,
      path: '/',
    })
    return response
  } catch (err) {
    log.error('Exit impersonation failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
