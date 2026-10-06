import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { unscopedPrisma } from '@/lib/tenantDb'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { signPortalToken, setPortalCookie } from '@/lib/portal/auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/portal/login')
const LoginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
// Same idea as the staff login: an unknown e-mail costs the same time as a wrong password.
const DUMMY_HASH = '$2a$12$gJokVt6sGgIZXVkM4dp5X.ov8ZqUBF7VagdkvgJpEClAZaR16V6.u'
const ipLimiter = createRateLimiter(20, 15 * 60_000, { redis: true, prefix: 'rl:portal-login-ip' })
const emailLimiter = createRateLimiter(8, 15 * 60_000, { redis: true, prefix: 'rl:portal-login-email' })

/** Customer portal sign-in (e-mail + password). Rate limited per IP and per account. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = LoginSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'E-mail et mot de passe requis' }, { status: 422 })
  const email = parsed.data.email.trim().toLowerCase()
  if (!(await ipLimiter.check(getClientIp(req.headers))) || !(await emailLimiter.check(email))) {
    return NextResponse.json({ error: 'Trop de tentatives — réessayez dans 15 minutes' }, { status: 429 })
  }
  // Cross-tenant by e-mail: the e-mail is globally unique and is what resolves the account.
  const user = await unscopedPrisma.portalUser.findUnique({
    where: { email },
    select: { id: true, tenantId: true, clientId: true, passwordHash: true, sessionVersion: true, disabled: true, tenant: { select: { suspendedAt: true } } },
  })
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !user.passwordHash || !ok || user.disabled || user.tenant.suspendedAt) {
    log.info('Portal login refused', { known: !!user })
    return NextResponse.json({ error: 'E-mail ou mot de passe incorrect' }, { status: 401 })
  }
  await unscopedPrisma.portalUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  const res = NextResponse.json({ ok: true })
  setPortalCookie(res, signPortalToken({ sub: user.id, tenantId: user.tenantId, clientId: user.clientId, sv: user.sessionVersion }))
  return res
}
