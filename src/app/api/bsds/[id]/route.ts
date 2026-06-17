import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext }         from '@/lib/data/context'
import { handleApiError }            from '@/lib/apiError'
import { createLogger }              from '@/lib/logger'
import { fetchBsddStatusFromTd, getTokenFromAccount, mapTdStatus } from '@/lib/trackdechets/bsdService'

const log     = createLogger('/api/bsds/[id]')
const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role === 'driver') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  if (USE_MOCK) {
    return NextResponse.json({
      bsd: {
        id, tdId: 'TD-26-AAA-00001', type: 'BSDD', status: 'DRAFT',
        missionId: null, readableId: 'TD-26-AAA-00001',
        payload: {}, createdAt: new Date().toISOString(),
      },
    })
  }

  try {
    const { default: prisma } = await import('@/lib/db')
    const bsd = await prisma.bsd.findFirst({
      where: { id, tenantId },
    })
    if (!bsd) {
      return NextResponse.json({ error: 'BSD introuvable' }, { status: 404 })
    }

    const syncStatus = req.nextUrl?.searchParams.get('sync') === 'true'
    if (syncStatus) {
      const account = await prisma.trackdechetsAccount.findUnique({ where: { tenantId } })
      if (account) {
        try {
          const token  = getTokenFromAccount(account)
          const remote = await fetchBsddStatusFromTd(token, bsd.tdId)
          const status = mapTdStatus(remote.status)
          if (status !== bsd.status) {
            await prisma.bsd.update({ where: { id }, data: { status } })
            bsd.status = status
          }
        } catch (syncErr) {
          log.error('TD status sync failed', { bsdId: id, err: syncErr instanceof Error ? syncErr.message : String(syncErr) })
        }
      }
    }

    return NextResponse.json({ bsd })
  } catch (err) {
    return handleApiError(err, log, { tenantId, bsdId: id })
  }
}
