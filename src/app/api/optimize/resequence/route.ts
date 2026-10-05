import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'
import { getAllExutoires } from '@/lib/data/exutoires'
import { getDriver } from '@/lib/data/drivers'
import { runMvAlns } from '@/lib/vrp/mvAlns'
import { buildInitialSolution, formatSolutionForAPI } from '@/lib/vrp/formatSolution'
import { computeSolutionCost } from '@/lib/vrp/routeCost'
import type { CostContext, ALNSParams } from '@/lib/vrp/types'
import type { Mission } from '@/lib/types'
import { prismaRowToMission } from '@/lib/prismaMappers'
import { hasPermission } from '@/lib/permissions'
import { unscopedPrisma } from '@/lib/tenantDb'
import { isLocked, lockedSteps, mergeLockedAndOptimized, nowMinutesInTimeZone, parsePlanMissions } from '@/lib/vrp/livePlan'

const log = createLogger('/api/optimize/resequence')

const ResequenceSchema = z.object({
  driverId: z.string().min(1),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'optimize'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ResequenceSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { driverId, date } = parsed.data
  const startTs = Date.now()

  try {
    const db = getTenantDb(tenantId)
    const driver = await getDriver(tenantId, driverId)
    if (!driver) {
      return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    }

    const plan = await db.plan.findFirst({
      where: { driverId, date },
    })
    if (!plan) {
      return NextResponse.json({ error: 'Aucun plan existant pour cette date' }, { status: 404 })
    }

    const statuses = (typeof plan.statuses === 'object' && plan.statuses !== null)
      ? plan.statuses as Record<string, unknown>
      : {}

    const planMissions = parsePlanMissions(plan.missions)
    // Steps already acted on (en route, on site, done…) keep their place; only the untouched
    // client missions are re-sequenced (synthetic dump/break steps are regenerated).
    const locked = lockedSteps(planMissions, statuses)
    const remainingMissionIds = planMissions
      .filter(m => !m.isSynthetic && !isLocked(statuses[m.id]))
      .map(m => m.id)

    if (remainingMissionIds.length <= 1) {
      return NextResponse.json({
        message: 'Pas assez de missions restantes pour re-séquencer',
        timeTakenMs: Date.now() - startTs,
      })
    }

    const missionRows = await db.mission.findMany({
      where: { id: { in: remainingMissionIds } },
    })
    const missions: Mission[] = missionRows.map(r =>
      prismaRowToMission(r as unknown as Record<string, unknown>),
    )

    const exutoires = await getAllExutoires(tenantId)

    const plannedStartMin = (() => {
      const t = plan.startTime ?? '07:00'
      const parts = t.split(':').map(Number)
      return Math.max(0, Math.min(23, parts[0] || 0)) * 60 + Math.max(0, Math.min(59, parts[1] || 0))
    })()
    // Once the day has started, the remainder starts now (tenant local time), not at 07:00.
    const tenant = locked.length > 0
      ? await unscopedPrisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } })
      : null
    const ctx: CostContext = {
      depotLat:     driver.depotLat,
      depotLng:     driver.depotLng,
      startTimeMin: locked.length > 0
        ? Math.max(plannedStartMin, nowMinutesInTimeZone(tenant?.timezone ?? 'Europe/Paris'))
        : plannedStartMin,
      speedKmh:     Math.max(1, Math.min(130, plan.speedKmh ?? 50)),
      exutoires,
      date,
    }

    const params: ALNSParams = {
      timeBudgetMs: 2000,
      seed:         Date.now() % 10000,
      iterations:   200,
      destroyRatio: 0.3,
      saT0Ratio:    0.06,
      saTMinRatio:  0.0003,
      rhoForget:    0.8,
    }

    const initial = buildInitialSolution(missions, [driver], ctx)
    initial.cost = computeSolutionCost(initial.routes, ctx, [driver])

    const optimized = missions.length > 1
      ? runMvAlns(initial, ctx, [driver], params)
      : initial

    const result = formatSolutionForAPI(optimized, [driver], ctx)
    // Locked steps first — done/in-progress missions used to be dropped from the plan here.
    const driverPlan = mergeLockedAndOptimized(locked, result.assignments[driverId] ?? [])

    await db.plan.update({
      where: { id: plan.id },
      data: {
        missions: driverPlan as unknown as Parameters<typeof db.plan.update>[0]['data']['missions'],
      },
    })

    log.info('Resequence completed', {
      driverId,
      date,
      missionCount: missions.length,
      timeTakenMs: Date.now() - startTs,
    })

    return NextResponse.json({
      plan: driverPlan ?? [],
      cost: optimized.cost,
      missionCount: missions.length,
      timeTakenMs: Date.now() - startTs,
    })
  } catch (err) {
    log.error('Resequence failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
