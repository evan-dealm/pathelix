import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'

const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  if (USE_MOCK) {
    return NextResponse.json({ licenseAlerts: [], hoursAlerts: [] })
  }

  try {
    const now   = new Date()
    const in90  = new Date(now.getTime() + 90 * 86_400_000)

    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    const mondayStr = monday.toISOString().slice(0, 10)
    const sundayStr = sunday.toISOString().slice(0, 10)

    const db = getTenantDb(tenantId)
    const [driversWithExpiry, plans] = await Promise.all([
      db.driver.findMany({
        where:  { archived: false, licenseExpiry: { not: null, lte: in90 } },
        select: { id: true, firstName: true, lastName: true, licenseExpiry: true },
      }),
      db.plan.findMany({
        where: { date: { gte: mondayStr, lte: sundayStr } },
        select: {
          driverId: true,
          missions: true,
          driver:   { select: { id: true, firstName: true, lastName: true, weeklyHoursMax: true } },
        },
      }),
    ])

    const licenseAlerts = driversWithExpiry.map(d => {
      const expiry   = d.licenseExpiry as Date
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
      return {
        driverId: d.id,
        name:     `${d.firstName} ${d.lastName}`,
        expiry:   expiry.toISOString().slice(0, 10),
        daysLeft,
        level:    daysLeft <= 0 ? 'expired' : daysLeft <= 14 ? 'urgent' : daysLeft <= 30 ? 'warning' : 'info',
      }
    }).sort((a, b) => a.daysLeft - b.daysLeft)

    const hoursMap = new Map<string, { driver: typeof plans[0]['driver']; totalMin: number }>()
    for (const plan of plans) {
      const missions = plan.missions as Array<{ estimatedDurationMin?: number; maneuverTimeMin?: number; travelTimeMin?: number; isSynthetic?: boolean }>
      if (!Array.isArray(missions)) continue
      let min = hoursMap.get(plan.driverId)?.totalMin ?? 0
      for (const m of missions) {
        if (m.isSynthetic) continue
        min += (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0) + (m.travelTimeMin ?? 0)
      }
      hoursMap.set(plan.driverId, { driver: plan.driver, totalMin: min })
    }

    const hoursAlerts = Array.from(hoursMap.values())
      .filter(({ driver, totalMin }) => {
        const maxMin = (driver.weeklyHoursMax ?? 48) * 60
        return totalMin > maxMin * 0.9
      })
      .map(({ driver, totalMin }) => {
        const maxMin    = (driver.weeklyHoursMax ?? 48) * 60
        const pct       = Math.round((totalMin / maxMin) * 100)
        return {
          driverId:   driver.id,
          name:       `${driver.firstName} ${driver.lastName}`,
          totalHours: Math.round(totalMin / 6) / 10,
          maxHours:   driver.weeklyHoursMax ?? 48,
          pct,
          level:      totalMin > maxMin ? 'exceeded' : 'warning',
        }
      })
      .sort((a, b) => b.pct - a.pct)

    return NextResponse.json({ licenseAlerts, hoursAlerts })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
