import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '@/lib/session'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/superadmin/impersonate')

const ImpersonateSchema = z.object({
  tenantId: z.string().min(1),
})

export async function POST(req: NextRequest): Promise<NextResponse> {

  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ImpersonateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { tenantId } = parsed.data

  try {

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    // sv: the superadmin's own session version — the impersonation token is revoked together
    // with the superadmin's sessions (sessionRevocation.ts resolves `sa:<id>` to that user).
    const sa = await prisma.user.findUnique({ where: { id: superadminId }, select: { sessionVersion: true } })
    const token = await signSession({
      sv:       sa?.sessionVersion ?? 0,
      sub:      `sa:${superadminId}`,
      role:     'admin',
      tenantId: tenant.id,
      trade:    tenant.trade ?? undefined,
      exp:      Math.floor(Date.now() / 1000) + 900,
    })

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId:   superadminId,
        action:   'superadmin_impersonate',
        entityType: 'tenant',
        entityId:   tenant.id,
        changes: { superadminId, tenantName: tenant.name, tenantSlug: tenant.slug } as Record<string, string>,
      },
    })

    log.warn('Superadmin impersonation', {
      superadminId,
      targetTenant: tenant.id,
      tenantName: tenant.name,
    })

    const response = NextResponse.json({
      ok: true,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      redirectTo: '/admin',
    })
    response.cookies.set(SESSION_COOKIE, token, {
      ...COOKIE_OPTIONS,
      maxAge: 900,
      path: '/',
    })

    return response
  } catch (err) {
    log.error('Impersonate failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
