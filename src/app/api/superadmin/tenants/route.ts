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
  // First administrator account, created with the organisation so that someone can log in.
  admin: z.object({
    email:     z.string().email(),
    password:  z.string().min(8).max(1000),
    firstName: z.string().max(100).optional(),
    lastName:  z.string().max(100).optional(),
  }).optional(),
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

  const { admin } = parsed.data
  const adminEmail = admin?.email.trim().toLowerCase()

  try {
    // Emails are unique across the platform: refused before anything is created.
    if (adminEmail && (await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Cet email est déjà utilisé par un autre compte' }, { status: 409 })
    }

    let adminUser: { email: string; passwordHash: string; role: 'ADMIN'; firstName: string; lastName: string } | undefined
    if (admin && adminEmail) {
      const { hash } = await import('bcryptjs')
      adminUser = {
        email:        adminEmail,
        passwordHash: await hash(admin.password, 12),
        role:         'ADMIN',
        firstName:    admin.firstName ?? '',
        lastName:     admin.lastName ?? '',
      }
    }

    // One nested write: the organisation never exists without the account that was asked for.
    const tenant = await prisma.tenant.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        plan: parsed.data.plan ?? 'FREE',
        ...(adminUser ? { users: { create: adminUser } } : {}),
      },
    })

    await logSuperadminAction({
      superadminId,
      targetTenantId: tenant.id,
      isImpersonation: false,
      method: 'POST',
      path: '/api/superadmin/tenants',
      action: 'tenant_created',
      details: {
        tenantName: tenant.name, tenantSlug: tenant.slug, plan: tenant.plan,
        ...(adminEmail ? { adminEmail } : {}),
      },
    })

    log.info('Tenant created', { tenantId: tenant.id, slug: tenant.slug })
    return NextResponse.json(tenant, { status: 201 })
  } catch (err) {

    if (err instanceof Error && err.message.includes('Unique')) {
      // The email was free a moment ago: a concurrent creation took it.
      const onEmail = err.message.includes('email')
      return NextResponse.json(
        { error: onEmail ? 'Cet email est déjà utilisé par un autre compte' : 'Ce slug est déjà utilisé' },
        { status: 409 },
      )
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
