import { NextRequest, NextResponse } from 'next/server'
import bcrypt                        from 'bcryptjs'
import { UserCreateSchema }          from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { hasPermission }             from '@/lib/permissions'
import { auditAsync }                from '@/lib/audit'
import prisma                        from '@/lib/db'

const log = createLogger('/api/users')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const { role } = getRequestContext(req)

  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs' }, { status: 403 })
  }
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true, tenantId: true, email: true, role: true,
          firstName: true, lastName: true, driverRef: true,
          createdAt: true, updatedAt: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where: { tenantId } }),
    ])

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/users', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users', method: 'GET', status: '200' })

    return NextResponse.json({
      data:       users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' } })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs' }, { status: 403 })
  }
  if (!(await hasPermission(userId, role, 'manage_users'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = UserCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenantId     = getTenantId(req)
    const { password, ...rest } = parsed.data
    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: { tenantId, ...rest, passwordHash },
      select: {
        id: true, tenantId: true, email: true, role: true,
        firstName: true, lastName: true, driverRef: true,
        createdAt: true, updatedAt: true,
      },
    })

    auditAsync(req, 'user.create', 'User', user.id, { email: user.email, role: user.role })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/users', method: 'POST', status: '201' })
    return NextResponse.json(user, { status: 201 })
  } catch (err) {

    if (err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Un utilisateur avec cet email existe déjà' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/users', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
