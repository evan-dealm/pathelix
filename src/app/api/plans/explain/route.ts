import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import type { Mission, PlannedMission } from '@/lib/types'
import { getPlanningDrivers } from '@/lib/data/planning'
import { getAllExutoires } from '@/lib/data/exutoires'
import { planningOptionsFromSettings } from '@/lib/vrp/tenantOptions'
import { explainAssignment } from '@/lib/vrp/explain'
import type { CostContext } from '@/lib/vrp/types'

/**
 * "Why is this mission with this driver?" — for a saved day: the km and minutes it adds to its
 * route against the cheapest feasible place in every other driver's route, or why it cannot go
 * there. Same simulator as the optimiser.
 */
export const GET = apiRoute({ name: '/api/plans/explain', permission: 'optimize' }, async ({ db, tenantId, req }) => {
  const sp = req.nextUrl.searchParams
  const date = sp.get('date') ?? ''
  const missionId = sp.get('missionId') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !missionId) throw unprocessable('date et missionId requis', 'PARAMS')
  const [plans, planning, exutoires, settings] = await Promise.all([
    db.plan.findMany({ where: { date }, select: { driverId: true, missions: true, startTime: true, speedKmh: true } }),
    getPlanningDrivers(tenantId, date),
    getAllExutoires(tenantId),
    db.tenantSettings.findUnique({ where: { tenantId } }),
  ])
  const routes = plans.map(p => ({
    driverId: p.driverId,
    // Synthetic steps (dump trips, breaks) are rebuilt by the simulator.
    missions: (Array.isArray(p.missions) ? p.missions as unknown as PlannedMission[] : []).filter(m => !m.id.startsWith('_')) as Mission[],
  }))
  if (!routes.some(r => r.missions.some(m => m.id === missionId))) throw notFound('Mission planifiée')
  const ref = plans[0]
  const [h, m] = (ref?.startTime ?? '07:00').split(':').map(Number)
  const opts = planningOptionsFromSettings(settings)
  const ctx: CostContext = {
    depotLat: planning.drivers[0]?.depotLat ?? 0, depotLng: planning.drivers[0]?.depotLng ?? 0,
    startTimeMin: (h || 0) * 60 + (m || 0), speedKmh: ref?.speedKmh ?? 50, exutoires, date,
    regulation: opts.regulation, maxWorkMin: opts.maxWorkMin, costConfig: opts.costConfig,
  }
  const names = Object.fromEntries(planning.drivers.map(d => [d.id, `${d.firstName} ${d.lastName}`.trim()]))
  const alternatives = explainAssignment(missionId, planning.drivers, routes, ctx).map(a => ({ ...a, driverName: names[a.driverId] ?? a.driverId }))
  const excluded = planning.excluded.map(e => ({ driverId: e.driverId, driverName: e.name, reason: e.detail }))
  return { missionId, alternatives, excluded }
})
