import { NextRequest, NextResponse }           from 'next/server'
import { unscopedPrisma, getTenantDb }         from '@/lib/tenantDb'
import { getRequestContext }                   from '@/lib/data/context'
import { generateMonthlyReportPdf }            from '@/lib/pdfReport'
import type { MonthlyReportData }              from '@/lib/pdfReport'
import { createLogger }                        from '@/lib/logger'

const log = createLogger('/api/reports/pdf')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const monthParam = req.nextUrl.searchParams.get('month')
    ?? new Date().toISOString().slice(0, 7)

  const [year, month] = monthParam.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Paramètre month invalide (YYYY-MM)' }, { status: 400 })
  }

  const startDate = new Date(year, month - 1, 1)
  const endDate   = new Date(year, month, 0, 23, 59, 59, 999)

  try {
    const db = getTenantDb(tenantId)
    const tenant = await unscopedPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    })

    const [missions, metrics, drivers] = await Promise.all([
      db.mission.findMany({
        where: { date: { gte: startDate.toISOString().slice(0, 10), lte: endDate.toISOString().slice(0, 10) } },
        select: { id: true, completedAt: true, cancelledAt: true, type: true },
      }),
      db.interventionMetric.findMany({
        where: { date: { gte: startDate.toISOString().slice(0, 10), lte: endDate.toISOString().slice(0, 10) } },
        select: { driverId: true, actualDurationMin: true, actualTravelMin: true, distanceKm: true, missionType: true },
      }),
      db.driver.findMany({
        where: { archived: false },
        select: { id: true, firstName: true, lastName: true },
      }),
    ])

    const driverMap = new Map(drivers.map(d => [d.id, `${d.firstName} ${d.lastName}`]))

    const driverStats = new Map<string, { missionCount: number; distanceKm: number; totalDurMin: number }>()
    for (const m of metrics) {
      const s = driverStats.get(m.driverId) ?? { missionCount: 0, distanceKm: 0, totalDurMin: 0 }
      s.missionCount  += 1
      s.distanceKm    += m.distanceKm        ?? 0
      s.totalDurMin   += m.actualDurationMin
      driverStats.set(m.driverId, s)
    }

    const topDrivers = [...driverStats.entries()]
      .sort((a, b) => b[1].missionCount - a[1].missionCount)
      .slice(0, 10)
      .map(([id, s]) => ({
        name:           driverMap.get(id) ?? id,
        missionCount:   s.missionCount,
        distanceKm:     s.distanceKm,
        avgDurationMin: s.missionCount > 0 ? s.totalDurMin / s.missionCount : 0,
      }))

    const totalMissions     = missions.length
    const completedMissions = missions.filter(m => m.completedAt !== null).length
    const cancelledMissions = missions.filter(m => m.cancelledAt !== null).length
    const totalDistanceKm   = metrics.reduce((acc, m) => acc + (m.distanceKm ?? 0), 0)
    const totalDurMin       = metrics.reduce((acc, m) => acc + m.actualDurationMin, 0)
    const avgMissionDurMin  = metrics.length > 0 ? totalDurMin / metrics.length : 0

    const totalFuelEur = totalDistanceKm * 0.35 * 1.80

    const typeCounts = new Map<string, number>()
    for (const m of missions) {
      typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1)
    }
    const missionsByType = [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        pct: totalMissions > 0 ? Math.round((count / totalMissions) * 100) : 0,
      }))

    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const monthCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)

    const data: MonthlyReportData = {
      tenantName:        tenant?.name ?? tenantId,
      month:             monthCapitalized,
      period:            `${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`,
      totalMissions,
      completedMissions,
      cancelledMissions,
      totalDistanceKm,
      totalFuelEur,
      avgMissionDurMin,
      topDrivers,
      missionsByType,
      generatedAt: new Date().toLocaleString('fr-FR'),
    }

    const buffer = await generateMonthlyReportPdf(data)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="rapport-${monthParam}.pdf"`,
        'Content-Length':      String(buffer.length),
        'Cache-Control':       'private, no-store',
      },
    })
  } catch (err) {
    log.error('PDF generation failed', { err: err instanceof Error ? err.stack ?? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur génération PDF' }, { status: 500 })
  }
}
