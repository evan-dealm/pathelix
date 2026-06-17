import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/superadmin/stats')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const [
      totalTenants, totalUsers, totalDrivers, totalMissions, totalVehicles, totalPlans,
      recentMissions, recentPlans, recentUsers,
      tenantsByPlan, topTenants,
      suspendedTenants, totalExutoires, totalClients, totalSites,
      dailyMissions, dailyPlans,
      recentAudit,
    ] = await Promise.all([

      prisma.tenant.count(),
      prisma.user.count(),
      prisma.driver.count(),
      prisma.mission.count(),
      prisma.vehicle.count(),
      prisma.plan.count(),

      prisma.mission.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.plan.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),

      prisma.tenant.groupBy({ by: ['plan'], _count: true }),
      prisma.mission.groupBy({
        by: ['tenantId'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: true,
        orderBy: { _count: { tenantId: 'desc' } },
        take: 10,
      }),

      prisma.tenant.count({ where: { suspendedAt: { not: null } } }),
      prisma.exutoire.count(),
      prisma.client.count(),
      prisma.site.count(),

      prisma.mission.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: fourteenDaysAgo } },
        _count: true,
      }),
      prisma.plan.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: fourteenDaysAgo } },
        _count: true,
      }),

      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { tenant: { select: { name: true } } },
      }),
    ])

    const tenantIds = topTenants.map(t => t.tenantId)
    const tenantNames = tenantIds.length > 0
      ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true, plan: true } })
      : []
    const nameMap = new Map(tenantNames.map(t => [t.id, t]))

    const dailyActivity = buildDailyActivity(14, dailyMissions, dailyPlans)

    return NextResponse.json({
      global: { totalTenants, totalUsers, totalDrivers, totalMissions, totalVehicles, totalPlans },
      recent: { missions30d: recentMissions, plans30d: recentPlans, newUsers7d: recentUsers },
      tenantsByPlan: Object.fromEntries(tenantsByPlan.map(g => [g.plan, g._count])),
      topTenants: topTenants.map(t => ({ tenantId: t.tenantId, missions30d: t._count, ...nameMap.get(t.tenantId) })),
      dailyActivity,
      recentAudit: recentAudit.map(l => ({
        id: l.id, tenantName: l.tenant.name, userId: l.userId,
        action: l.action, entityType: l.entityType, entityId: l.entityId,
        createdAt: l.createdAt.toISOString(),
      })),
      suspendedTenants,
      totalExutoires,
      totalClients,
      totalSites,
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

function buildDailyActivity(
  days: number,
  missionRows: Array<{ createdAt: Date; _count: number }>,
  planRows: Array<{ createdAt: Date; _count: number }>,
) {

  const missionsByDay = new Map<string, number>()
  for (const row of missionRows) {
    const day = row.createdAt.toISOString().slice(0, 10)
    missionsByDay.set(day, (missionsByDay.get(day) ?? 0) + row._count)
  }
  const plansByDay = new Map<string, number>()
  for (const row of planRows) {
    const day = row.createdAt.toISOString().slice(0, 10)
    plansByDay.set(day, (plansByDay.get(day) ?? 0) + row._count)
  }

  const result: Array<{ date: string; missions: number; plans: number }> = []
  for (let d = days - 1; d >= 0; d--) {
    const dt = new Date()
    dt.setDate(dt.getDate() - d)
    const key = dt.toISOString().slice(0, 10)
    result.push({ date: key, missions: missionsByDay.get(key) ?? 0, plans: plansByDay.get(key) ?? 0 })
  }
  return result
}
