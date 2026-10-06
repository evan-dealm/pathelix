import { apiRoute, notFound } from '@/lib/api/route'
import { ContactSchema } from '@/lib/crm/schemas'

export const PUT = apiRoute({ name: '/api/client-contacts/[id]', permission: 'manage_sales', schema: ContactSchema.partial() }, async ({ db, body, params }) => {
  const c = await db.clientContact.findFirst({ where: { id: params.id }, select: { id: true, clientId: true } })
  if (!c) throw notFound('Contact')
  return db.$transaction(async tx => {
    if (body.isPrimary) await tx.clientContact.updateMany({ where: { clientId: c.clientId, id: { not: c.id } }, data: { isPrimary: false } })
    return tx.clientContact.update({ where: { id: c.id }, data: body })
  })
})

export const DELETE = apiRoute({ name: '/api/client-contacts/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const c = await db.clientContact.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!c) throw notFound('Contact')
  await db.clientContact.delete({ where: { id: c.id } })
  return { ok: true }
})
