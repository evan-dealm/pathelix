import { apiRoute } from '@/lib/api/route'
import { createMissionsForOrder } from '@/lib/sales/orders'

/** Creates the missions of the order's operational lines that do not exist yet. */
export const POST = apiRoute({ name: '/api/orders/[id]/missions', permission: 'manage_missions' }, async ({ db, params }) => {
  return { created: await createMissionsForOrder(db, params.id) }
})
