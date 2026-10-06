import { NextRequest, NextResponse } from 'next/server'
import { assertTenantDrivers, ForeignTenantRefError } from '@/lib/tenantRefs'
import { hasPermission } from '@/lib/permissions'
import type { PlannedMission }       from '@/lib/types'
import { PlanSchema }                from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getTenantDb }                from '@/lib/tenantDb'
import { refreshPlanEstimates } from '@/lib/data/planEstimates'
import { emitEvent }                 from '@/lib/integrationEvents'
import { redisCache }                from '@/lib/redisCache'

const log     = createLogger('/api/plans')
const useMock = process.env.USE_MOCK_DATA !== 'false'

interface MockPlan {
  driverId:  string
  date:      string
  missions:  PlannedMission[]
  startTime: string
  speedKmh:  number
}

const _mockPlans = new Map<string, MockPlan>()

export async function GET(req: NextRequest): Promise<NextResponse> {
  const date     = req.nextUrl.searchParams.get('date')
  const tenantId = getTenantId(req)

  if (!date) {
    return NextResponse.json({ error: 'Paramètre date requis' }, { status: 400 })
  }

  try {
    if (useMock) {
      const plans: MockPlan[] = []
      for (const [key, plan] of _mockPlans.entries()) {
        if (key.startsWith(`${tenantId}|`) && key.endsWith(`|${date}`)) plans.push(plan)
      }
      return NextResponse.json(plans)
    }

    const plans = await redisCache.getOrSet(
      'plans',
      tenantId,
      async () => {
        const records = await getTenantDb(tenantId).plan.findMany({
          where: { date },
          select: { id: true, driverId: true, date: true, missions: true, startTime: true, speedKmh: true },
        })
        return records.map(r => {
          let missions: PlannedMission[] = []
          try {
            const raw = Array.isArray(r.missions) ? r.missions
              : typeof r.missions === 'string' ? JSON.parse(r.missions) as unknown[]
              : []
            if (Array.isArray(raw)) {
              missions = raw.filter((m): m is PlannedMission => {
                return m !== null && typeof m === 'object' && typeof (m as Record<string, unknown>).id === 'string'
              })
            }
          } catch {
            log.warn(`JSON invalide pour le plan ${r.id}`)
          }
          return { id: r.id, driverId: r.driverId, date: r.date, missions, startTime: r.startTime, speedKmh: r.speedKmh }
        })
      },
      10_000,
      date,
    )
    return NextResponse.json(plans, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const { userId, role } = getRequestContext(req)
  // Writing plans = publishing tours to drivers: same permission as optimising.
  if (!(await hasPermission(userId, role, 'optimize'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const arr     = Array.isArray(body) ? body : [body]

  const MAX_BATCH_SIZE = 500
  if (arr.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Taille du lot trop grande (max ${MAX_BATCH_SIZE} plans par requête)` },
      { status: 400 },
    )
  }

  const results = arr.map(item => PlanSchema.safeParse(item))
  const invalid = results.find(r => !r.success)
  if (invalid && !invalid.success) {
    return NextResponse.json({ error: invalid.error.flatten() }, { status: 422 })
  }

  const plans = results
    .filter((r): r is { success: true; data: import('@/lib/schemas').PlanInput } => r.success)
    .map(r => r.data)

  try {
    if (useMock) {
      for (const plan of plans) {
        const key = `${tenantId}|${plan.driverId}|${plan.date}`
        _mockPlans.set(key, {
          driverId:  plan.driverId,
          date:      plan.date,
          missions:  plan.missions as unknown as PlannedMission[],
          startTime: plan.startTime ?? '07:00',
          speedKmh:  plan.speedKmh  ?? 50,
        })
      }
      return NextResponse.json({ saved: plans.length })
    }

    const db = getTenantDb(tenantId)
    // Plan.driverId has a plain FK: a driver id of another tenant would be accepted and its
    // name/depot later read back through the relation (reports, p1-risk).
    try {
      await assertTenantDrivers(db, plans.map(p => p.driverId))
    } catch (err) {
      if (err instanceof ForeignTenantRefError) return NextResponse.json({ error: 'Chauffeur inconnu dans un des plans' }, { status: 422 })
      throw err
    }
    // All-or-nothing: a failure half-way used to leave some drivers' plans saved and others not.
    await db.$transaction(async (tx) => {
      for (const plan of plans) {
        await tx.plan.upsert({
          // The compound unique key structurally requires tenantId here — this is not a manual
          // tenant-scope check to remove, it's part of the DB constraint's shape.
          where: {
            tenantId_driverId_date: { tenantId, driverId: plan.driverId, date: plan.date },
          },
          create: {
            driverId:  plan.driverId,
            date:      plan.date,
            missions:  plan.missions as object[],
            startTime: plan.startTime ?? '07:00',
            speedKmh:  plan.speedKmh  ?? 50,
          } as Parameters<typeof tx.plan.upsert>[0]['create'],
          update: {
            missions:  plan.missions as object[],
            startTime: plan.startTime ?? '07:00',
            speedKmh:  plan.speedKmh  ?? 50,
          },
        })
      }
    }, { timeout: 30_000 })
    await refreshPlanEstimates(db, tenantId, plans.map(p => ({ driverId: p.driverId, date: p.date })))

    const affectedDates = new Set(plans.map(p => p.date))
    for (const d of affectedDates) void redisCache.invalidate('plans', tenantId, d)

    const date = plans[0]?.date
    void emitEvent(tenantId, 'tour.published', {
      date,
      driverCount: plans.length,
      totalMissions: plans.reduce((sum, p) => sum + (p.missions?.length ?? 0), 0),
    })

    return NextResponse.json({ saved: plans.length })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })

  const date = req.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Paramètre date requis (format YYYY-MM-DD) pour limiter la suppression' },
      { status: 400 },
    )
  }

  try {
    const result = await getTenantDb(tenantId).plan.deleteMany({ where: { date } })
    void redisCache.invalidate('plans', tenantId, date)
    log.info('Plans purged', { tenantId, date, count: result.count })
    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (err) {
    log.error('DELETE failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
