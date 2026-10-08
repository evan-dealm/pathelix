import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext, invalidateSuspensionCache } from '@/lib/data/context'
import { unrevokeSessionsForTenant } from '@/lib/session'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]/activate')

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })
    if (!tenant.suspendedAt) return NextResponse.json({ error: 'Tenant déjà actif' }, { status: 409 })

    await prisma.tenant.update({
      where: { id },
      data: { suspendedAt: null, suspendedBy: null },
    })

    invalidateSuspensionCache(id)
    unrevokeSessionsForTenant(id)

    await logSuperadminAction({
      superadminId,
      targetTenantId: id,
      isImpersonation: false,
      method: 'POST',
      path: `/api/superadmin/tenants/${id}/activate`,
      action: 'tenant_activated',
      details: { tenantName: tenant.name, suspendedSince: tenant.suspendedAt?.toISOString() },
    })

    log.info('Tenant activated', { tenantId: id, tenantName: tenant.name, by: superadminId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('Activate failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
