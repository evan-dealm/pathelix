import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { createRateLimiter } from '@/lib/rateLimit'
import { createLogger } from '@/lib/logger'
import { getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/auth/change-password')
const _pwdRl = createRateLimiter(3, 3600_000)

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1000, 'Mot de passe trop long'),
  newPassword:     z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères').max(1000, 'Mot de passe trop long'),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null

  if (!session) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  if (!await _pwdRl.check(session.sub)) {
    return NextResponse.json(
      { error: 'Trop de changements de mot de passe. Réessayez plus tard.' },
      { status: 429 },
    )
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { currentPassword, newPassword } = parsed.data

  try {
    const { compare, hash } = await import('bcryptjs')

    const db = getTenantDb(session.tenantId)
    const user = await db.user.findFirst({
      where: { id: session.sub },
    })

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    }

    const ok = await compare(currentPassword, user.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 401 })
    }

    const newHash = await hash(newPassword, 12)
    await db.user.update({
      where: { id: user.id },
      data:  { passwordHash: newHash },
    })

    log.info('password changed', { userId: user.id, tenantId: session.tenantId })

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('change-password failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
