import { apiRoute, notFound } from '@/lib/api/route'
import { ContactSchema } from '@/lib/crm/schemas'

export const GET = apiRoute({ name: '/api/clients/[id]/contacts' }, async ({ db, params }) => {
  return { data: await db.clientContact.findMany({ where: { clientId: params.id }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] }) }
})

export const POST = apiRoute({ name: '/api/clients/[id]/contacts', permission: 'manage_sales', schema: ContactSchema }, async ({ db, body, params }) => {
  const c = await db.client.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!c) throw notFound('Client')
  return db.$transaction(async tx => {
    if (body.isPrimary) await tx.clientContact.updateMany({ where: { clientId: c.id }, data: { isPrimary: false } })
    return tx.clientContact.create({ data: { ...body, role: body.role ?? '', email: body.email ?? '', phone: body.phone ?? '', clientId: c.id } as Parameters<typeof tx.clientContact.create>[0]['data'] })
  })
})
