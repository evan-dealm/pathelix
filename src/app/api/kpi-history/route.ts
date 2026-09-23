import { NextRequest, NextResponse } from 'next/server'
import { getTenantId }               from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import { redisCache }                from '@/lib/redisCache'
import { getTenantDb }                from '@/lib/tenantDb'

const log = createLogger('/api/kpi-history')

const FUEL_COST_PER_KM = 0.35
const AVG_SPEED_KMH    = 45

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
        const [missionCounts, planCounts] = await Promise.all([
          db.mission.groupBy({
            by:     ['date'],
            where:  { date: { in: dates }, archived: false },
            _count: { id: true },
          }),
          db.plan.groupBy({
            by:     ['date'],
            where:  { date: { in: dates } },
            _count: { id: true },
          }),
        ])

        const missionByDate = Object.fromEntries(missionCounts.map(r => [r.date, r._count.id]))
        const planByDate    = Object.fromEntries(planCounts.map(r => [r.date, r._count.id]))

        return dates.map(date => {
          const poolTotal   = missionByDate[date] ?? 0
          const driverCount = planByDate[date]    ?? 0
          const estimatedKm = driverCount * 80
          const totalKm     = poolTotal > 0 ? estimatedKm : 0
          const totalFuelEur = Math.round(totalKm * FUEL_COST_PER_KM * 10) / 10
          const avgWorkMin   = poolTotal > 0 && driverCount > 0
            ? Math.round((poolTotal * 30 + totalKm / AVG_SPEED_KMH * 60) / driverCount)
            : 0
          return { date, poolTotal, totalKm, totalFuelEur, avgWorkMin }
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
