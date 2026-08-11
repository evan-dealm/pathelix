import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]')

type Params = { params: Promise<{ id: string }> }

const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
  trade: z.string().min(1).max(50).nullable().optional(),
  maxDrivers: z.number().int().positive().nullable().optional(),
  maxMissions: z.number().int().positive().nullable().optional(),
  timezone: z.string().max(100).optional(),
  locale: z.string().max(20).optional(),
  contactEmail: z.string().email().max(200).optional().or(z.literal('')),
})

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  const { id } = await params

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, email: true, role: true, firstName: true, lastName: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        settings: true,
        _count: {
          select: {
            drivers: true,
            missions: true,
            vehicles: true,
            plans: true,
            exutoires: true,
            clients: true,
            sites: true,
            auditLogs: true,
          },
        },
      },
    })

    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [recentMissions, recentPlans, recentAudit] = await Promise.all([
      prisma.mission.count({ where: { tenantId: id, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.plan.count({ where: { tenantId: id, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.auditLog.count({ where: { tenantId: id, createdAt: { gte: thirtyDaysAgo } } }),
    ])

    return NextResponse.json({
      ...tenant,
      recentActivity: {
        missions30d: recentMissions,
        plans30d: recentPlans,
        auditEvents30d: recentAudit,
      },
    })
  } catch (err) {
    log.error('GET failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  const { id } = await params

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = UpdateTenantSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenant = await prisma.tenant.update({
      where: { id },
      data: parsed.data,
    })

    log.info('Tenant updated', { tenantId: id, changes: Object.keys(parsed.data) })
    return NextResponse.json(tenant)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })
    }
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  const { id } = await params

  try {

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { users: true, drivers: true, missions: true } } },
    })

    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    const totalResources = tenant._count.users + tenant._count.drivers + tenant._count.missions
    if (totalResources > 0) {

      log.warn('Deleting tenant with active resources', {
        tenantId: id,
        users: tenant._count.users,
        drivers: tenant._count.drivers,
        missions: tenant._count.missions,
      })
    }

    await prisma.tenant.delete({ where: { id } })

    logSuperadminAction({
      superadminId,
      targetTenantId: id,
      isImpersonation: false,
      method: 'DELETE',
      path: `/api/superadmin/tenants/${id}`,
      action: 'tenant_deleted',
      details: { tenantName: tenant.name, tenantSlug: tenant.slug, resourceCount: totalResources },
    })

    log.info('Tenant deleted', { tenantId: id, name: tenant.name })
    return NextResponse.json({ ok: true, deleted: tenant.name })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
