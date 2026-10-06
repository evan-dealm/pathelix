import { apiRoute, notFound } from '@/lib/api/route'
import { OrderUpdateSchema } from '@/lib/sales/schemas'
import { orderProgress } from '@/lib/sales/orders'
import { releaseMissionReservation } from '@/lib/containers/service'

export const GET = apiRoute({ name: '/api/orders/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const o = await db.order.findFirst({
    where: { id: params.id },
    include: {
      lines: { orderBy: { position: 'asc' } }, client: { select: { id: true, name: true } }, site: { select: { id: true, name: true, address: true } },
      quote: { select: { id: true, number: true } }, contract: { select: { id: true, number: true } },
      missions: { select: { id: true, type: true, date: true, completedAt: true, archived: true, cancelledAt: true }, orderBy: { date: 'asc' } },
      invoices: { select: { id: true, number: true, status: true, totalTTC: true } },
    },
  })
  if (!o) throw notFound('Commande')
  return { ...o, progress: orderProgress(o.missions) }
})

/** Status/notes; cancelling archives the missions not yet done and frees their reserved bins. */
export const PUT = apiRoute({ name: '/api/orders/[id]', permission: 'manage_sales', schema: OrderUpdateSchema }, async ({ db, body, params }) => {
  const o = await db.order.findFirst({ where: { id: params.id }, select: { id: true, status: true } })
  if (!o) throw notFound('Commande')
  if (body.status === 'CANCELLED' && o.status !== 'CANCELLED') {
    const open = await db.mission.findMany({ where: { orderId: o.id, completedAt: null, archived: false }, select: { id: true } })
    for (const m of open) {
      await db.mission.update({ where: { id: m.id }, data: { archived: true, cancelledAt: new Date(), cancelReason: 'Commande annulée' } })
      await releaseMissionReservation(db, m.id)
    }
  }
  return db.order.update({ where: { id: o.id }, data: body })
})
