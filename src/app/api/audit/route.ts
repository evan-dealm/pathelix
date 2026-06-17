import { NextRequest, NextResponse } from 'next/server'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import prisma                        from '@/lib/db'

const log = createLogger('/api/audit')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  const entityType = params.get('entityType') ?? undefined
  const entityId   = params.get('entityId')   ?? undefined

  try {
    const where: Record<string, unknown> = { tenantId }
    if (entityType) where.entityType = entityType
    if (entityId)   where.entityId   = entityId

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ])

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/audit', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/audit', method: 'GET', status: '200' })

    return NextResponse.json({
      data:       logs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message.slice(0, 200) : 'unknown error' })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/audit', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const params  = req.nextUrl.searchParams
  const before  = params.get('before')
  const after   = params.get('after')
  const confirm = params.get('confirm')

  if (!before || !after) {
    return NextResponse.json(
      { error: 'Les paramètres before et after (dates ISO) sont requis pour limiter la suppression' },
      { status: 400 },
    )
  }

  if (confirm !== 'true') {
    return NextResponse.json(
      { error: 'Ajoutez confirm=true pour confirmer la suppression' },
      { status: 400 },
    )
  }

  const afterDate  = new Date(after)
  const beforeDate = new Date(before)
  if (isNaN(afterDate.getTime()) || isNaN(beforeDate.getTime())) {
    return NextResponse.json({ error: 'Dates invalides' }, { status: 400 })
  }

  const MAX_RANGE_DAYS = 90
  const rangeDays = (beforeDate.getTime() - afterDate.getTime()) / (1000 * 60 * 60 * 24)
  if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `La plage de dates ne peut pas dépasser ${MAX_RANGE_DAYS} jours` },
      { status: 400 },
    )
  }

  try {
    const result = await prisma.auditLog.deleteMany({
      where: {
        tenantId,
        createdAt: { gte: afterDate, lte: beforeDate },
      },
    })
    log.info('Audit logs purged', { tenantId, after, before, count: result.count })
    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (err) {
    log.error('DELETE failed', { err: err instanceof Error ? err.message.slice(0, 200) : 'unknown error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
