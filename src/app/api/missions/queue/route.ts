import { NextRequest, NextResponse } from 'next/server'
import { peekQueue } from '@/lib/missionQueue'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/missions/queue')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  try {
    const queued = peekQueue(tenantId)
    return NextResponse.json(queued)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
