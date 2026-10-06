import { ApiError, apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { hasPermission } from '@/lib/permissions'
import { getRequestContext } from '@/lib/data/context'
import { DefectSchema } from '@/lib/fleet/schemas'
import { reportDefect } from '@/lib/fleet/service'

/** Open defects (or all with ?status=ALL), newest first. */
export const GET = apiRoute({ name: '/api/vehicle-defects', permission: 'manage_vehicles' }, async ({ db, req }) => {
  const status = req.nextUrl.searchParams.get('status')
  const vehicleId = req.nextUrl.searchParams.get('vehicleId')
  const data = await db.vehicleDefect.findMany({
    where: { ...(status === 'ALL' ? {} : { status: { in: ['OPEN', 'IN_REPAIR'] } }), ...(vehicleId ? { vehicleId } : {}) },
    orderBy: { createdAt: 'desc' }, take: 200,
    include: { vehicle: { select: { licensePlate: true } } },
  })
  return { data }
})

/**
 * A defect report. Drivers report on the truck assigned to them (walk-around check); the office
 * on any truck. A CRITICAL defect immobilises the truck for planning until it is repaired.
 */
export const POST = apiRoute({ name: '/api/vehicle-defects', allowDriver: true, schema: DefectSchema }, async ({ db, tenantId, userId, role, body, req }) => {
  let driverId: string | null = null
  let vehicleId = body.vehicleId
  if (role === 'driver') {
    driverId = getRequestContext(req).driverRef ?? null
    if (!driverId) throw unprocessable('Session chauffeur sans fiche chauffeur', 'NO_DRIVER')
    const assigned = await db.vehicle.findMany({ where: { assignedDriverId: driverId, archived: false }, select: { id: true }, orderBy: { createdAt: 'asc' } })
    if (vehicleId ? !assigned.some(v => v.id === vehicleId) : assigned.length === 0) {
      throw unprocessable('Aucun camion ne vous est attribué : signalez le défaut au bureau', 'NO_VEHICLE')
    }
    vehicleId ??= assigned[0].id
  } else {
    if (!(await hasPermission(userId, role, 'manage_vehicles'))) throw new ApiError(403, 'Permission refusée', 'FORBIDDEN')
    if (!vehicleId) throw unprocessable('Véhicule requis', 'NO_VEHICLE')
  }
  const defect = await reportDefect(db, tenantId, { ...body, vehicleId, driverId, reportedBy: userId })
  if (!defect) throw notFound('Véhicule')
  return defect
})
