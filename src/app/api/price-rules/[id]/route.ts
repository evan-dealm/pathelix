import { apiRoute, notFound } from '@/lib/api/route'
import { PriceRuleSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'

export const PUT = apiRoute({ name: '/api/price-rules/[id]', permission: 'manage_sales', schema: PriceRuleSchema.partial() }, async ({ db, body, params }) => {
  const r = await db.priceRule.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!r) throw notFound('Tarif')
  await assertTenantRefs(db, { containerTypeId: body.conditions?.containerTypeId, materialId: body.conditions?.materialId })
  return db.priceRule.update({ where: { id: r.id }, data: body })
})

export const DELETE = apiRoute({ name: '/api/price-rules/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const r = await db.priceRule.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!r) throw notFound('Tarif')
  await db.priceRule.delete({ where: { id: r.id } })
  return { ok: true }
})
