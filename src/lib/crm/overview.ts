import type { TenantDb } from '@/lib/tenantDb'
import { ApiError } from '@/lib/api/route'
import { balanceOf, effectiveInvoiceStatus } from '@/lib/sales/invoices'
import { effectiveQuoteStatus } from '@/lib/sales/quotes'
import { daysOnSite } from '@/lib/containers/lifecycle'
import { round2 } from '@/lib/pricing/engine'

export type TimelineKind = 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'QUOTE' | 'ORDER' | 'MISSION' | 'PROOF' | 'WEIGHING' | 'INVOICE' | 'PAYMENT' | 'CONTAINER' | 'REQUEST'

export interface TimelineItem {
  at:     string
  kind:   TimelineKind
  title:  string
  detail: string
  ref?:   { type: string; id: string }
}

/**
 * Everything about one customer in one place: identity, contacts, sites, bins on site, contracts,
 * money (revenue, outstanding, overdue) and a single timeline — call → quote → order → mission →
 * proof → weighing → invoice → payment. `withFinance` hides amounts from users without billing rights.
 */
export async function customerOverview(db: TenantDb, clientId: string, opts: { withFinance: boolean; timelineLimit?: number }) {
  const client = await db.client.findFirst({
    where: { id: clientId },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      clientSites: { include: { site: { select: { id: true, name: true, address: true, city: true, zipCode: true, accessNotes: true, latitude: true, longitude: true, openingHoursOpen: true, openingHoursClose: true } } } },
    },
  })
  if (!client) throw new ApiError(404, 'Client introuvable', 'NOT_FOUND')
  const limit = opts.timelineLimit ?? 150
  const yearAgo = new Date(Date.now() - 365 * 86_400_000)

  const [notes, quotes, orders, missions, weighings, invoices, payments, containers, contracts, docs] = await Promise.all([
    db.customerNote.findMany({ where: { clientId }, orderBy: { at: 'desc' }, take: limit }),
    db.quote.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, number: true, status: true, validUntil: true, totalHT: true, createdAt: true, sentAt: true, decidedAt: true, title: true } }),
    db.order.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, number: true, status: true, title: true, createdAt: true, totalHT: true } }),
    db.mission.findMany({ where: { clientId, archived: false }, orderBy: { date: 'desc' }, take: limit, select: { id: true, type: true, date: true, completedAt: true, address: true, incidentAt: true, incidentType: true, proof: { select: { capturedAt: true } } } }),
    db.weighing.findMany({ where: { clientId, status: { not: 'REJECTED' } }, orderBy: { weighedAt: 'desc' }, take: limit, select: { id: true, netKg: true, weighedAt: true, ticketNumber: true, status: true } }),
    opts.withFinance ? db.invoice.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, number: true, kind: true, status: true, issueDate: true, dueDate: true, totalTTC: true, totalHT: true, amountPaid: true, createdAt: true } }) : [],
    opts.withFinance ? db.payment.findMany({ where: { clientId }, orderBy: { receivedAt: 'desc' }, take: limit, select: { id: true, amount: true, receivedAt: true, method: true, reference: true, createdAt: true } }) : [],
    db.container.findMany({ where: { clientId, status: { in: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'] } }, select: { id: true, number: true, status: true, placedAt: true, type: { select: { name: true } }, site: { select: { name: true } } } }),
    db.contract.findMany({ where: { clientId }, orderBy: { startDate: 'desc' }, select: { id: true, number: true, status: true, startDate: true, endDate: true, title: true } }),
    db.document.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, kind: true, filename: true, createdAt: true, visibleToClient: true } }),
  ])

  const timeline: TimelineItem[] = []
  const NOTE_KIND: Record<string, TimelineKind> = { NOTE: 'NOTE', CALL: 'CALL', EMAIL: 'EMAIL', MEETING: 'MEETING' }
  for (const n of notes) timeline.push({ at: n.at.toISOString(), kind: NOTE_KIND[n.kind] ?? 'NOTE', title: { NOTE: 'Note', CALL: 'Appel', EMAIL: 'E-mail', MEETING: 'Rendez-vous' }[n.kind] ?? 'Note', detail: n.content })
  for (const q of quotes) {
    timeline.push({ at: q.createdAt.toISOString(), kind: 'QUOTE', title: `Devis ${q.number} — ${effectiveQuoteStatus(q).toLowerCase()}`, detail: `${q.title ? `${q.title} · ` : ''}${round2(q.totalHT)} € HT`, ref: { type: 'quote', id: q.id } })
  }
  for (const o of orders) timeline.push({ at: o.createdAt.toISOString(), kind: 'ORDER', title: `Commande ${o.number}`, detail: o.title, ref: { type: 'order', id: o.id } })
  for (const m of missions) {
    const at = m.completedAt?.toISOString() ?? `${m.date}T08:00:00.000Z`
    timeline.push({ at, kind: 'MISSION', title: `${m.type.toLowerCase()} ${m.completedAt ? 'réalisée' : 'prévue'} le ${m.date.split('-').reverse().join('/')}`, detail: m.incidentAt ? `Incident : ${m.incidentType}` : m.address, ref: { type: 'mission', id: m.id } })
    if (m.proof) timeline.push({ at: m.proof.capturedAt.toISOString(), kind: 'PROOF', title: 'Preuve de passage', detail: m.address, ref: { type: 'mission', id: m.id } })
  }
  for (const w of weighings) timeline.push({ at: w.weighedAt.toISOString(), kind: 'WEIGHING', title: `Pesée ${(w.netKg / 1000).toLocaleString('fr-FR')} t`, detail: w.status === 'PENDING_REVIEW' ? 'À vérifier' : w.ticketNumber ? `Ticket ${w.ticketNumber}` : '' })
  for (const i of invoices) timeline.push({ at: i.createdAt.toISOString(), kind: 'INVOICE', title: `${i.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'} ${i.number ?? '(brouillon)'} — ${effectiveInvoiceStatus(i).toLowerCase()}`, detail: `${round2(i.totalTTC)} € TTC`, ref: { type: 'invoice', id: i.id } })
  for (const p of payments) timeline.push({ at: `${p.receivedAt}T12:00:00.000Z`, kind: 'PAYMENT', title: `Règlement ${round2(p.amount)} €`, detail: [p.method.toLowerCase(), p.reference].filter(Boolean).join(' · ') })
  timeline.sort((a, b) => b.at.localeCompare(a.at))

  const finance = opts.withFinance ? (() => {
    const issued = invoices.filter(i => i.status !== 'DRAFT' && i.status !== 'CANCELLED')
    const revenue12m = issued.filter(i => i.issueDate && new Date(i.issueDate) >= yearAgo).reduce((a, i) => a + i.totalHT, 0)
    const open = issued.filter(i => i.kind === 'INVOICE' && ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(i.status))
    const today = new Date().toISOString().slice(0, 10)
    return {
      revenue12mHT: round2(revenue12m),
      outstanding: round2(open.reduce((a, i) => a + balanceOf(i), 0)),
      overdue: round2(open.filter(i => i.dueDate && i.dueDate < today).reduce((a, i) => a + balanceOf(i), 0)),
      paymentTermsDays: client.paymentTermsDays,
    }
  })() : null

  const done = missions.filter(m => m.completedAt).length
  return {
    client,
    sites: client.clientSites.map(cs => cs.site),
    contacts: client.contacts,
    containers: containers.map(c => ({ ...c, daysOnSite: daysOnSite(c.placedAt) })),
    contracts,
    documents: docs,
    stats: {
      missionsDone: done,
      missionsPlanned: missions.length - done,
      incidents: missions.filter(m => m.incidentAt).length,
      tonnage: round2(weighings.filter(w => w.status === 'VALIDATED').reduce((a, w) => a + w.netKg, 0) / 1000),
      quotesOpen: quotes.filter(q => effectiveQuoteStatus(q) === 'SENT').length,
    },
    finance,
    timeline: timeline.slice(0, limit),
  }
}
