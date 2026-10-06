import { apiRoute, notFound } from '@/lib/api/route'
import { attemptDelivery } from '@/lib/webhooks/outbox'

/** Replays a delivery (failed or dead) now — same event id, so the consumer can deduplicate. */
export const POST = apiRoute({ name: '/api/webhook-deliveries/[id]/replay', permission: 'manage_integrations' }, async ({ db, params }) => {
  const d = await db.webhookDelivery.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!d) throw notFound('Envoi')
  await db.webhookDelivery.update({ where: { id: d.id }, data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: 0 } })
  const result = await attemptDelivery(d.id)
  return { result }
})
