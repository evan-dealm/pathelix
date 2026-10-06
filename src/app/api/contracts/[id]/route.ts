import { apiRoute, notFound } from '@/lib/api/route'
import { ContractSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'

export const GET = apiRoute({ name: '/api/contracts/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const c = await db.contract.findFirst({
    where: { id: params.id },
    include: {
      client: { select: { id: true, name: true } }, priceList: { include: { rules: true } },
      orders: { select: { id: true, number: true, status: true } }, invoices: { select: { id: true, number: true, status: true, totalTTC: true } },
    },
  })
  if (!c) throw notFound('Contrat')
  return c
})

export const PUT = apiRoute({ name: '/api/contracts/[id]', permission: 'manage_sales', schema: ContractSchema.omit({ clientId: true }).partial() }, async ({ db, body, params }) => {
  const c = await db.contract.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!c) throw notFound('Contrat')
  await assertTenantRefs(db, { siteId: body.siteId ?? undefined, priceListId: body.priceListId ?? undefined })
  return db.contract.update({ where: { id: c.id }, data: body })
})
