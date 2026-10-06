import { apiRoute, notFound } from '@/lib/api/route'
import { PriceListSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'

export const PUT = apiRoute({ name: '/api/price-lists/[id]', permission: 'manage_sales', schema: PriceListSchema.partial() }, async ({ db, body, params }) => {
  const l = await db.priceList.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!l) throw notFound('Grille tarifaire')
  await assertTenantRefs(db, { clientId: body.clientId ?? undefined })
  return db.$transaction(async tx => {
    if (body.isDefault) await tx.priceList.updateMany({ where: { isDefault: true, id: { not: l.id } }, data: { isDefault: false } })
    return tx.priceList.update({ where: { id: l.id }, data: body })
  })
})

/** Archived (contracts and history keep pointing to it). */
export const DELETE = apiRoute({ name: '/api/price-lists/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const l = await db.priceList.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!l) throw notFound('Grille tarifaire')
  await db.priceList.update({ where: { id: l.id }, data: { archived: true, isDefault: false } })
  return { ok: true }
})
