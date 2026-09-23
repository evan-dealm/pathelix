import { NextRequest, NextResponse } from 'next/server'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }         from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { redisCache }                from '@/lib/redisCache'
import { getTenantDb }                from '@/lib/tenantDb'

const log = createLogger('/api/holidays/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  const { id } = await params

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.holiday.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Jour férié introuvable' }, { status: 404 })

    await db.holiday.delete({ where: { id } })

    void redisCache.invalidateAll('holidays', tenantId)
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/holidays/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/holidays/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
