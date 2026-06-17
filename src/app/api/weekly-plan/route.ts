import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { getAllDrivers } from '@/lib/data/drivers'
import { getAllExutoires } from '@/lib/data/exutoires'
import { runVRP } from '@/lib/vrp/index'
import type { Mission } from '@/lib/types'

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

  if (weekStart) {
    const plan = await prisma.weeklyPlan.findUnique({ where: { tenantId_weekStart: { tenantId, weekStart } } })
    if (!plan) return NextResponse.json({ error: 'Plan hebdo introuvable' }, { status: 404 })
    return NextResponse.json(plan)
  }

  const plans = await prisma.weeklyPlan.findMany({
    where: { tenantId },
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

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = WeeklyPlanSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { weekStart, settings } = parsed.data

  try {

    const weeklyPlan = await prisma.weeklyPlan.upsert({
      where: { tenantId_weekStart: { tenantId, weekStart } },
      create: { tenantId, weekStart, status: 'optimizing', createdBy: userId, settings: settings ?? {} },
      update: { status: 'optimizing', settings: settings ?? {} },
    })

    const drivers = await getAllDrivers(tenantId)
    const exutoires = await getAllExutoires(tenantId)
    const timeBudgetPerDay = Math.floor((settings?.timeBudgetMs ?? 60000) / 5)

    const weekResult: Record<string, unknown> = {}
    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']

    for (let d = 0; d < 5; d++) {
      const date = addDays(weekStart, d)

      const missionRows = await prisma.mission.findMany({
        where: { tenantId, date, archived: false, needsGeocode: false },
      })

      const missions: Mission[] = missionRows.map(m => ({
        id: m.id,
        type: m.type as Mission['type'],
        date: m.date,
        address: m.address,
        latitude: m.latitude,
        longitude: m.longitude,
        estimatedDurationMin: m.estimatedDurationMin,
        maneuverTimeMin: m.maneuverTimeMin,
        clientName: m.clientName ?? undefined,
        wasteTypeLabel: m.wasteTypeLabel ?? undefined,
        priority: m.priority as Mission['priority'],
        linkedExutoireId: m.linkedExutoireId ?? undefined,
        accessNotes: m.accessNotes ?? undefined,
        binSize: m.binSize ?? undefined,
        binSizeM3: m.binSizeM3 ?? undefined,
      }))

      if (missions.length === 0) {
        weekResult[date] = { day: dayNames[d], missions: 0, skipped: true }
        continue
      }

      const result = await runVRP(missions, drivers, exutoires, date, {
        timeBudgetMs: timeBudgetPerDay,
        weights: settings?.weights,
      })

      for (const [driverId, planned] of Object.entries(result.assignments)) {
        if (planned.length === 0) continue
        await prisma.plan.upsert({
          where: { tenantId_driverId_date: { tenantId, driverId, date } },
          create: {
            tenantId, driverId, date,
            missions: planned as unknown as Parameters<typeof prisma.plan.create>[0]['data']['missions'],
            startTime: '07:00', speedKmh: 50,
          },
          update: {
            missions: planned as unknown as Parameters<typeof prisma.plan.update>[0]['data']['missions'],
          },
        })
      }

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

    await prisma.weeklyPlan.update({
      where: { id: weeklyPlan.id },
      data: { status: 'published', result: weekResult as unknown as Parameters<typeof prisma.weeklyPlan.update>[0]['data']['result'] },
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

    await prisma.weeklyPlan.updateMany({
      where: { tenantId, weekStart },
      data: { status: 'failed' },
    }).catch(() => {})
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
