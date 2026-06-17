import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getVrpJobStatus } from '@/lib/queue/vrpQueue'
import { getTenantId } from '@/lib/data/context'

const log = createLogger('/api/optimize/[jobId]')

type Params = { params: Promise<{ jobId: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {

  const tenantId = getTenantId(req)

  const { jobId } = await params

  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json({ error: 'jobId requis' }, { status: 400 })
  }

  if (!jobId.startsWith(tenantId)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const status = await getVrpJobStatus(jobId)

    if (status.status === 'unknown') {
      return NextResponse.json(status, { status: 404 })
    }

    const headers: HeadersInit = {}
    if (status.status === 'waiting' || status.status === 'active') {
      headers['Retry-After'] = '2'
    }

    return NextResponse.json(status, { headers })
  } catch (err) {
    log.error('GET failed', { jobId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
