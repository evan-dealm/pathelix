import { NextRequest, NextResponse } from 'next/server'
import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/mission-comments/[id]')
type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { tenantId, userId, role } = getRequestContext(req)

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.missionComment.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Commentaire introuvable' }, { status: 404 })

    if (existing.userId !== userId && role !== 'admin') {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const whereClause = role !== 'admin'
      ? { id, userId }
      : { id }

    const result = await db.missionComment.deleteMany({ where: whereClause })
    if (result.count === 0) return NextResponse.json({ error: 'Commentaire introuvable' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
