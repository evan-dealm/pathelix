import { NextRequest, NextResponse } from 'next/server'
import bcrypt                        from 'bcryptjs'
import { UserCreateSchema }          from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { hasPermission }             from '@/lib/permissions'
import { auditAsync }                from '@/lib/audit'
import { getTenantDb }                from '@/lib/tenantDb'

const log = createLogger('/api/users')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const { role, userId } = getRequestContext(req)

  if (!(await hasPermission(userId, role, 'manage_users'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(500, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const db = getTenantDb(tenantId)
    const [users, total] = await Promise.all([
      db.user.findMany({
        select: {
          id: true, tenantId: true, email: true, role: true,
          firstName: true, lastName: true, driverRef: true,
          createdAt: true, updatedAt: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.user.count({}),
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
    // Only an admin may create admins (see users/[id]/route.ts canManageTarget).
    if (rest.role === 'ADMIN' && role !== 'admin' && role !== 'superadmin') {
      return NextResponse.json({ error: 'Seul un administrateur peut créer un compte administrateur' }, { status: 403 })
    }
    const userDb = getTenantDb(tenantId)
    if (rest.driverRef && !(await userDb.driver.findFirst({ where: { id: rest.driverRef }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Chauffeur lié introuvable' }, { status: 422 })
    }
    const passwordHash = await bcrypt.hash(password, 12)

    const user = await userDb.user.create({
      data: { ...rest, email: rest.email.trim().toLowerCase(), passwordHash } as Parameters<typeof userDb.user.create>[0]['data'],
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
