import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/plans/p1-risk')

const SPEED_KMH       = 50
const START_MIN       = 420
const DEFAULT_CLOSE   = 1080

interface P1RiskResult {
  missionId:   string
  address:     string
  driverId:    string
  driverName:  string
  risk:        'low' | 'medium' | 'high'
  score:       number
  reason:      string
  estArrivalMin: number
  twCloseMin:  number | null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  const dateParam = req.nextUrl.searchParams.get('date')
    ?? new Date().toISOString().split('T')[0]

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Date invalide (YYYY-MM-DD)' }, { status: 400 })
  }

  try {

    const db = getTenantDb(tenantId)
    const plans = await db.plan.findMany({
      where:  { date: dateParam },
      select: {
        driverId: true,
        missions: true,
        driver: {
          select: {
            id:        true,
            firstName: true,
            lastName:  true,
            depotLat:  true,
            depotLng:  true,
          },
        },
      },
    })

    if (plans.length === 0) {
      return NextResponse.json({ date: dateParam, p1Risks: [] })
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]
    const metrics = await db.interventionMetric.findMany({
      where: {
        date:       { gte: thirtyDaysAgo },
        isReliable: true,
        actualDurationMin:    { gt: 0 },
        estimatedDurationMin: { gt: 0 },
      },
      select: {
        driverId:             true,
        actualDurationMin:    true,
        estimatedDurationMin: true,
      },
    })

    const driverRatioMap = new Map<string, number>()
    const driverCounts  = new Map<string, number>()
    for (const m of metrics) {
      const ratio   = m.actualDurationMin / m.estimatedDurationMin
      const current = driverRatioMap.get(m.driverId) ?? 0
      driverRatioMap.set(m.driverId, current + ratio)
      driverCounts.set(m.driverId, (driverCounts.get(m.driverId) ?? 0) + 1)
    }
    for (const [id, sum] of driverRatioMap) {
      const count = driverCounts.get(id) ?? 1
      driverRatioMap.set(id, sum / count)
    }

    const results: P1RiskResult[] = []

    for (const plan of plans) {
      const missions = plan.missions as Array<{
        id: string
        priority?: number
        isSynthetic?: boolean
        latitude?: number
        longitude?: number
        address?: string
        estimatedDurationMin?: number
        maneuverTimeMin?: number
        precomputedTravelMin?: number
        timeWindow?: { openMin: number; closeMin: number } | null
      }>

      if (!Array.isArray(missions)) continue

      const driverName    = `${plan.driver.firstName} ${plan.driver.lastName}`
      const driverRatio   = driverRatioMap.get(plan.driverId) ?? 1.0
      const performancePenalty = Math.max(0, driverRatio - 1.0)

      let currentMin = START_MIN
      let prevLat    = plan.driver.depotLat
      let prevLng    = plan.driver.depotLng

      for (let seq = 0; seq < missions.length; seq++) {
        const m = missions[seq]
        if (m.isSynthetic) continue

        const travelMin = (() => {
          if (m.precomputedTravelMin) return m.precomputedTravelMin * driverRatio
          if (m.latitude && m.longitude) {
            const dLat  = (m.latitude  - prevLat) * Math.PI / 180
            const dLng  = (m.longitude - prevLng) * Math.PI / 180
            const sinLat = Math.sin(dLat / 2)
            const sinLng = Math.sin(dLng / 2)
            const a = sinLat * sinLat
              + Math.cos(prevLat * Math.PI / 180) * Math.cos(m.latitude * Math.PI / 180) * sinLng * sinLng
            const distKm = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a))) * 1.35
            return (distKm / SPEED_KMH) * 60 * driverRatio
          }
          return 15 * driverRatio
        })()

        currentMin += travelMin

        if (m.timeWindow && currentMin < m.timeWindow.openMin) {
          currentMin = m.timeWindow.openMin
        }

        const arrivalMin = currentMin
        const duration   = ((m.estimatedDurationMin ?? 30) + (m.maneuverTimeMin ?? 10)) * driverRatio
        currentMin += duration

        if (m.latitude && m.longitude) {
          prevLat = m.latitude
          prevLng = m.longitude
        }

        if (m.priority !== 1) continue

        const twClose    = m.timeWindow?.closeMin ?? DEFAULT_CLOSE
        const slackMin   = twClose - arrivalMin

        const slackRatio = slackMin / (twClose - START_MIN)
        const slackScore = slackRatio < 0
          ? 1.0
          : slackRatio < 0.10 ? 0.85
          : slackRatio < 0.25 ? 0.55
          : slackRatio < 0.45 ? 0.25
          : 0.10

        const nonSynthetic = missions.filter(x => !x.isSynthetic)
        const position     = nonSynthetic.indexOf(m)
        const posScore     = position >= 8 ? 0.70
          : position >= 5 ? 0.45
          : position >= 3 ? 0.25
          : 0.10

        const perfScore = Math.min(1, performancePenalty * 2)

        const score = Math.min(1, 0.50 * slackScore + 0.30 * posScore + 0.20 * perfScore)
        const risk  = score >= 0.65 ? 'high' : score >= 0.35 ? 'medium' : 'low'

        const reason = slackMin < 0
          ? `Arrivée estimée ${Math.round(-slackMin)} min après la ferêture du créneau`
          : slackMin < 30
          ? `Marge de ${Math.round(slackMin)} min seulement avant clôture`
          : position >= 5
          ? `Position ${position + 1} dans la tournée — ${position} missions avant`
          : driverRatio > 1.15
          ? `Historique : ${Math.round((driverRatio - 1) * 100)}% plus lent que prévu en moyenne`
          : 'Faible risque prévu'

        results.push({
          missionId:    m.id,
          address:      m.address ?? '',
          driverId:     plan.driverId,
          driverName,
          risk,
          score:        Math.round(score * 100) / 100,
          reason,
          estArrivalMin: Math.round(arrivalMin),
          twCloseMin:   m.timeWindow?.closeMin ?? null,
        })
      }
    }

    results.sort((a, b) => b.score - a.score)

    log.info('P1 risk computed', { date: dateParam, count: results.length, high: results.filter(r => r.risk === 'high').length })

    return NextResponse.json({ date: dateParam, p1Risks: results })
  } catch (err) {
    log.error('P1 risk failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
