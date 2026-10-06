import { apiRoute } from '@/lib/api/route'
import { PriceListSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'

/** Price grids (default grid and customer grids) with their rules. */
export const GET = apiRoute({ name: '/api/price-lists', permission: 'manage_sales' }, async ({ db, req }) => {
  const clientId = req.nextUrl.searchParams.get('clientId')
  const data = await db.priceList.findMany({
    where: { archived: false, ...(clientId ? { OR: [{ clientId }, { isDefault: true }] } : {}) },
    include: { rules: { orderBy: [{ code: 'asc' }, { priority: 'desc' }] }, client: { select: { id: true, name: true } } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
  return { data }
})

export const POST = apiRoute({ name: '/api/price-lists', permission: 'manage_sales', schema: PriceListSchema }, async ({ db, body }) => {
  await assertTenantRefs(db, { clientId: body.clientId ?? undefined })
  return db.$transaction(async tx => {
    // One default grid per tenant.
    if (body.isDefault) await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    return tx.priceList.create({ data: { ...body, clientId: body.clientId ?? null } as Parameters<typeof tx.priceList.create>[0]['data'] })
  })
})
