import { apiRoute } from '@/lib/api/route'
import { hasPermission } from '@/lib/permissions'
import { computeKpis, previousPeriod } from '@/lib/insights/kpis'
import { periodFrom } from '@/lib/insights/period'

/** Operations cockpit for a period, with the previous period of the same length to compare. */
export const GET = apiRoute({ name: '/api/insights/kpis', permission: 'view_reports' }, async ({ db, tenantId, userId, role, req }) => {
  const { from, to } = periodFrom(req.nextUrl.searchParams)
  const money = await hasPermission(userId, role, 'view_costs')
  const prev = previousPeriod(from, to)
  const [current, previous] = await Promise.all([computeKpis(db, tenantId, from, to, money), computeKpis(db, tenantId, prev.from, prev.to, money)])
  return { current, previous }
})
