import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext }         from '@/lib/data/context'
import { handleApiError }            from '@/lib/apiError'
import { createLogger }              from '@/lib/logger'

const log     = createLogger('/api/trackdechets/accounts/[id]')
const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  if (USE_MOCK) {
    return NextResponse.json({ ok: true })
  }

  try {
    const { default: prisma } = await import('@/lib/db')
    const account = await prisma.trackdechetsAccount.findUnique({
      where:  { id },
      select: { tenantId: true },
    })
    if (!account) {
      return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 })
    }
    if (account.tenantId !== tenantId && role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await prisma.trackdechetsAccount.delete({ where: { id } })
    log.info('TD account deleted', { tenantId, accountId: id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, log, { tenantId, accountId: id })
  }
}
