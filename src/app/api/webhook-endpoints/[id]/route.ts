import { z } from 'zod'
import { apiRoute, notFound, paged, pagination } from '@/lib/api/route'
import { assertPublicUrl } from '@/lib/outboundUrl'
import { BUSINESS_EVENTS } from '@/lib/events/outbound'
import { invalidateWebhookCache } from '@/lib/webhooks/outbox'

const UpdateSchema = z.object({
  url:         z.string().url().max(500).optional(),
  description: z.string().max(200).optional(),
  events:      z.array(z.enum(BUSINESS_EVENTS)).optional(),
  active:      z.boolean().optional(),
})

/** Delivery history of a subscriber (newest first) — with the error of each failed attempt. */
export const GET = apiRoute({ name: '/api/webhook-endpoints/[id]', permission: 'manage_integrations' }, async ({ db, req, params }) => {
  const e = await db.webhookEndpoint.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!e) throw notFound('Webhook')
  const { page, limit, skip } = pagination(req)
  const status = req.nextUrl.searchParams.get('status')
  const where = { endpointId: e.id, ...(status ? { status } : {}) }
  const [rows, total] = await Promise.all([
    db.webhookDelivery.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: { id: true, eventId: true, eventType: true, status: true, attempts: true, lastStatusCode: true, lastError: true, nextAttemptAt: true, deliveredAt: true, createdAt: true } }),
    db.webhookDelivery.count({ where }),
  ])
  return paged(rows, total, page, limit)
})

export const PUT = apiRoute({ name: '/api/webhook-endpoints/[id]', permission: 'manage_integrations', schema: UpdateSchema }, async ({ db, tenantId, body, params }) => {
  const e = await db.webhookEndpoint.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!e) throw notFound('Webhook')
  const data: Record<string, unknown> = { ...body }
  if (body.url) data.url = (await assertPublicUrl(body.url)).toString()
  if (body.active === true) data.consecutiveFailures = 0
  const updated = await db.webhookEndpoint.update({ where: { id: e.id }, data, select: { id: true, url: true, events: true, active: true } })
  invalidateWebhookCache(tenantId)
  return updated
})

export const DELETE = apiRoute({ name: '/api/webhook-endpoints/[id]', permission: 'manage_integrations' }, async ({ db, tenantId, params }) => {
  const e = await db.webhookEndpoint.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!e) throw notFound('Webhook')
  await db.webhookEndpoint.delete({ where: { id: e.id } })
  invalidateWebhookCache(tenantId)
  return { ok: true }
})
