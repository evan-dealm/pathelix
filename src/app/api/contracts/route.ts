import { apiRoute, paged, pagination } from '@/lib/api/route'
import { ContractSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { nextNumber } from '@/lib/sales/numbering'

export const GET = apiRoute({ name: '/api/contracts', permission: 'manage_sales' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  if (sp.get('status')) where.status = sp.get('status')
  if (sp.get('clientId')) where.clientId = sp.get('clientId')
  const [rows, total] = await Promise.all([
    db.contract.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { client: { select: { id: true, name: true } }, priceList: { select: { id: true, name: true } } } }),
    db.contract.count({ where }),
  ])
  return paged(rows, total, page, limit)
})

export const POST = apiRoute({ name: '/api/contracts', permission: 'manage_sales', schema: ContractSchema }, async ({ db, tenantId, userId, body }) => {
  await assertTenantRefs(db, { clientId: body.clientId, siteId: body.siteId ?? undefined, priceListId: body.priceListId ?? undefined })
  return db.$transaction(async tx => {
    const number = await nextNumber(tx, tenantId, 'CONTRACT', 'CTR')
    return tx.contract.create({
      data: { ...body, number, siteId: body.siteId ?? null, priceListId: body.priceListId ?? null, endDate: body.endDate ?? null, createdBy: userId } as Parameters<typeof tx.contract.create>[0]['data'],
    })
  })
})
