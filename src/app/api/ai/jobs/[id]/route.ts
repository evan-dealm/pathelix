import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/ai/jobs/[id]')

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id requis' }, { status: 400 })
  }

  try {
    const job = await getTenantDb(tenantId).aiJob.findFirst({
      where: { id },
    })
    if (!job) {
      return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
    }
    return NextResponse.json(job)
  } catch (err) {
    log.error('Failed to get AI job', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
