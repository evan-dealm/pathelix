import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantDb } from '@/lib/tenantDb'
import { refreshPlanEstimates } from '@/lib/data/planEstimates'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { getAllDrivers } from '@/lib/data/drivers'
import { getMissionsByDate } from '@/lib/data/missions'
import { getPlanningDrivers, exclusionMessage, withEstimatedWeights } from '@/lib/data/planning'
import { planningOptionsFromSettings } from '@/lib/vrp/tenantOptions'
import { getAllExutoires } from '@/lib/data/exutoires'
import { runVRPOffThread, SolverBusyError } from '@/lib/vrp/solverPool'
import { lockedSteps, mergeLockedAndOptimized, parsePlanMissions } from '@/lib/vrp/livePlan'
import { hasPermission } from '@/lib/permissions'

const log = createLogger('/api/weekly-plan')

const WeeklyPlanSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  settings:  z.object({
    timeBudgetMs: z.number().int().min(1000).max(300000).optional(),
    weights:      z.object({ distance: z.number(), punctuality: z.number(), balance: z.number() }).optional(),
  }).optional(),
})

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const weekStart = req.nextUrl.searchParams.get('weekStart')

  const db = getTenantDb(tenantId)

  if (weekStart) {
    const plan = await db.weeklyPlan.findUnique({ where: { tenantId_weekStart: { tenantId, weekStart } } })
    if (!plan) return NextResponse.json({ error: 'Plan hebdo introuvable' }, { status: 404 })
    return NextResponse.json(plan)
  }

  const plans = await db.weeklyPlan.findMany({
    orderBy: { weekStart: 'desc' },
    take: 10,
    select: { id: true, weekStart: true, status: true, createdAt: true, createdBy: true },
  })
  return NextResponse.json(plans)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }
  if (!(await hasPermission(userId, role, 'optimize'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = WeeklyPlanSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { weekStart, settings } = parsed.data

  try {
    const db = getTenantDb(tenantId)
    const weeklyPlan = await db.weeklyPlan.upsert({
      // The compound unique key structurally requires tenantId here — this is not a manual
      // tenant-scope check to remove, it's part of the DB constraint's shape.
      where: { tenantId_weekStart: { tenantId, weekStart } },
      create: { weekStart, status: 'optimizing', createdBy: userId, settings: settings ?? {} } as Parameters<typeof db.weeklyPlan.upsert>[0]['create'],
      update: { status: 'optimizing', settings: settings ?? {} },
    })

    // Every active driver's plan is rewritten each day; only those available that day get work.
    const drivers = (await getAllDrivers(tenantId)).filter(d => !d.archived)
    const exutoires = await getAllExutoires(tenantId)
    const tenantSettings = await db.tenantSettings.findUnique({ where: { tenantId } })
    const startTime = tenantSettings?.defaultStartTime ?? '07:00'
    const speedKmh  = tenantSettings?.defaultSpeedKmh ?? 50
    const timeBudgetPerDay = Math.floor((settings?.timeBudgetMs ?? 60000) / 5)

    const weekResult: Record<string, unknown> = {}
    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']

    for (let d = 0; d < 5; d++) {
      const date = addDays(weekStart, d)

      // Same mission loading as the daily optimisation: time windows, skills, dependencies and
      // weights were dropped by the hand-written mapping this replaces.
      const missions = await withEstimatedWeights(tenantId, (await getMissionsByDate(tenantId, date)).filter(m => !m.needsGeocode))
      const dayDrivers = await getPlanningDrivers(tenantId, date)

      if (missions.length === 0) {
        weekResult[date] = { day: dayNames[d], missions: 0, skipped: true }
        continue
      }

      // Off the event loop: a week is five searches of up to a minute each.
      const result = await runVRPOffThread(missions, dayDrivers.drivers, exutoires, date, {
        timeBudgetMs: timeBudgetPerDay,
        weights: settings?.weights,
        defaultStartTime: startTime,
        defaultSpeedKmh:  speedKmh,
        valhallaFactor:   tenantSettings?.valhallaFactor ?? 1.60,
        tenantId,
        ...planningOptionsFromSettings(tenantSettings),
        extraWarnings: dayDrivers.excluded.map(e => ({ driverId: e.driverId, message: exclusionMessage(e), severity: 'warning' as const })),
      })

      // The whole day is replanned: every active driver's plan is rewritten (a driver left
      // empty would otherwise keep missions now given to someone else), steps already acted on
      // are kept first, and the day is written atomically.
      const existing = await db.plan.findMany({ where: { date }, select: { driverId: true, missions: true, statuses: true } })
      const existingByDriver = new Map(existing.map(p => [p.driverId, p]))
      await db.$transaction(async (tx) => {
        for (const driver of drivers) {
          const prev = existingByDriver.get(driver.id)
          const locked = prev ? lockedSteps(parsePlanMissions(prev.missions), (prev.statuses ?? {}) as Record<string, unknown>) : []
          const merged = mergeLockedAndOptimized(locked, result.assignments[driver.id] ?? [])
          if (!prev && merged.length === 0) continue
          const missionsJson = merged as unknown as Parameters<typeof tx.plan.update>[0]['data']['missions']
          await tx.plan.upsert({
            // The compound unique key structurally requires tenantId here.
            where: { tenantId_driverId_date: { tenantId, driverId: driver.id, date } },
            create: { driverId: driver.id, date, missions: missionsJson, startTime, speedKmh } as Parameters<typeof tx.plan.upsert>[0]['create'],
            update: { missions: missionsJson },
          })
        }
      }, { timeout: 30_000 })
      await refreshPlanEstimates(db, tenantId, drivers.map(d => ({ driverId: d.id, date })))

      weekResult[date] = {
        day: dayNames[d],
        missions: missions.length,
        assigned: result.stats.assignedMissions,
        unassigned: result.unassignedMissions.length,
        score: result.stats.score,
        timeTakenMs: result.stats.timeTakenMs,
        warnings: result.warnings.length,
      }
    }

    await db.weeklyPlan.update({
      where: { id: weeklyPlan.id },
      data: { status: 'published', result: weekResult as unknown as Parameters<typeof db.weeklyPlan.update>[0]['data']['result'] },
    })

    log.info('Weekly plan completed', { tenantId, weekStart, days: Object.keys(weekResult).length })

    return NextResponse.json({
      id: weeklyPlan.id,
      weekStart,
      status: 'published',
      result: weekResult,
    })
  } catch (err) {
    log.error('Weekly plan failed', { err: err instanceof Error ? err.message : String(err) })

    await getTenantDb(tenantId).weeklyPlan.updateMany({
      where: { weekStart },
      data: { status: 'failed' },
    }).catch(() => {})
    if (err instanceof SolverBusyError) {
      return NextResponse.json({ error: err.message, code: 'SOLVER_BUSY' }, { status: 503, headers: { 'Retry-After': '30' } })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
