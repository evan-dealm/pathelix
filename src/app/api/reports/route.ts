import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const period = req.nextUrl.searchParams.get('period') ?? 'month'
  const refDate = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const ref = new Date(refDate + 'T12:00:00Z')
  let startDate: Date
  let prevStartDate: Date
  let prevEndDate: Date

  if (period === 'week') {
    const dow = ref.getDay() || 7
    startDate = new Date(ref); startDate.setDate(ref.getDate() - dow + 1); startDate.setHours(0, 0, 0, 0)
    prevStartDate = new Date(startDate); prevStartDate.setDate(prevStartDate.getDate() - 7)
    prevEndDate = new Date(startDate); prevEndDate.setMilliseconds(-1)
  } else if (period === 'quarter') {
    const qMonth = Math.floor(ref.getMonth() / 3) * 3
    startDate = new Date(ref.getFullYear(), qMonth, 1)
    prevStartDate = new Date(ref.getFullYear(), qMonth - 3, 1)
    prevEndDate = new Date(startDate); prevEndDate.setMilliseconds(-1)
  } else {
    startDate = new Date(ref.getFullYear(), ref.getMonth(), 1)
    prevStartDate = new Date(ref.getFullYear(), ref.getMonth() - 1, 1)
    prevEndDate = new Date(startDate); prevEndDate.setMilliseconds(-1)
  }

  const endDate = new Date()
  const dateStr = (d: Date) => d.toISOString().slice(0, 10)

  try {

    const [
      missionsCurrent, missionsPrev,
      plansCurrent, plansPrev,
      driverCount, vehicleCount, exutoireCount,
    ] = await Promise.all([
      prisma.mission.count({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } }),
      prisma.mission.count({ where: { tenantId, createdAt: { gte: prevStartDate, lte: prevEndDate } } }),
      prisma.plan.count({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } }),
      prisma.plan.count({ where: { tenantId, createdAt: { gte: prevStartDate, lte: prevEndDate } } }),
      prisma.driver.count({ where: { tenantId, archived: false } }),
      prisma.vehicle.count({ where: { tenantId } }),
      prisma.exutoire.count({ where: { tenantId } }),
    ])

    const [
      missionsByType, missionsByPriority,
      missionsByDay, plansByDay,
      topClients, byWasteType,
    ] = await Promise.all([
      prisma.mission.groupBy({
        by: ['type'],
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _count: true,
      }),
      prisma.mission.groupBy({
        by: ['priority'],
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _count: true,
      }),
      prisma.mission.groupBy({
        by: ['date'],
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _count: true,
      }),
      prisma.plan.groupBy({
        by: ['date'],
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _count: true,
      }),
      prisma.mission.groupBy({
        by: ['clientName'],
        where: { tenantId, createdAt: { gte: startDate, lte: endDate }, clientName: { not: null } },
        _count: true,
        orderBy: { _count: { clientName: 'desc' } },
        take: 10,
      }),
      prisma.mission.groupBy({
        by: ['wasteTypeLabel'],
        where: { tenantId, createdAt: { gte: startDate, lte: endDate }, wasteTypeLabel: { not: null } },
        _count: true,
        orderBy: { _count: { wasteTypeLabel: 'desc' } },
        take: 10,
      }),
    ])

    const missionDayMap = new Map(missionsByDay.map(g => [g.date, g._count]))
    const planDayMap    = new Map(plansByDay.map(g => [g.date, g._count]))

    const dailyActivity: Array<{ date: string; missions: number; plans: number }> = []
    const cursor = new Date(startDate)
    while (cursor <= endDate && dailyActivity.length < 90) {
      const d = dateStr(cursor)
      dailyActivity.push({ date: d, missions: missionDayMap.get(d) ?? 0, plans: planDayMap.get(d) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }

    return NextResponse.json({
      period,
      startDate: dateStr(startDate),
      endDate: dateStr(endDate),
      kpis: {
        missions: { current: missionsCurrent, previous: missionsPrev, change: missionsPrev > 0 ? Math.round(((missionsCurrent - missionsPrev) / missionsPrev) * 100) : 0 },
        optimizations: { current: plansCurrent, previous: plansPrev, change: plansPrev > 0 ? Math.round(((plansCurrent - plansPrev) / plansPrev) * 100) : 0 },
        drivers: driverCount,
        vehicles: vehicleCount,
        exutoires: exutoireCount,
      },
      missionsByType: Object.fromEntries(missionsByType.map(g => [g.type, g._count])),
      missionsByPriority: Object.fromEntries(missionsByPriority.map(g => [g.priority ?? 3, g._count])),
      dailyActivity,
      topClients: topClients.map(c => ({ name: c.clientName, count: c._count })),
      byWasteType: byWasteType.map(w => ({ type: w.wasteTypeLabel, count: w._count })),
    }, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
