import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import prisma from '@/lib/db'

const log = createLogger('/api/admin/geocoding-audit')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)

  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès réservé aux superadmins' }, { status: 403 })
  }

  try {
    const rows = await prisma.mission.groupBy({
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
