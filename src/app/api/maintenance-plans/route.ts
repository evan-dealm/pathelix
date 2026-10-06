import { apiRoute, notFound } from '@/lib/api/route'
import { PlanSchema } from '@/lib/fleet/schemas'

/** A preventive or regulatory follow-up on a truck (CT, tachograph, insurance, service…). */
export const POST = apiRoute({ name: '/api/maintenance-plans', permission: 'manage_vehicles', schema: PlanSchema }, async ({ db, body }) => {
  const vehicle = await db.vehicle.findFirst({ where: { id: body.vehicleId }, select: { id: true } })
  if (!vehicle) throw notFound('Véhicule')
  return db.maintenancePlan.create({ data: body as Parameters<typeof db.maintenancePlan.create>[0]['data'] })
})
