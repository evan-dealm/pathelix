import { apiRoute, notFound } from '@/lib/api/route'
import { CustomerNoteSchema } from '@/lib/crm/schemas'

/** Adds a call / e-mail / meeting / note to the customer timeline. */
export const POST = apiRoute({ name: '/api/clients/[id]/notes', permission: 'manage_missions', schema: CustomerNoteSchema }, async ({ db, userId, body, params }) => {
  const c = await db.client.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!c) throw notFound('Client')
  return db.customerNote.create({
    data: { clientId: c.id, kind: body.kind ?? 'NOTE', content: body.content, createdBy: userId, at: body.at ? new Date(body.at) : new Date() } as Parameters<typeof db.customerNote.create>[0]['data'],
  })
})
