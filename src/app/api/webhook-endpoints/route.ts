import { randomBytes } from 'crypto'
import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'
import { assertPublicUrl } from '@/lib/outboundUrl'
import { encryptConfig } from '@/lib/configCrypto'
import { BUSINESS_EVENTS } from '@/lib/events/outbound'
import { invalidateWebhookCache } from '@/lib/webhooks/outbox'

const EndpointSchema = z.object({
  url:         z.string().url().max(500),
  description: z.string().max(200).optional(),
  events:      z.array(z.enum(BUSINESS_EVENTS)).max(BUSINESS_EVENTS.length).optional(),
})

/** Subscribers to business events, with their delivery health (secrets never returned). */
export const GET = apiRoute({ name: '/api/webhook-endpoints', permission: 'manage_integrations' }, async ({ db }) => {
  const rows = await db.webhookEndpoint.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, url: true, description: true, events: true, active: true, lastSuccessAt: true, lastFailureAt: true, consecutiveFailures: true, createdAt: true },
  })
  return { data: rows, events: BUSINESS_EVENTS }
})

/**
 * New subscriber: the URL must be public (SSRF guard, re-checked at each delivery) and https in
 * production. The signing secret is generated here and shown once.
 */
export const POST = apiRoute({ name: '/api/webhook-endpoints', permission: 'manage_integrations', schema: EndpointSchema }, async ({ db, tenantId, body }) => {
  const url = await assertPublicUrl(body.url)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    return Response.json({ error: 'URL https requise', code: 'HTTPS_REQUIRED' }, { status: 422 })
  }
  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  const created = await db.webhookEndpoint.create({
    data: { url: url.toString(), description: body.description ?? '', events: body.events ?? [], secret: encryptConfig({ secret }) as never } as Parameters<typeof db.webhookEndpoint.create>[0]['data'],
    select: { id: true, url: true, events: true, active: true },
  })
  invalidateWebhookCache(tenantId)
  return { ...created, secret }
})
