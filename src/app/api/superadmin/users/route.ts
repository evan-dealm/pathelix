import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/users')

const CreateUserSchema = z.object({
  tenantId:  z.string().min(1),
  email:     z.string().email(),
  password:  z.string().min(8).max(1000),

  role:      z.enum(['ADMIN', 'DISPATCHER', 'DRIVER']),
  firstName: z.string().optional(),
  lastName:  z.string().optional(),
  driverRef: z.string().optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const tenantId  = searchParams.get('tenantId')
  const roleParam = searchParams.get('role')
  const search    = searchParams.get('search')
  const limit     = Math.min(100, parseInt(searchParams.get('limit') ?? '50', 10) || 50)
  const offset    = parseInt(searchParams.get('offset') ?? '0', 10) || 0

  try {
    const where: Record<string, unknown> = {}
    if (tenantId)  where.tenantId = tenantId
    if (roleParam) where.role = roleParam
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, tenantId: true, email: true, role: true,
          firstName: true, lastName: true, driverRef: true,
          createdAt: true, updatedAt: true,
          tenant: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ])

    return NextResponse.json({ users, total, limit, offset })
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

  const parsed = CreateUserSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {

    const tenant = await prisma.tenant.findUnique({ where: { id: parsed.data.tenantId } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    const { hash } = await import('bcryptjs')
    const passwordHash = await hash(parsed.data.password, 12)

    const user = await prisma.user.create({
      data: {
        tenantId:     parsed.data.tenantId,
        email:        parsed.data.email.trim().toLowerCase(),
        passwordHash,
        role:         parsed.data.role,
        firstName:    parsed.data.firstName ?? '',
        lastName:     parsed.data.lastName ?? '',
        driverRef:    parsed.data.driverRef,
      },
      select: {
        id: true, tenantId: true, email: true, role: true,
        firstName: true, lastName: true, createdAt: true,
      },
    })

    await logSuperadminAction({
      superadminId,
      targetTenantId: user.tenantId,
      isImpersonation: false,
      method: 'POST',
      path: '/api/superadmin/users',
      action: 'user_created',
      details: { userId: user.id, email: user.email, role: user.role },
    })

    log.info('User created by superadmin', { userId: user.id, tenantId: user.tenantId })
    return NextResponse.json(user, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'Email déjà utilisé pour ce tenant' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
