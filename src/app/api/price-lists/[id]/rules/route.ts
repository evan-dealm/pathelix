import { apiRoute, notFound } from '@/lib/api/route'
import { PriceRuleSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'

export const POST = apiRoute({ name: '/api/price-lists/[id]/rules', permission: 'manage_sales', schema: PriceRuleSchema }, async ({ db, body, params }) => {
  const l = await db.priceList.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!l) throw notFound('Grille tarifaire')
  await assertTenantRefs(db, { containerTypeId: body.conditions?.containerTypeId, materialId: body.conditions?.materialId })
  const unit = body.unit ?? (body.code.endsWith('_PCT') ? 'PCT' : body.code === 'RENTAL_DAY' ? 'DAY' : body.code === 'TREATMENT_TON' ? 'TON' : body.code === 'KM' ? 'KM' : 'UNIT')
  return db.priceRule.create({ data: { ...body, unit, conditions: body.conditions ?? {}, priceListId: l.id } as Parameters<typeof db.priceRule.create>[0]['data'] })
})
