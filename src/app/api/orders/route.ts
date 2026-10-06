import { apiRoute, paged, pagination } from '@/lib/api/route'
import { OrderSchema } from '@/lib/sales/schemas'
import { createOrderFromLines, orderProgress } from '@/lib/sales/orders'
import { emitBusinessEvent } from '@/lib/events/outbound'

export const GET = apiRoute({ name: '/api/orders', permission: 'manage_sales' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  if (sp.get('status')) where.status = sp.get('status')
  if (sp.get('clientId')) where.clientId = sp.get('clientId')
  const q = sp.get('q')?.trim()
  if (q) where.OR = [{ number: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }]
  const [rows, total] = await Promise.all([
    db.order.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { client: { select: { id: true, name: true } }, missions: { select: { completedAt: true, archived: true } } } }),
    db.order.count({ where }),
  ])
  return paged(rows.map(({ missions, ...o }) => ({ ...o, progress: orderProgress(missions) })), total, page, limit)
})

export const POST = apiRoute({ name: '/api/orders', permission: 'manage_sales', schema: OrderSchema }, async ({ db, tenantId, userId, body }) => {
  const order = await createOrderFromLines(db, tenantId, userId, { ...body, kind: body.kind ?? 'ONE_OFF' })
  void emitBusinessEvent(tenantId, 'order.created', { orderId: order.id, number: order.number, clientId: order.clientId, missions: order.missions.length })
  return order
})
