import { NextRequest, NextResponse } from 'next/server'
import prisma                        from '@/lib/db'
import { getRequestContext }         from '@/lib/data/context'

interface TradeBenchmark {
  trade:              string
  tenantCount:        number
  avgDurationRatio:   number
  avgDistanceKm:      number
  avgCompletionRate:  number
  medianDurationMin:  number
  p75DurationMin:     number
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  }

  try {

    const tenants = await prisma.tenant.findMany({
      where: { trade: { not: null } },
      select: { id: true, trade: true },
    })

    if (tenants.length === 0) {
      return NextResponse.json({ benchmarks: [], currentTrade: null })
    }

    const tradeMap = new Map<string, string[]>()
    for (const t of tenants) {
      if (!t.trade) continue
      const list = tradeMap.get(t.trade) ?? []
      list.push(t.id)
      tradeMap.set(t.trade, list)
    }

    const benchmarks: TradeBenchmark[] = []
    for (const [trade, ids] of tradeMap) {
      const metrics = await prisma.interventionMetric.findMany({
        where: { tenantId: { in: ids }, isReliable: true },
        select: {
          tenantId:            true,
          estimatedDurationMin: true,
          actualDurationMin:   true,
          distanceKm:          true,
        },
      })

      if (metrics.length < 10) continue

      const missions = await prisma.mission.findMany({
        where: { tenantId: { in: ids } },
        select: { tenantId: true, completedAt: true, cancelledAt: true },
      })

      const tenantsInTrade = new Set(metrics.map(m => m.tenantId))

      const ratios = metrics
        .filter(m => m.estimatedDurationMin > 0)
        .map(m => m.actualDurationMin / m.estimatedDurationMin)
        .filter(r => r > 0.1 && r < 5)
        .sort((a, b) => a - b)

      const durations = metrics.map(m => m.actualDurationMin).sort((a, b) => a - b)
      const distances = metrics.map(m => m.distanceKm ?? 0)
      const missionArr = missions

      const avgDurationRatio = ratios.length > 0
        ? ratios.reduce((s, r) => s + r, 0) / ratios.length
        : 1

      const avgDistanceKm = distances.reduce((s, d) => s + d, 0) / distances.length

      const done      = missionArr.filter(m => m.completedAt !== null).length
      const avgCompletionRate = missionArr.length > 0
        ? Math.round((done / missionArr.length) * 100)
        : 0

      const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0
      const p75 = durations[Math.floor(durations.length * 0.75)] ?? 0

      benchmarks.push({
        trade,
        tenantCount:       tenantsInTrade.size,
        avgDurationRatio:  Math.round(avgDurationRatio * 100) / 100,
        avgDistanceKm:     Math.round(avgDistanceKm * 10) / 10,
        avgCompletionRate,
        medianDurationMin: Math.round(p50),
        p75DurationMin:    Math.round(p75),
      })
    }

    const currentTenant = tenants.find(t => t.id === tenantId)
    const currentTrade  = currentTenant?.trade ?? null

    let currentStats: Omit<TradeBenchmark, 'trade' | 'tenantCount'> | null = null
    if (currentTrade) {
      const myMetrics = await prisma.interventionMetric.findMany({
        where: { tenantId, isReliable: true },
        select: { estimatedDurationMin: true, actualDurationMin: true, distanceKm: true },
      })
      const myMissions = await prisma.mission.findMany({
        where: { tenantId },
        select: { completedAt: true },
      })

      if (myMetrics.length >= 5) {
        const myRatios = myMetrics
          .filter(m => m.estimatedDurationMin > 0)
          .map(m => m.actualDurationMin / m.estimatedDurationMin)
          .filter(r => r > 0.1 && r < 5)

        const myDurs = myMetrics.map(m => m.actualDurationMin).sort((a, b) => a - b)
        const myDone = myMissions.filter(m => m.completedAt !== null).length

        currentStats = {
          avgDurationRatio:  myRatios.length > 0
            ? Math.round((myRatios.reduce((s, r) => s + r, 0) / myRatios.length) * 100) / 100
            : 1,
          avgDistanceKm:     Math.round((myMetrics.reduce((s, m) => s + (m.distanceKm ?? 0), 0) / myMetrics.length) * 10) / 10,
          avgCompletionRate: myMissions.length > 0 ? Math.round((myDone / myMissions.length) * 100) : 0,
          medianDurationMin: Math.round(myDurs[Math.floor(myDurs.length * 0.5)] ?? 0),
          p75DurationMin:    Math.round(myDurs[Math.floor(myDurs.length * 0.75)] ?? 0),
        }
      }
    }

    return NextResponse.json({
      benchmarks: benchmarks.sort((a, b) => b.tenantCount - a.tenantCount),
      currentTrade,
      currentStats,
    }, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
