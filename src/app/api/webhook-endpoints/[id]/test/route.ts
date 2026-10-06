import { randomUUID } from 'crypto'
import { apiRoute, notFound } from '@/lib/api/route'
import { attemptDelivery } from '@/lib/webhooks/outbox'

/** Sends a signed `ping` event to this subscriber now and returns the outcome. */
export const POST = apiRoute({ name: '/api/webhook-endpoints/[id]/test', permission: 'manage_integrations' }, async ({ db, params }) => {
  const e = await db.webhookEndpoint.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!e) throw notFound('Webhook')
  const eventId = `evt_${randomUUID()}`
  const d = await db.webhookDelivery.create({
    data: { endpointId: e.id, eventId, eventType: 'ping', payload: { id: eventId, type: 'ping', createdAt: new Date().toISOString(), data: {} } } as Parameters<typeof db.webhookDelivery.create>[0]['data'],
    select: { id: true },
  })
  const result = await attemptDelivery(d.id)
  const after = await db.webhookDelivery.findFirst({ where: { id: d.id }, select: { status: true, lastStatusCode: true, lastError: true } })
  return { result, ...after }
})
