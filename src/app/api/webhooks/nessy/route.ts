import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { enqueueMission } from '@/lib/missionQueue'
import {
  verifyNessySignature,
  nessyPayloadToMission,
  NESSY_WEBHOOK_SECRET,
  IS_DEV_SECRET,
} from '@/services/nessy'
import type { NessyWebhookBody } from '@/services/nessy'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'

const DEDUP_TTL_MS = 10 * 60 * 1000

const log = createLogger('/api/webhooks/nessy')

export async function POST(req: NextRequest): Promise<NextResponse> {

  if (process.env.NODE_ENV === 'production' && IS_DEV_SECRET) {
    return NextResponse.json(
      { error: 'Webhook non configuré — secret par défaut détecté en production' },
      { status: 503 },
    )
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Impossible de lire le corps' }, { status: 400 })
  }

  const signature = req.headers.get('x-nessy-signature') ?? ''
  const valid = await verifyNessySignature(rawBody, signature, NESSY_WEBHOOK_SECRET)
  if (!valid) {
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })
  }

  let body: NessyWebhookBody
  try {
    body = JSON.parse(rawBody) as NessyWebhookBody
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  if (!Array.isArray(body.missions)) {
    return NextResponse.json({ error: 'Champ missions[] requis' }, { status: 400 })
  }

  if (body.sentAt) {
    const sentMs = new Date(body.sentAt).getTime()
    if (isNaN(sentMs) || Date.now() - sentMs > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Payload expiré ou timestamp invalide' }, { status: 400 })
    }
  }

  const MAX_WEBHOOK_BATCH = 500
  if (body.missions.length > MAX_WEBHOOK_BATCH) {
    return NextResponse.json(
      { error: `Trop de missions (max ${MAX_WEBHOOK_BATCH} par requête)` },
      { status: 400 },
    )
  }

  const tenantId = req.headers.get('x-tenant-id')
  if (!tenantId) {
    return NextResponse.json(
      { error: 'En-tête X-Tenant-Id requis pour identifier le tenant' },
      { status: 400 },
    )
  }

  try {
    const { default: prisma } = await import('@/lib/db')
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant inconnu' }, { status: 403 })
    }
  } catch (err) {
    log.error('Tenant validation failed', { tenantId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }

  const payloadHash = createHash('sha256').update(rawBody).digest('hex')
  const alreadySeen = await redisCache.get('nessy:dedup', tenantId, payloadHash)
  if (alreadySeen) {
    return NextResponse.json({ received: 0, deduplicated: true })
  }

  let received = 0
  for (const payload of body.missions) {
    try {
      const mission = nessyPayloadToMission(payload)
      enqueueMission(mission, tenantId)
      received++
    } catch (err) {
      log.error('Mission invalide', { payload, err: err instanceof Error ? err.message : String(err) })
    }
  }

  await redisCache.set('nessy:dedup', tenantId, '1', DEDUP_TTL_MS, payloadHash)

  return NextResponse.json({ received })
}
