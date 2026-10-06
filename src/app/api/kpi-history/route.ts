import { NextRequest, NextResponse } from 'next/server'
import { getTenantId }               from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import { redisCache }                from '@/lib/redisCache'
import { getTenantDb }                from '@/lib/tenantDb'

const log = createLogger('/api/kpi-history')

/**
 * Daily history for the dashboard sparklines: missions on the books, and the kilometres, fuel
 * and working time of the saved tours (measured when the tour has GPS figures, otherwise the
 * plan's estimate). Days without a tour show 0 — nothing is extrapolated.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = getTenantId(req)

    const sp   = req.nextUrl.searchParams
    const days = Math.min(30, Math.max(1, parseInt(sp.get('days') ?? '7', 10)))
    const ref  = sp.get('date') ?? new Date().toISOString().slice(0, 10)

    const result = await redisCache.getOrSet(
      'kpi-history',
      tenantId,
      async () => {
        const dates: string[] = []
        const refDate = new Date(ref + 'T12:00:00Z')
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(refDate)
          d.setUTCDate(d.getUTCDate() - i)
          dates.push(d.toISOString().slice(0, 10))
        }

        const db = getTenantDb(tenantId)
        const [missionCounts, plans, settings] = await Promise.all([
          db.mission.groupBy({
            by:     ['date'],
            where:  { date: { in: dates }, archived: false },
            _count: { id: true },
          }),
          db.plan.findMany({
            where:  { date: { in: dates } },
            select: { date: true, estimatedDistanceKm: true, actualDistanceKm: true, estimatedDurationMin: true, actualDurationMin: true },
          }),
          db.tenantSettings.findUnique({ where: { tenantId }, select: { fuelCostPerLiter: true, consumptionLPer100: true } }),
        ])
        const fuelPerKm = (settings?.fuelCostPerLiter ?? 1.8) * (settings?.consumptionLPer100 ?? 30) / 100
        const missionByDate = Object.fromEntries(missionCounts.map(r => [r.date, r._count.id]))

        return dates.map(date => {
          const day = plans.filter(p => p.date === date)
          const totalKm = Math.round(day.reduce((a, p) => a + (p.actualDistanceKm ?? p.estimatedDistanceKm ?? 0), 0) * 10) / 10
          const workMin = day.reduce((a, p) => a + (p.actualDurationMin ?? p.estimatedDurationMin ?? 0), 0)
          return {
            date,
            poolTotal:    missionByDate[date] ?? 0,
            totalKm,
            totalFuelEur: Math.round(totalKm * fuelPerKm * 10) / 10,
            avgWorkMin:   day.length > 0 ? Math.round(workMin / day.length) : 0,
          }
        })
      },
      300_000,
      `${days}:${ref}`,
    )

    return NextResponse.json({ history: result }, {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' },
    })

  } catch (err) {
    log.error('kpi-history failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
