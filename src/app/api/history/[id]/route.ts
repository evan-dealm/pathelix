import { NextRequest, NextResponse } from 'next/server'
import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { getTenantId } from '@/lib/data/context'

const log = createLogger('/api/history/[id]')
const useMock = process.env.USE_MOCK_DATA !== 'false'

interface HistoryRecord { id: string; tenantId: string; date: string; label: string; snapshot: string; createdAt: string }
// eslint-disable-next-line no-var
declare global { var __historyMock: HistoryRecord[] | undefined }

function getMockHistory(): HistoryRecord[] {
  if (!globalThis.__historyMock) globalThis.__historyMock = []
  return globalThis.__historyMock
}

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const tenantId = getTenantId(req)
  try {
    if (useMock) {
      const history = getMockHistory()

      const idx = history.findIndex(h => h.id === id && h.tenantId === tenantId)
      if (idx === -1) {
        return NextResponse.json({ error: 'Historique introuvable' }, { status: 404 })
      }
      history.splice(idx, 1)
      return NextResponse.json({ ok: true })
    }

    const db = getTenantDb(tenantId)
    const existing = await db.tourHistory.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Historique introuvable' }, { status: 404 })
    await db.tourHistory.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
