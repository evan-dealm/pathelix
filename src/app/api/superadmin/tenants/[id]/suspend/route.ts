import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext, invalidateSuspensionCache } from '@/lib/data/context'
import { revokeSessionsForTenant } from '@/lib/session'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]/suspend')

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
    if (tenant.suspendedAt) return NextResponse.json({ error: 'Tenant déjà suspendu' }, { status: 409 })

    await prisma.tenant.update({
      where: { id },
      data: { suspendedAt: new Date(), suspendedBy: superadminId },
    })

    invalidateSuspensionCache(id)
    revokeSessionsForTenant(id)

    logSuperadminAction({
      superadminId,
      targetTenantId: id,
      isImpersonation: false,
      method: 'POST',
      path: `/api/superadmin/tenants/${id}/suspend`,
      action: 'tenant_suspended',
      details: { tenantName: tenant.name, tenantSlug: tenant.slug },
    })

    log.warn('Tenant suspended', { tenantId: id, tenantName: tenant.name, by: superadminId })
    return NextResponse.json({ ok: true, suspendedAt: new Date().toISOString() })
  } catch (err) {
    log.error('Suspend failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
