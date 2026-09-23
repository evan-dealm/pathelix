import { NextRequest, NextResponse } from 'next/server'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }          from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { getTenantDb }               from '@/lib/tenantDb'

const log = createLogger('/api/driver-unavailability/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role, tenantId } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  const { id } = await params

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.driverUnavailability.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Indisponibilité introuvable' }, { status: 404 })

    await db.driverUnavailability.delete({ where: { id } })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/driver-unavailability/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/driver-unavailability/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
