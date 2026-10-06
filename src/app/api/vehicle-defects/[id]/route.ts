import { apiRoute, notFound } from '@/lib/api/route'
import { DefectUpdateSchema } from '@/lib/fleet/schemas'

/** Office follow-up of a defect: in repair, fixed, dismissed (a fixed CRITICAL frees the truck). */
export const PUT = apiRoute({ name: '/api/vehicle-defects/[id]', permission: 'manage_vehicles', schema: DefectUpdateSchema }, async ({ db, userId, body, params }) => {
  const d = await db.vehicleDefect.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!d) throw notFound('Défaut')
  const closing = body.status === 'FIXED' || body.status === 'DISMISSED'
  return db.vehicleDefect.update({
    where: { id: d.id },
    data: { ...body, ...(closing ? { resolvedAt: new Date(), resolvedBy: userId } : body.status ? { resolvedAt: null, resolvedBy: null } : {}) },
  })
})
