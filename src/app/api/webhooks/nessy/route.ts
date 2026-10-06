import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getTenantDb } from '@/lib/tenantDb'
import { createMission } from '@/lib/data/missions'

import { verifyNessySignature, nessyPayloadToMission } from '@/services/nessy'
import type { NessyWebhookBody } from '@/services/nessy'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { decryptConfig } from '@/lib/configCrypto'
import prisma from '@/lib/db'

const DEDUP_TTL_MS = 10 * 60 * 1000

const log = createLogger('/api/webhooks/nessy')
const _nessyRl = createRateLimiter(200, 60_000, { redis: true, prefix: 'rl:nessy' })

export async function POST(req: NextRequest): Promise<NextResponse> {

  const ip = getClientIp(req.headers)
  if (!(await _nessyRl.check(`nessy:${ip}`))) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Impossible de lire le corps' }, { status: 400 })
  }

  const signature = req.headers.get('x-nessy-signature') ?? ''

  // The tenant is resolved by finding which tenant's own secret
  // verifies this signature — never trusted from a client-supplied x-tenant-id header anymore.
  // Mirrors the Geotab/Samsara per-tenant integration secret pattern (see N15 fix). Each
  // candidate is checked sequentially (verifyNessySignature is async, unlike Geotab's
  // synchronous apiKeyMatches, so this can't be a plain Array.find()).
  const integrations = await prisma.integration.findMany({
    where: { type: 'nessy', enabled: true },
    select: { tenantId: true, config: true },
  })

  let tenantId: string | null = null
  for (const integration of integrations) {
    try {
      const cfg = decryptConfig(integration.config)
      const secret = String(cfg.webhookSecret ?? cfg.secret ?? '')
      if (!secret) continue
      if (await verifyNessySignature(rawBody, signature, secret)) {
        tenantId = integration.tenantId
        break
      }
    } catch (err) {
      // A single tenant's corrupted/undecryptable config must not crash auth for every other
      // tenant's valid Nessy integration — skip it and keep looking.
      log.warn('Failed to decrypt integration config — skipping', {
        tenantId: integration.tenantId, err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (!tenantId) {
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

  const payloadHash = createHash('sha256').update(rawBody).digest('hex')
  const alreadySeen = await redisCache.get('nessy:dedup', tenantId, payloadHash)
  if (alreadySeen) {
    return NextResponse.json({ received: 0, deduplicated: true })
  }

  // Missions are recorded at once (they used to wait in a per-process memory queue: lost on
  // restart, invisible to another instance, and planned under ids that never reached the
  // database). A re-sent mission is recognised by its Nessy id, else by day + address + client.
  const db = getTenantDb(tenantId)
  let received = 0
  let duplicates = 0
  for (const payload of body.missions) {
    try {
      const mission = nessyPayloadToMission(payload)
      const externalRef = payload.id ? `nessy:${String(payload.id).slice(0, 120)}` : undefined
      const existing = await db.mission.findFirst({
        where: externalRef
          ? { externalRef }
          : { date: mission.date, address: mission.address, clientName: mission.clientName ?? null, archived: false },
        select: { id: true },
      })
      if (existing) { duplicates++; continue }
      await createMission(tenantId, { ...mission, ...(externalRef ? { externalRef } : {}) } as Parameters<typeof createMission>[1])
      received++
    } catch (err) {
      log.error('Mission invalide', { payload, err: err instanceof Error ? err.message : String(err) })
    }
  }
  if (received > 0) void redisCache.invalidateAll('missions', tenantId)

  await redisCache.set('nessy:dedup', tenantId, '1', DEDUP_TTL_MS, payloadHash)

  return NextResponse.json({ received, duplicates })
}
