import { NextRequest, NextResponse } from 'next/server'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }         from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { redisCache }                from '@/lib/redisCache'
import prisma                        from '@/lib/db'

const log = createLogger('/api/holidays/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  const { id } = await params

  try {
    const existing = await prisma.holiday.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Jour férié introuvable' }, { status: 404 })

    await prisma.holiday.delete({ where: { id, tenantId } })

    void redisCache.invalidateAll('holidays', tenantId)
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/holidays/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/holidays/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
