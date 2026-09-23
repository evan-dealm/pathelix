import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { unscopedPrisma } from '@/lib/tenantDb'

const log = createLogger('/api/admin/geocoding-audit')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)

  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès réservé aux superadmins' }, { status: 403 })
  }

  try {
    // Superadmin cross-tenant aggregate by design — one row per tenant, not a leak.
    const rows = await unscopedPrisma.mission.groupBy({
      by: ['tenantId'],
      where: { needsGeocode: true },
      _count: { id: true },
    })

    const total = rows.reduce((sum, r) => sum + r._count.id, 0)

    log.info('Geocoding audit', { tenantCount: rows.length, total })

    return NextResponse.json({
      total,
      byTenant: rows.map(r => ({
        tenantId: r.tenantId,
        count: r._count.id,
      })),
    })
  } catch (err) {
    log.error('Geocoding audit failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
