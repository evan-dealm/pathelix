import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import prisma from '@/lib/db'

const log = createLogger('/api/ai/jobs')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  const VALID_STATUSES = ['pending', 'done', 'failed'] as const
  const rawStatus = req.nextUrl.searchParams.get('status')
  const statusFilter = rawStatus && (VALID_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : undefined
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 100)

  try {
    const jobs = await prisma.aiJob.findMany({
      where: {
        tenantId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        missionId: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
        errorMsg: true,
        outputData: true,
      },
    })
    return NextResponse.json(jobs)
  } catch (err) {
    log.error('Failed to list AI jobs', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
