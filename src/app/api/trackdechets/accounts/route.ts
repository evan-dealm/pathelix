import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext }         from '@/lib/data/context'
import { handleApiError }            from '@/lib/apiError'
import { createLogger }              from '@/lib/logger'
import { AccountCreateSchema }       from '@/lib/trackdechets/validators'
import { encryptToken }              from '@/lib/trackdechets/crypto'

const log     = createLogger('/api/trackdechets/accounts')
const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (USE_MOCK) {
    return NextResponse.json({ configured: true, accountId: 'mock-td-account' })
  }

  try {
    const { default: prisma } = await import('@/lib/db')
    const account = await prisma.trackdechetsAccount.findUnique({
      where:  { tenantId },
      select: { id: true },
    })
    return NextResponse.json({ configured: account !== null, accountId: account?.id ?? null })
  } catch (err) {
    return handleApiError(err, log, { tenantId })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = AccountCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 })
  }

  if (USE_MOCK) {
    return NextResponse.json({ ok: true, accountId: 'mock-td-account' })
  }

  try {
    const { encryptedToken, iv, keyVersion } = encryptToken(parsed.data.token)
    const { default: prisma } = await import('@/lib/db')
    const account = await prisma.trackdechetsAccount.upsert({
      where:  { tenantId },
      create: { tenantId, encryptedToken, iv, keyVersion },
      update: { encryptedToken, iv, keyVersion },
      select: { id: true },
    })
    log.info('TD account configured', { tenantId, accountId: account.id })
    return NextResponse.json({ ok: true, accountId: account.id })
  } catch (err) {
    return handleApiError(err, log, { tenantId })
  }
}
