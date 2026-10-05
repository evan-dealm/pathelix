import { NextRequest, NextResponse }    from 'next/server'
import { tenantRefsError } from '@/lib/tenantRefs'
import { DriverUnavailabilitySchema }   from '@/lib/schemas'
import { createLogger }                 from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }              from '@/lib/metrics'
import { getTenantDb }                  from '@/lib/tenantDb'

const log = createLogger('/api/driver-unavailability')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))
  const driverId = params.get('driverId') ?? undefined

  try {
    const db = getTenantDb(tenantId)
    const where: Record<string, unknown> = {}
    if (driverId) where.driverId = driverId

    const [unavailabilities, total] = await Promise.all([
      db.driverUnavailability.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { startDate: 'asc' },
      }),
      db.driverUnavailability.count({ where }),
    ])

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/driver-unavailability', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/driver-unavailability', method: 'GET', status: '200' })

    return NextResponse.json({
      data:       unavailabilities,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/driver-unavailability', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = DriverUnavailabilitySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const db = getTenantDb(tenantId)
    const refErr = await tenantRefsError(db, parsed.data as Record<string, unknown>)
    if (refErr) return refErr
    const unavailability = await db.driverUnavailability.create({
      data: { ...parsed.data } as Parameters<typeof db.driverUnavailability.create>[0]['data'],
    })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/driver-unavailability', method: 'POST', status: '201' })
    return NextResponse.json(unavailability, { status: 201 })
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Une indisponibilité existe déjà pour ce chauffeur à cette date' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/driver-unavailability', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
