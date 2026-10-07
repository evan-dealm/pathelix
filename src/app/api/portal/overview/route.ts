import { portalRoute } from '@/lib/portal/route'
import { daysOnSite } from '@/lib/containers/lifecycle'
import { balanceOf, effectiveInvoiceStatus } from '@/lib/sales/invoices'
import { effectiveQuoteStatus } from '@/lib/sales/quotes'
import { isoDay, addDaysIso } from '@/lib/sales/lines'

const TYPE: Record<string, string> = { POSER: 'Pose', RETIRER: 'Retrait', ECHANGER: 'Échange', ALLER_RETOUR: 'Rotation', CHARGER_IMMEDIAT: 'Chargement', DEPLACER: 'Déplacement', TASSER: 'Tassage', EXPEDIER: 'Expédition' }

/**
 * Everything the customer sees in the portal — always filtered on their own company: bins on
 * site, upcoming and past interventions (with proof), quotes to answer, invoices, documents,
 * their requests. Internal notes, prices of other customers, drivers' names stay out.
 */
export const GET = portalRoute({ name: '/api/portal/overview' }, async ({ db, session, user }) => {
  const clientId = session.clientId
  const today = isoDay()
  const [client, company, containers, upcoming, past, quotes, invoices, documents, requests, sites, weighings] = await Promise.all([
    db.client.findFirst({ where: { id: clientId }, select: { name: true } }),
    db.tenantSettings.findUnique({ where: { tenantId: session.tenantId }, select: { companyDisplayName: true, supportEmail: true, primaryColor: true } }),
    db.container.findMany({ where: { clientId, status: { in: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'] } }, select: { id: true, number: true, status: true, placedAt: true, type: { select: { name: true, capacityM3: true } }, site: { select: { id: true, name: true } } } }),
    db.mission.findMany({ where: { clientId, archived: false, completedAt: null, date: { gte: today, lte: addDaysIso(today, 60) } }, select: { id: true, type: true, date: true, address: true, timeWindowOpenMin: true, timeWindowCloseMin: true, trackingToken: true }, orderBy: { date: 'asc' }, take: 50 }),
    db.mission.findMany({ where: { clientId, archived: false, completedAt: { not: null } }, select: { id: true, type: true, date: true, address: true, completedAt: true, proof: { select: { photoUrl: true, signatureUrl: true } } }, orderBy: { completedAt: 'desc' }, take: 50 }),
    db.quote.findMany({ where: { clientId, status: { in: ['SENT', 'ACCEPTED', 'REFUSED', 'CONVERTED', 'EXPIRED'] } }, select: { id: true, number: true, status: true, title: true, validUntil: true, totalHT: true, totalTTC: true, issueDate: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.invoice.findMany({ where: { clientId, status: { not: 'DRAFT' } }, select: { id: true, number: true, kind: true, status: true, issueDate: true, dueDate: true, totalTTC: true, amountPaid: true, creditedTTC: true }, orderBy: { issueDate: 'desc' }, take: 50 }),
    db.document.findMany({ where: { clientId, visibleToClient: true }, select: { id: true, kind: true, filename: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.portalRequest.findMany({ where: { clientId }, select: { id: true, kind: true, status: true, preferredDate: true, message: true, response: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.site.findMany({ where: { clientSites: { some: { clientId } }, archived: false }, select: { id: true, name: true, address: true } }),
    db.weighing.findMany({ where: { clientId, status: 'VALIDATED' }, select: { id: true, netKg: true, weighedAt: true, ticketNumber: true }, orderBy: { weighedAt: 'desc' }, take: 30 }),
  ])
  return {
    me: { name: user.name, email: user.email },
    client: client?.name ?? '',
    company: { name: company?.companyDisplayName ?? '', supportEmail: company?.supportEmail ?? '' },
    sites,
    containers: containers.map(c => ({ ...c, daysOnSite: daysOnSite(c.placedAt) })),
    upcoming: upcoming.map(m => ({ id: m.id, label: TYPE[m.type] ?? m.type, date: m.date, address: m.address, window: m.timeWindowOpenMin !== null && m.timeWindowCloseMin !== null ? [m.timeWindowOpenMin, m.timeWindowCloseMin] : null, trackingToken: m.date === today ? m.trackingToken : null })),
    past: past.map(m => ({ id: m.id, label: TYPE[m.type] ?? m.type, date: m.date, address: m.address, completedAt: m.completedAt, hasPhoto: !!m.proof?.photoUrl, hasSignature: !!m.proof?.signatureUrl })),
    quotes: quotes.map(q => ({ ...q, status: effectiveQuoteStatus(q, today) })),
    invoices: invoices.map(i => ({ ...i, status: effectiveInvoiceStatus(i, today), balance: i.kind === 'INVOICE' ? balanceOf(i) : 0 })),
    weighings,
    documents,
    requests,
  }
})
