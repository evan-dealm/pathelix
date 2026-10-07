import { NextRequest, NextResponse } from 'next/server'
import bcrypt                        from 'bcryptjs'
import { z }                         from 'zod'
import { createLogger }              from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { createRateLimiter }         from '@/lib/rateLimit'
import { getTenantDb }                from '@/lib/tenantDb'
import { revokeUserSessions }        from '@/lib/sessionRevocation'
import { auditAsync }                from '@/lib/audit'

const log = createLogger('/api/users/[id]/reset-password')
const _resetRl = createRateLimiter(10, 60_000, { redis: true, prefix: 'rl:pwd-reset' })
type Params = { params: Promise<{ id: string }> }

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères').max(1000),
})

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, role } = getRequestContext(req)

  if (role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }

  if (!(await _resetRl.check(`reset-pw:${tenantId}`))) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = ResetPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.user.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
    await db.user.update({ where: { id }, data: { passwordHash } })
    await revokeUserSessions(id)
    auditAsync(req, 'user.reset_password', 'User', id, { email: existing.email })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users/[id]/reset-password', method: 'POST', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('POST failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users/[id]/reset-password', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
