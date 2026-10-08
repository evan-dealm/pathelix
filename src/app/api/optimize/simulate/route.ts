import { z } from 'zod'
import { ApiError, apiRoute, unprocessable } from '@/lib/api/route'
import type { Driver, Mission } from '@/lib/types'
import { getPlanningDrivers, withEstimatedWeights } from '@/lib/data/planning'
import { getMissionsByDate } from '@/lib/data/missions'
import { getAllExutoires } from '@/lib/data/exutoires'
import { planningOptionsFromSettings } from '@/lib/vrp/tenantOptions'
import { runVRPOffThread, SolverBusyError } from '@/lib/vrp/solverPool'
import { summarizePlan } from '@/lib/vrp/summary'

const SimSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scenario: z.object({
    /** Drivers absent in the scenario. */
    removeDriverIds: z.array(z.string()).max(200).default([]),
    /** Extra trucks, each a copy of a reference driver (same depot and vehicle). */
    addTrucks: z.object({ like: z.string(), count: z.number().int().min(1).max(10) }).optional(),
    /** Day starts at this time instead of the usual one. */
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    /** Extra volume, % of the day's missions duplicated (a surge). */
    surgePct: z.number().int().min(0).max(100).default(0),
  }),
})

const BUDGET_MS = 6_000

/**
 * What-if on a day, without touching its plans: the same missions are optimised twice with the
 * same budget and seed — as things are, then with the scenario (a driver away, extra trucks, an
 * earlier start, a surge) — and both are scored by the timeline simulator.
 */
export const POST = apiRoute({ name: '/api/optimize/simulate', permission: 'optimize', schema: SimSchema }, async ({ db, tenantId, body }) => {
  const { date, scenario } = body
  const [planning, dayMissions, exutoires, settings] = await Promise.all([
    getPlanningDrivers(tenantId, date), getMissionsByDate(tenantId, date), getAllExutoires(tenantId), db.tenantSettings.findUnique({ where: { tenantId } }),
  ])
  const missions = await withEstimatedWeights(tenantId, dayMissions.filter(m => !m.archived && !m.needsGeocode))
  if (missions.length === 0) throw unprocessable('Aucune mission à planifier ce jour-là', 'EMPTY_DAY')
  if (planning.drivers.length === 0) throw unprocessable('Aucun chauffeur disponible ce jour-là', 'NO_DRIVER')
  const baseStart = settings?.defaultStartTime ?? '07:00'
  const speed = settings?.defaultSpeedKmh ?? 50
  const common = { seed: 42, timeBudgetMs: BUDGET_MS, defaultSpeedKmh: speed, valhallaFactor: settings?.valhallaFactor ?? 1.6, tenantId, ...planningOptionsFromSettings(settings) }

  // Scenario inputs.
  let drivers: Driver[] = planning.drivers.filter(d => !scenario.removeDriverIds.includes(d.id))
  if (scenario.addTrucks) {
    const ref = planning.drivers.find(d => d.id === scenario.addTrucks!.like)
    if (!ref) throw unprocessable('Chauffeur de référence inconnu', 'BAD_REF')
    drivers = [...drivers, ...Array.from({ length: scenario.addTrucks.count }, (_, i) => ({ ...ref, id: `sim-truck-${i + 1}`, firstName: 'Camion', lastName: `supplémentaire ${i + 1}` }))]
  }
  if (drivers.length === 0) throw unprocessable('Le scénario ne laisse aucun chauffeur', 'NO_DRIVER')
  let simMissions: Mission[] = missions
  if (scenario.surgePct > 0) {
    const n = Math.round(missions.length * scenario.surgePct / 100)
    // Deterministic pick: every k-th mission, copied as new demand at the same place.
    const step = Math.max(1, Math.floor(missions.length / Math.max(1, n)))
    simMissions = [...missions, ...Array.from({ length: n }, (_, i) => ({ ...missions[(i * step) % missions.length], id: `sim-extra-${i + 1}`, dependsOnId: undefined }))]
  }
  const startTime = scenario.startTime ?? baseStart

  // Both searches run in solver threads (side by side when two are available), never in the
  // event loop of the web server.
  const [base, sim] = await Promise.all([
    runVRPOffThread(missions, planning.drivers, exutoires, date, { ...common, defaultStartTime: baseStart }),
    runVRPOffThread(simMissions, drivers, exutoires, date, { ...common, defaultStartTime: startTime }),
  ]).catch(err => {
    if (err instanceof SolverBusyError) throw new ApiError(503, err.message, 'SOLVER_BUSY')
    throw err
  })
  return {
    budgetMs: BUDGET_MS,
    baseline: summarizePlan(base.assignments, base.unassignedMissions, planning.drivers, exutoires, baseStart, speed),
    scenario: summarizePlan(sim.assignments, sim.unassignedMissions, drivers, exutoires, startTime, speed),
    scenarioUnassigned: sim.unassignedMissions.slice(0, 50).map(m => ({ id: m.id, clientName: m.clientName ?? '', address: m.address, reason: sim.unassignedReasons?.[m.id]?.message ?? '' })),
  }
})
