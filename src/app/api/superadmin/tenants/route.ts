import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants')

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        _count: {
          select: {
            users: true,
            drivers: true,
            missions: true,
            vehicles: true,
            plans: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const enriched = tenants.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      trade: t.trade,
      maxDrivers: t.maxDrivers,
      maxMissions: t.maxMissions,
      suspendedAt: t.suspendedAt,
      suspendedBy: t.suspendedBy,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      stats: {
        users: t._count.users,
        drivers: t._count.drivers,
        missions: t._count.missions,
        vehicles: t._count.vehicles,
        plans: t._count.plans,
      },
    }))

    return NextResponse.json(enriched)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = CreateTenantSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        plan: parsed.data.plan ?? 'FREE',
      },
    })

    await logSuperadminAction({
      superadminId,
      targetTenantId: tenant.id,
      isImpersonation: false,
      method: 'POST',
      path: '/api/superadmin/tenants',
      action: 'tenant_created',
      details: { tenantName: tenant.name, tenantSlug: tenant.slug, plan: tenant.plan },
    })

    log.info('Tenant created', { tenantId: tenant.id, slug: tenant.slug })
    return NextResponse.json(tenant, { status: 201 })
  } catch (err) {

    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'Ce slug est déjà utilisé' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
