import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/superadmin/audit-logs')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const tenantId   = searchParams.get('tenantId')
  const action     = searchParams.get('action')
  const userId     = searchParams.get('userId')
  const dateFrom   = searchParams.get('from')
  const dateTo     = searchParams.get('to')
  const limit      = Math.min(100, parseInt(searchParams.get('limit') ?? '50', 10) || 50)
  const offset     = parseInt(searchParams.get('offset') ?? '0', 10) || 0

  try {
    const where: Record<string, unknown> = {}
    if (tenantId)  where.tenantId = tenantId
    if (action)    where.action = { contains: action }
    if (userId)    where.userId = { contains: userId }
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo   ? { lte: new Date(dateTo + 'T23:59:59Z') } : {}),
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          tenant: { select: { name: true, slug: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ])

    return NextResponse.json({ logs, total, limit, offset })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
