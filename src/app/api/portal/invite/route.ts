import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { unscopedPrisma } from '@/lib/tenantDb'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { hashInviteToken, setPortalCookie, signPortalToken } from '@/lib/portal/auth'

const AcceptSchema = z.object({
  token:    z.string().min(20).max(200),
  password: z.string().min(10, 'Au moins 10 caractères').max(200),
  name:     z.string().trim().max(120).optional(),
})
const limiter = createRateLimiter(20, 15 * 60_000, { redis: true, prefix: 'rl:portal-invite' })

/** What an invitation link is for (name of the company), without revealing anything else. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!(await limiter.check(getClientIp(req.headers)))) return NextResponse.json({ error: 'Trop de tentatives' }, { status: 429 })
  const u = token.length >= 20 ? await unscopedPrisma.portalUser.findUnique({
    where: { inviteTokenHash: hashInviteToken(token) },
    select: { email: true, inviteExpiresAt: true, client: { select: { name: true } }, tenant: { select: { name: true, settings: { select: { companyDisplayName: true } } } } },
  }) : null
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt < new Date()) return NextResponse.json({ error: 'Lien expiré ou déjà utilisé' }, { status: 404 })
  return NextResponse.json({ email: u.email, client: u.client.name, company: u.tenant.settings?.companyDisplayName || u.tenant.name })
}

/** Accepts an invitation (or a reset link): sets the password, consumes the token, signs in. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await limiter.check(getClientIp(req.headers)))) return NextResponse.json({ error: 'Trop de tentatives' }, { status: 429 })
  const parsed = AcceptSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const u = await unscopedPrisma.portalUser.findUnique({ where: { inviteTokenHash: hashInviteToken(parsed.data.token) }, select: { id: true, tenantId: true, clientId: true, inviteExpiresAt: true, sessionVersion: true, disabled: true } })
  if (!u || u.disabled || !u.inviteExpiresAt || u.inviteExpiresAt < new Date()) return NextResponse.json({ error: 'Lien expiré ou déjà utilisé' }, { status: 404 })
  const updated = await unscopedPrisma.portalUser.update({
    where: { id: u.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.password, 12), inviteTokenHash: null, inviteExpiresAt: null,
      sessionVersion: { increment: 1 }, lastLoginAt: new Date(), ...(parsed.data.name ? { name: parsed.data.name } : {}),
    },
    select: { sessionVersion: true },
  })
  const res = NextResponse.json({ ok: true })
  setPortalCookie(res, signPortalToken({ sub: u.id, tenantId: u.tenantId, clientId: u.clientId, sv: updated.sessionVersion }))
  return res
}
