import { apiRoute, notFound } from '@/lib/api/route'
import { PlanUpdateSchema } from '@/lib/fleet/schemas'

export const PUT = apiRoute({ name: '/api/maintenance-plans/[id]', permission: 'manage_vehicles', schema: PlanUpdateSchema }, async ({ db, body, params }) => {
  const plan = await db.maintenancePlan.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!plan) throw notFound('Suivi')
  return db.maintenancePlan.update({ where: { id: plan.id }, data: body })
})

export const DELETE = apiRoute({ name: '/api/maintenance-plans/[id]', permission: 'manage_vehicles' }, async ({ db, params }) => {
  const r = await db.maintenancePlan.deleteMany({ where: { id: params.id } })
  if (r.count === 0) throw notFound('Suivi')
  return { ok: true }
})
