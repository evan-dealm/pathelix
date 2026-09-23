import { NextRequest, NextResponse } from 'next/server'
import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'

const log = createLogger('/api/maintenance/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })

  try {
    const result = await getTenantDb(tenantId).maintenanceRecord.deleteMany({ where: { id } })
    if (result.count === 0) return NextResponse.json({ error: 'Enregistrement introuvable' }, { status: 404 })
    void redisCache.invalidateAll('maintenance', tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
