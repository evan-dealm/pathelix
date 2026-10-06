import { apiRoute } from '@/lib/api/route'
import { groupProfits, type GroupKey } from '@/lib/insights/profitability'
import { loadProfitability } from '@/lib/insights/load'
import { periodFrom } from '@/lib/insights/period'

const GROUPS: GroupKey[] = ['client', 'driver', 'vehicle', 'type', 'day']

/** Margin by customer / driver / truck / mission type / day, with the least profitable missions. */
export const GET = apiRoute({ name: '/api/insights/profitability', permission: 'view_costs' }, async ({ db, tenantId, req }) => {
  const sp = req.nextUrl.searchParams
  const { from, to } = periodFrom(sp)
  const by = (GROUPS as string[]).includes(sp.get('by') ?? '') ? sp.get('by') as GroupKey : 'client'
  const data = await loadProfitability(db, tenantId, from, to)
  const label = (key: string) => by === 'client' ? (data.names.clients[key] ?? key.replace(/^nom:/, ''))
    : by === 'driver' ? (data.names.drivers[key] ?? key) : by === 'vehicle' ? (data.names.vehicles[key] ?? 'Sans camion') : key
  const totals = data.rows.reduce((a, r) => ({ revenueHT: a.revenueHT + r.revenueHT, cost: a.cost + r.cost, margin: a.margin + r.margin, missions: a.missions + 1 }), { revenueHT: 0, cost: 0, margin: 0, missions: 0 })
  return {
    from, to, by, rates: data.rates, gaps: data.gaps,
    totals: { ...totals, revenueHT: Math.round(totals.revenueHT * 100) / 100, cost: Math.round(totals.cost * 100) / 100, margin: Math.round(totals.margin * 100) / 100 },
    groups: groupProfits(data.rows, by).map(g => ({ ...g, label: label(g.key) })),
    worst: data.rows.filter(r => r.invoiced).sort((a, b) => a.margin - b.margin).slice(0, 10)
      .map(r => ({ ...r, clientName: r.clientId ? (data.names.clients[r.clientId] ?? r.clientName) : r.clientName, driver: data.names.drivers[r.driverId] ?? '' })),
  }
})
