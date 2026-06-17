import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { createLogger }              from '@/lib/logger'
import { handleApiError }            from '@/lib/apiError'
import { verifyHmacSignature }       from '@/lib/trackdechets/crypto'
import { mapTdStatus }               from '@/lib/trackdechets/bsdService'

const log = createLogger('/api/webhooks/trackdechets')

const WebhookPayloadSchema = z.object({
  type: z.string(),
  payload: z.object({
    id:          z.string(),
    status:      z.string(),
    readableId:  z.string().optional(),
  }),
})

const WEBHOOK_SECRET = process.env.TRACKDECHETS_WEBHOOK_SECRET ?? ''

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!WEBHOOK_SECRET) {
    log.error('TRACKDECHETS_WEBHOOK_SECRET not configured')
    return NextResponse.json(
      { error: 'Webhook non configuré — secret manquant' },
      { status: 503 },
    )
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Impossible de lire le corps' }, { status: 400 })
  }

  const signature = req.headers.get('x-hub-signature-256') ?? ''
  if (!verifyHmacSignature(rawBody, signature, WEBHOOK_SECRET)) {
    log.error('Trackdéchets webhook signature invalide')
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })
  }

  let parsed: z.infer<typeof WebhookPayloadSchema>
  try {
    parsed = WebhookPayloadSchema.parse(JSON.parse(rawBody))
  } catch {
    return NextResponse.json({ error: 'Payload invalide' }, { status: 400 })
  }

  if (parsed.type !== 'BSD_STATUS_UPDATED') {
    return NextResponse.json({ ignored: true, type: parsed.type })
  }

  const { id: tdId, status: tdStatus, readableId } = parsed.payload
  const status = mapTdStatus(tdStatus)

  try {
    const { default: prisma } = await import('@/lib/db')
    const bsd = await prisma.bsd.findUnique({ where: { tdId } })
    if (!bsd) {
      log.info('Webhook BSD not found locally, ignoring', { tdId })
      return NextResponse.json({ ok: true, ignored: true })
    }

    await prisma.bsd.update({
      where: { tdId },
      data:  {
        status,
        ...(readableId ? { readableId } : {}),
      },
    })

    log.info('BSD status updated via webhook', { tdId, bsdId: bsd.id, status })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, log, { tdId })
  }
}
