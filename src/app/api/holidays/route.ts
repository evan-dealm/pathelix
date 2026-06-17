import { NextRequest, NextResponse } from 'next/server'
import { HolidaySchema }            from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { redisCache }                from '@/lib/redisCache'
import prisma                        from '@/lib/db'

const log = createLogger('/api/holidays')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const qualifier = `p${page}_l${limit}`
    const result = await redisCache.getOrSet(
      'holidays',
      tenantId,
      async () => {
        const [holidays, total] = await Promise.all([
          prisma.holiday.findMany({
            where: { tenantId },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { date: 'asc' },
          }),
          prisma.holiday.count({ where: { tenantId } }),
        ])
        return { data: holidays, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      },
      3_600_000,
      qualifier,
    )

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/holidays', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/holidays', method: 'GET', status: '200' })

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=3600, stale-while-revalidate=7200' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/holidays', type: 'server_error' })
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

  const parsed = HolidaySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const holiday  = await prisma.holiday.create({
      data: { tenantId, ...parsed.data },
    })

    void redisCache.invalidateAll('holidays', tenantId)
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/holidays', method: 'POST', status: '201' })
    return NextResponse.json(holiday, { status: 201 })
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Un jour férié existe déjà pour cette date' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/holidays', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
