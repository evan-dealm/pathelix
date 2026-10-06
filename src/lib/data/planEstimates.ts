import type { TenantDb } from '@/lib/tenantDb'
import type { PlannedMission } from '@/lib/types'
import { calcTour } from '@/lib/algorithm'
import { getAllExutoires } from './exutoires'
import { createLogger } from '@/lib/logger'

const log = createLogger('planEstimates')

/**
 * Stores each saved tour's estimated distance and duration (same simulation as the timeline) on
 * the Plan row, so reports and KPIs read them instead of extrapolating. Best effort: a failure
 * here never fails the save that triggered it.
 */
export async function refreshPlanEstimates(db: TenantDb, tenantId: string, keys: Array<{ driverId: string; date: string }>): Promise<void> {
  if (keys.length === 0) return
  try {
    const dates = [...new Set(keys.map(k => k.date))]
    const driverIds = [...new Set(keys.map(k => k.driverId))]
    const [plans, drivers, exutoires] = await Promise.all([
      db.plan.findMany({ where: { date: { in: dates }, driverId: { in: driverIds } }, select: { id: true, driverId: true, date: true, missions: true, startTime: true, speedKmh: true } }),
      db.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, depotLat: true, depotLng: true } }),
      getAllExutoires(tenantId),
    ])
    const depot = new Map(drivers.map(d => [d.id, d]))
    const wanted = new Set(keys.map(k => `${k.driverId}|${k.date}`))
    for (const p of plans) {
      if (!wanted.has(`${p.driverId}|${p.date}`)) continue
      const d = depot.get(p.driverId)
      const steps = Array.isArray(p.missions) ? p.missions as unknown as PlannedMission[] : []
      if (!d) continue
      const t = steps.length ? calcTour(steps, d.depotLat, d.depotLng, p.startTime, p.speedKmh, exutoires) : null
      await db.plan.update({
        where: { id: p.id },
        data: { estimatedDistanceKm: t ? Math.round(t.totalRoadDistKm * 10) / 10 : 0, estimatedDurationMin: t ? Math.round(t.totalDurationMin) : 0 },
      })
    }
  } catch (err) {
    log.warn('Plan estimates not refreshed', { tenantId, err: err instanceof Error ? err.message : String(err) })
  }
}
