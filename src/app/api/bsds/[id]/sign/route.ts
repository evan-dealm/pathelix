import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext }         from '@/lib/data/context'
import { handleApiError }            from '@/lib/apiError'
import { createLogger }              from '@/lib/logger'
import { BsddSignSchema }            from '@/lib/trackdechets/validators'
import { signBsddInTd, getTokenFromAccount, mapTdStatus, validatePayloadForProducerSign, validatePayloadForTransporterSign } from '@/lib/trackdechets/bsdService'
import { TdApiError }                from '@/lib/trackdechets/client'

const log     = createLogger('/api/bsds/[id]/sign')
const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role === 'driver') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = BsddSignSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 })
  }

  if (USE_MOCK) {
    return NextResponse.json({ ok: true, status: 'SIGNED_BY_PRODUCER' })
  }

  try {
    const { default: prisma } = await import('@/lib/db')

    const bsd = await prisma.bsd.findFirst({ where: { id, tenantId } })
    if (!bsd) {
      return NextResponse.json({ error: 'BSD introuvable' }, { status: 404 })
    }

    const account = await prisma.trackdechetsAccount.findUnique({ where: { tenantId } })
    if (!account) {
      return NextResponse.json(
        { error: 'Compte Trackdéchets non configuré' },
        { status: 409 },
      )
    }

    const validationErrors = parsed.data.signatureType === 'PRODUCER'
      ? validatePayloadForProducerSign(bsd.payload)
      : validatePayloadForTransporterSign(bsd.payload)

    if (validationErrors.length > 0) {
      log.warn('BSD sign rejected — missing required fields', { bsdId: id, fields: validationErrors })
      return NextResponse.json(
        { error: 'Données manquantes pour la signature', fields: validationErrors },
        { status: 422 },
      )
    }

    const token  = getTokenFromAccount(account)
    const result = await signBsddInTd(token, bsd.tdId, parsed.data)
    const status = mapTdStatus(result.status)

    await prisma.bsd.update({ where: { id }, data: { status } })

    log.info('BSD signed', { tenantId, bsdId: id, signatureType: parsed.data.signatureType, status })
    return NextResponse.json({ ok: true, status })
  } catch (err) {
    if (err instanceof TdApiError) {
      log.error('TD API error signing BSD', { tenantId, bsdId: id, errors: err.errors })
      return NextResponse.json({ error: `Erreur Trackdéchets: ${err.message}` }, { status: 502 })
    }
    return handleApiError(err, log, { tenantId, bsdId: id })
  }
}
