import { apiRoute } from '@/lib/api/route'
import { daysOnSite, isAtCustomer, isOutOfService, type ContainerStatus } from '@/lib/containers/lifecycle'

const WINDOW_DAYS = 90

/**
 * Fleet KPIs: availability per type, utilisation, time on site, rotations (exutoire dumps) over the
 * last 90 days, the bins that turn the least, and the customers holding the most equipment.
 */
export const GET = apiRoute({ name: '/api/containers/stats' }, async ({ db, req }) => {
  const longStayDays = Math.max(1, parseInt(req.nextUrl.searchParams.get('longStay') ?? '30', 10) || 30)
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const [containers, types, rotations] = await Promise.all([
    db.container.findMany({
      where: { archived: false },
      select: {
        id: true, number: true, status: true, typeId: true, placedAt: true, lastRotationAt: true, clientId: true,
        client: { select: { name: true } },
      },
    }),
    db.containerType.findMany({ where: { archived: false }, select: { id: true, name: true, capacityM3: true, dailyRentalPrice: true } }),
    db.containerEvent.groupBy({ by: ['containerId'], where: { type: 'EMPTIED', at: { gte: since } }, _count: { _all: true } }),
  ])
  const now = new Date()
  const rotByContainer = new Map(rotations.map(r => [r.containerId, r._count._all]))
  const typeById = new Map(types.map(t => [t.id, t]))

  const byStatus: Record<string, number> = {}
  const byType = new Map<string, { typeId: string; name: string; capacityM3: number; total: number; available: number; reserved: number; atCustomer: number; inTransit: number; outOfService: number }>()
  for (const t of types) byType.set(t.id, { typeId: t.id, name: t.name, capacityM3: t.capacityM3, total: 0, available: 0, reserved: 0, atCustomer: 0, inTransit: 0, outOfService: 0 })

  let inService = 0, inUse = 0, siteDaysSum = 0, atCustomerCount = 0, longStay = 0
  const clients = new Map<string, { clientId: string; name: string; containers: number; days: number; rentEstimate: number }>()
  for (const c of containers) {
    const s = c.status as ContainerStatus
    byStatus[s] = (byStatus[s] ?? 0) + 1
    const bt = byType.get(c.typeId)
    if (bt) {
      bt.total++
      if (s === 'AVAILABLE') bt.available++
      else if (s === 'RESERVED') bt.reserved++
      else if (s === 'IN_TRANSIT') bt.inTransit++
      else if (isAtCustomer(s)) bt.atCustomer++
      else if (isOutOfService(s) || s === 'AT_EXUTOIRE') bt.outOfService++
    }
    if (!isOutOfService(s)) inService++
    if (s === 'RESERVED' || s === 'IN_TRANSIT' || isAtCustomer(s)) inUse++
    if (isAtCustomer(s)) {
      const d = daysOnSite(c.placedAt, now) ?? 0
      atCustomerCount++
      siteDaysSum += d
      if (d >= longStayDays) longStay++
      if (c.clientId) {
        const e = clients.get(c.clientId) ?? { clientId: c.clientId, name: c.client?.name ?? '—', containers: 0, days: 0, rentEstimate: 0 }
        e.containers++
        e.days += d
        e.rentEstimate += d * (typeById.get(c.typeId)?.dailyRentalPrice ?? 0)
        clients.set(c.clientId, e)
      }
    }
  }

  const totalRotations = [...rotByContainer.values()].reduce((a, b) => a + b, 0)
  const leastRotated = containers
    .filter(c => !isOutOfService(c.status as ContainerStatus))
    .map(c => ({ id: c.id, number: c.number, status: c.status, rotations: rotByContainer.get(c.id) ?? 0, lastRotationAt: c.lastRotationAt, type: typeById.get(c.typeId)?.name ?? '' }))
    .sort((a, b) => a.rotations - b.rotations || (a.lastRotationAt?.getTime() ?? 0) - (b.lastRotationAt?.getTime() ?? 0))
    .slice(0, 10)

  return {
    total: containers.length,
    byStatus,
    byType: [...byType.values()].sort((a, b) => a.capacityM3 - b.capacityM3),
    utilisationPct: inService > 0 ? Math.round((inUse / inService) * 1000) / 10 : null,
    avgDaysOnSite: atCustomerCount > 0 ? Math.round((siteDaysSum / atCustomerCount) * 10) / 10 : null,
    longStay: { days: longStayDays, count: longStay },
    immobilized: (byStatus.IMMOBILIZED ?? 0) + (byStatus.MAINTENANCE ?? 0) + (byStatus.LOST ?? 0),
    rotations: {
      windowDays: WINDOW_DAYS,
      total: totalRotations,
      perContainer: inService > 0 ? Math.round((totalRotations / inService) * 100) / 100 : null,
    },
    leastRotated,
    topClients: [...clients.values()].sort((a, b) => b.days - a.days).slice(0, 10)
      .map(c => ({ ...c, rentEstimate: Math.round(c.rentEstimate * 100) / 100 })),
  }
})
