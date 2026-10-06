import { z } from 'zod'
import { apiRoute, paged, pagination, unprocessable } from '@/lib/api/route'
import { assertTenantRefs } from '@/lib/tenantRefs'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const VehicleUnavailabilitySchema = z.object({
  vehicleId: z.string().min(1),
  startDate: day,
  endDate:   day,
  reason:    z.enum(['maintenance', 'inspection', 'breakdown', 'other']),
  notes:     z.string().max(1000).optional(),
}).refine(v => v.endDate >= v.startDate, { message: 'La fin doit être après le début', path: ['endDate'] })

/** Planned immobilisations of trucks: the optimiser never plans a driver whose trucks are all down. */
export const GET = apiRoute({ name: '/api/vehicle-unavailability' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  if (sp.get('vehicleId')) where.vehicleId = sp.get('vehicleId')
  if (sp.get('from')) where.endDate = { gte: sp.get('from') }
  const [data, total] = await Promise.all([
    db.vehicleUnavailability.findMany({ where, skip, take: limit, orderBy: { startDate: 'asc' } }),
    db.vehicleUnavailability.count({ where }),
  ])
  return paged(data, total, page, limit)
})

export const POST = apiRoute({ name: '/api/vehicle-unavailability', permission: 'manage_vehicles', schema: VehicleUnavailabilitySchema }, async ({ db, body }) => {
  await assertTenantRefs(db, { vehicleId: body.vehicleId })
  const overlap = await db.vehicleUnavailability.findFirst({
    where: { vehicleId: body.vehicleId, startDate: { lte: body.endDate }, endDate: { gte: body.startDate } },
    select: { id: true },
  })
  if (overlap) throw unprocessable('Une immobilisation couvre déjà une partie de cette période', 'OVERLAP')
  const created = await db.vehicleUnavailability.create({ data: { ...body, notes: body.notes ?? '' } as Parameters<typeof db.vehicleUnavailability.create>[0]['data'] })
  return created
})
