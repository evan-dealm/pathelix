import { NextRequest, NextResponse } from 'next/server'
import { getTenantDb } from '@/lib/tenantDb'
import { hasPermission } from '@/lib/permissions'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'

const log = createLogger('/api/fuel-records/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { tenantId, role, userId } = getRequestContext(req)
  // Same permission as managing the vehicle itself (dispatchers hold it by default).
  if (!(await hasPermission(userId, role, 'manage_vehicles'))) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

  try {
    const result = await getTenantDb(tenantId).fuelRecord.deleteMany({ where: { id } })
    if (result.count === 0) return NextResponse.json({ error: 'Enregistrement introuvable' }, { status: 404 })
    void redisCache.invalidateAll('fuel-records', tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
