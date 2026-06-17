import { NextRequest, NextResponse } from 'next/server'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }          from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import prisma                        from '@/lib/db'

const log = createLogger('/api/driver-unavailability/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role, tenantId } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  const { id } = await params

  try {
    const existing = await prisma.driverUnavailability.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Indisponibilité introuvable' }, { status: 404 })

    await prisma.driverUnavailability.delete({ where: { id, tenantId } })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/driver-unavailability/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/driver-unavailability/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
