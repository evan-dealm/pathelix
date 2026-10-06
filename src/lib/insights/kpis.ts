import type { TenantDb } from '@/lib/tenantDb'

/**
 * Operations cockpit, from recorded facts only: tours as planned and as executed (field statuses),
 * weighings, invoices and payments, bins. Each figure says where it comes from; estimated
 * distances are reported apart from measured ones.
 */

export interface Kpis {
  from: string
  to: string
  missions: { planned: number; done: number; failed: number; notPlanned: number; completionPct: number | null }
  punctuality: { withWindow: number; onTime: number; pct: number | null }
  tours: { count: number; km: number; kmMeasured: number; hours: number; missionsPerTour: number | null }
  tonnage: { tonnes: number; tickets: number; pendingReview: number }
  bins: { total: number; atCustomers: number; utilisationPct: number | null; avgDaysOnSite: number | null }
  /** Money figures — only with the view_costs permission. */
  money?: { invoicedHT: number; collected: number; overdueTTC: number; unbilledDone: number }
}

type StatusEntry = { status?: string; arrivedAt?: string; doneAt?: string }

/** Minutes after local midnight of an ISO instant in the tenant's time zone. */
export function localMinutes(isoInstant: string, timeZone: string): number | null {
  const d = new Date(isoInstant)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const h = Number(parts.find(p => p.type === 'hour')?.value)
  const m = Number(parts.find(p => p.type === 'minute')?.value)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

export async function computeKpis(db: TenantDb, tenantId: string, from: string, to: string, withMoney: boolean): Promise<Kpis> {
  const [settings, plans, missions, weighings, containers] = await Promise.all([
    db.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }),
    db.plan.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true, missions: true, statuses: true, estimatedDistanceKm: true, actualDistanceKm: true, estimatedDurationMin: true, actualDurationMin: true } }),
    db.mission.findMany({ where: { date: { gte: from, lte: to }, archived: false }, select: { id: true, timeWindowCloseMin: true } }),
    db.weighing.findMany({ where: { weighedAt: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) }, status: { not: 'REJECTED' } }, select: { netKg: true, status: true } }),
    db.container.findMany({ where: { archived: false }, select: { status: true, placedAt: true } }),
  ])
  const tz = settings?.timezone || 'Europe/Paris'
  const windowClose = new Map(missions.map(m => [m.id, m.timeWindowCloseMin]))

  const plannedIds = new Set<string>()
  let done = 0; let failed = 0; let withWindow = 0; let onTime = 0
  let km = 0; let kmMeasured = 0; let minutes = 0
  for (const p of plans) {
    const steps = Array.isArray(p.missions) ? p.missions as Array<{ id?: string }> : []
    const statuses = (p.statuses && typeof p.statuses === 'object' ? p.statuses : {}) as Record<string, StatusEntry>
    for (const s of steps) {
      if (!s?.id || s.id.startsWith('_')) continue
      plannedIds.add(s.id)
      const st = statuses[s.id]
      if (st?.status === 'done') done++
      if (st?.status === 'failed') failed++
      const close = windowClose.get(s.id)
      if (close !== null && close !== undefined && st?.arrivedAt) {
        const arr = localMinutes(st.arrivedAt, tz)
        if (arr !== null) { withWindow++; if (arr <= close) onTime++ }
      }
    }
    if (p.actualDistanceKm) { km += p.actualDistanceKm; kmMeasured += p.actualDistanceKm } else km += p.estimatedDistanceKm ?? 0
    minutes += p.actualDurationMin ?? p.estimatedDurationMin ?? 0
  }
  const planned = plannedIds.size
  const atCustomers = containers.filter(c => c.status === 'AT_CUSTOMER' || c.status === 'FULL' || c.status === 'TO_COLLECT')
  const stays = atCustomers.filter(c => c.placedAt).map(c => (Date.now() - c.placedAt!.getTime()) / 86_400_000)
  const pct = (a: number, b: number) => (b > 0 ? Math.round(a / b * 1000) / 10 : null)

  const out: Kpis = {
    from, to,
    missions: { planned, done, failed, notPlanned: missions.filter(m => !plannedIds.has(m.id)).length, completionPct: pct(done, planned) },
    punctuality: { withWindow, onTime, pct: pct(onTime, withWindow) },
    tours: { count: plans.length, km: Math.round(km), kmMeasured: Math.round(kmMeasured), hours: Math.round(minutes / 6) / 10, missionsPerTour: plans.length ? Math.round(planned / plans.length * 10) / 10 : null },
    tonnage: { tonnes: Math.round(weighings.filter(w => w.status === 'VALIDATED').reduce((a, w) => a + w.netKg, 0) / 100) / 10, tickets: weighings.length, pendingReview: weighings.filter(w => w.status === 'PENDING_REVIEW').length },
    bins: { total: containers.length, atCustomers: atCustomers.length, utilisationPct: pct(atCustomers.length, containers.length), avgDaysOnSite: stays.length ? Math.round(stays.reduce((a, v) => a + v, 0) / stays.length) : null },
  }

  if (withMoney) {
    const today = new Date().toISOString().slice(0, 10)
    const [invoiced, collected, overdue, doneMissions] = await Promise.all([
      // Issued documents (numbered), credited invoices included — their credit notes net them out.
      db.invoice.aggregate({ where: { issueDate: { gte: from, lte: to }, number: { not: null } }, _sum: { totalHT: true } }),
      db.payment.aggregate({ where: { receivedAt: { gte: from, lte: to } }, _sum: { amount: true } }),
      db.invoice.findMany({ where: { kind: 'INVOICE', status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: today } }, select: { totalTTC: true, amountPaid: true } }),
      db.mission.findMany({ where: { date: { gte: from, lte: to }, completedAt: { not: null }, archived: false }, select: { id: true } }),
    ])
    const billed = doneMissions.length
      ? new Set((await db.invoiceLine.findMany({ where: { missionId: { in: doneMissions.map(m => m.id) }, invoice: { status: { notIn: ['CANCELLED'] } } }, select: { missionId: true } })).map(l => l.missionId))
      : new Set<string | null>()
    const r2 = (n: number) => Math.round(n * 100) / 100
    out.money = {
      invoicedHT: r2(invoiced._sum.totalHT ?? 0),
      collected: r2(collected._sum.amount ?? 0),
      overdueTTC: r2(overdue.reduce((a, i) => a + i.totalTTC - i.amountPaid, 0)),
      unbilledDone: doneMissions.filter(m => !billed.has(m.id)).length,
    }
  }
  return out
}

/** The period of the same length just before [from, to]. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = Date.parse(`${from}T12:00:00Z`); const t = Date.parse(`${to}T12:00:00Z`)
  const len = Math.round((t - f) / 86_400_000) + 1
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: day(f - len * 86_400_000), to: day(f - 86_400_000) }
}
