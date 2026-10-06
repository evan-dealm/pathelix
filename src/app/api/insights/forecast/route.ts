import { apiRoute } from '@/lib/api/route'
import { forecastVolume } from '@/lib/insights/forecast'
import { predictDemand } from '@/lib/demandPrediction'

/**
 * Expected missions per day for the next days (weekday averages, 80 % interval, measured past
 * error) and the sites whose usual rotation rhythm says they will call soon.
 */
export const GET = apiRoute({ name: '/api/insights/forecast', permission: 'view_reports' }, async ({ db, tenantId, req }) => {
  const days = Math.min(28, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 14))
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 16 * 7 * 86_400_000).toISOString().slice(0, 10)
  const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  const [past, future, recurrences] = await Promise.all([
    db.mission.groupBy({ by: ['date'], where: { date: { gte: since, lt: today } }, _count: { id: true } }),
    db.mission.groupBy({ by: ['date'], where: { date: { gte: today, lte: until }, archived: false }, _count: { id: true } }),
    predictDemand(tenantId, days),
  ])
  const forecast = forecastVolume(past.map(p => ({ date: p.date, count: p._count.id })), future.map(f => ({ date: f.date, count: f._count.id })), today, days)
  return { forecast, recurrences }
})
