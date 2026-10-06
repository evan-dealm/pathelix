import { apiRoute, notFound } from '@/lib/api/route'

export const DELETE = apiRoute({ name: '/api/vehicle-unavailability/[id]', permission: 'manage_vehicles' }, async ({ db, params }) => {
  const existing = await db.vehicleUnavailability.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!existing) throw notFound('Immobilisation')
  await db.vehicleUnavailability.delete({ where: { id: params.id } })
  return { ok: true }
})
