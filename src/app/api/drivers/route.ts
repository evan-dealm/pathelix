import { NextRequest, NextResponse }   from 'next/server'
import { ForeignTenantRefError } from '@/lib/tenantRefs'
import { DriverSchema }                from '@/lib/schemas'
import { createLogger }                from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getAllDrivers, createDriver } from '@/lib/data/drivers'
import { redisCache }                  from '@/lib/redisCache'
import { auditAsync }                  from '@/lib/audit'
import { metrics, METRIC }             from '@/lib/metrics'
import { hasPermission }               from '@/lib/permissions'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/drivers')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const drivers = await redisCache.getOrSet(
      'drivers',
      tenantId,
      () => getAllDrivers(tenantId),
      30_000,
    )

    const start = (page - 1) * limit
    const paged = drivers.slice(start, start + limit)

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/drivers', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS,   { route: '/api/drivers', method: 'GET', status: '200' })

    return NextResponse.json({
      data:       paged,
      pagination: { page, limit, total: drivers.length, pages: Math.ceil(drivers.length / limit) },
    }, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/drivers', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_drivers'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = DriverSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenantId = getTenantId(req)

    const [tenant, count] = await Promise.all([
      unscopedPrisma.tenant.findUnique({ where: { id: tenantId }, select: { maxDrivers: true } }),
      getTenantDb(tenantId).driver.count({ where: { archived: false } }),
    ])
    if (tenant?.maxDrivers !== null && tenant?.maxDrivers !== undefined) {
      if (count >= tenant.maxDrivers) {
        return NextResponse.json({ error: `Limite de ${tenant.maxDrivers} chauffeurs atteinte pour ce plan` }, { status: 403 })
      }
    }

    const driver   = await createDriver(tenantId, parsed.data)
    await Promise.all([
      redisCache.invalidateAll('drivers', tenantId),
      redisCache.invalidateAll('driver-list', tenantId),
    ])

    auditAsync(req, 'driver.create', 'Driver', driver.id, { firstName: parsed.data.firstName, lastName: parsed.data.lastName, sector: parsed.data.sector })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/drivers', method: 'POST', status: '201' })
    return NextResponse.json(driver, { status: 201, headers: { 'Cache-Control': 'no-cache' } })
  } catch (err) {
    if (err instanceof ForeignTenantRefError) return NextResponse.json({ error: err.message }, { status: 422 })
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/drivers', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
