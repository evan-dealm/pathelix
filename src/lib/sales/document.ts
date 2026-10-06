import type { TenantDb } from '@/lib/tenantDb'
import { ApiError } from '@/lib/api/route'
import { computeTotals } from '@/lib/pricing/engine'
import { escapeHtml } from '@/lib/html'
import { commercialSettings } from './quotes'

export type SalesDocKind = 'QUOTE' | 'INVOICE' | 'CREDIT_NOTE' | 'ORDER'

export interface SalesDocumentData {
  kind:        SalesDocKind
  number:      string
  issueDate:   string
  dueDate?:    string | null
  validUntil?: string | null
  periodStart?: string | null
  periodEnd?:  string | null
  title?:      string
  company:     { name: string; legalName: string; address: string; siret: string; vatNumber: string; iban: string }
  client:      { name: string; address: string; siret: string }
  site?:       { name: string; address: string } | null
  lines:       Array<{ label: string; description: string; quantity: number; unit: string; unitPrice: number; discountPct: number; vatRate: number; amountHT: number }>
  totals:      { totalHT: number; totalTTC: number; vatByRate: Array<{ rate: number; base: number; vat: number }> }
  notes:       string
  terms:       string
  paymentTerms: string
  amountPaid?: number
  creditedNumber?: string | null
  draft:       boolean
}

export const KIND_TITLE: Record<SalesDocKind, string> = { QUOTE: 'Devis', INVOICE: 'Facture', CREDIT_NOTE: 'Avoir', ORDER: 'Bon de commande' }
const UNIT: Record<string, string> = { UNIT: '', DAY: 'j', TON: 't', KM: 'km', PCT: '', FLAT: '', HOUR: 'h', M3: 'm³' }

export const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const frDay = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '')
const qty = (n: number, unit: string) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${UNIT[unit] ? ` ${UNIT[unit]}` : ''}`

/** Everything a quote / invoice / credit note shows, from the database (tenant-scoped). */
export async function loadSalesDocument(db: TenantDb, tenantId: string, kind: 'QUOTE' | 'INVOICE', id: string): Promise<SalesDocumentData> {
  const s = await commercialSettings(db, tenantId)
  const tenant = await db.tenantSettings.findUnique({ where: { tenantId }, select: { companyDisplayName: true } })
  const company = {
    name: s.displayName || tenant?.companyDisplayName || s.companyLegalName, legalName: s.companyLegalName, address: s.companyAddress,
    siret: s.companySiret, vatNumber: s.vatNumber, iban: s.companyIban,
  }
  if (kind === 'QUOTE') {
    const q = await db.quote.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } }, client: true, site: { select: { name: true, address: true } } } })
    if (!q) throw new ApiError(404, 'Devis introuvable', 'NOT_FOUND')
    return {
      kind: 'QUOTE', number: q.number, issueDate: q.issueDate, validUntil: q.validUntil, title: q.title, company,
      client: { name: q.client.name, address: q.client.billingAddress, siret: q.client.siret }, site: q.site,
      lines: q.lines, totals: computeTotals(q.lines), notes: q.notes, terms: q.terms, paymentTerms: '', draft: q.status === 'DRAFT',
    }
  }
  const inv = await db.invoice.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } }, client: true, creditedInvoice: { select: { number: true } } } })
  if (!inv) throw new ApiError(404, 'Facture introuvable', 'NOT_FOUND')
  const draft = inv.status === 'DRAFT'
  return {
    kind: inv.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE', number: inv.number ?? 'BROUILLON', issueDate: inv.issueDate ?? '', dueDate: inv.dueDate,
    periodStart: inv.periodStart, periodEnd: inv.periodEnd, company,
    client: draft ? { name: inv.client.name, address: inv.client.billingAddress, siret: inv.client.siret } : { name: inv.clientName, address: inv.billingAddress, siret: inv.clientSiret },
    lines: inv.lines, totals: computeTotals(inv.lines), notes: inv.notes, terms: '',
    paymentTerms: s.latePaymentTerms, amountPaid: inv.amountPaid, creditedNumber: inv.creditedInvoice?.number ?? null, draft,
  }
}

/**
 * Printable HTML of a sales document (A4). Every value is escaped; no script — it is served
 * under the app's CSP and printed with the browser (or turned into a PDF by the PDF worker).
 */
export function renderSalesHtml(d: SalesDocumentData): string {
  const e = escapeHtml
  const rows = d.lines.map(l => `<tr>
    <td><div class="lbl">${e(l.label)}</div>${l.description ? `<div class="desc">${e(l.description)}</div>` : ''}</td>
    <td class="num">${e(qty(l.quantity, l.unit))}</td>
    <td class="num">${e(eur(l.unitPrice))}</td>
    <td class="num">${l.discountPct ? `${e(String(l.discountPct))} %` : ''}</td>
    <td class="num">${e(String(l.vatRate))} %</td>
    <td class="num">${e(eur(l.amountHT))}</td></tr>`).join('')
  const vat = d.totals.vatByRate.map(v => `<tr><td>TVA ${e(String(v.rate))} % sur ${e(eur(v.base))}</td><td class="num">${e(eur(v.vat))}</td></tr>`).join('')
  const balance = d.amountPaid !== undefined && d.amountPaid > 0 ? d.totals.totalTTC - d.amountPaid : null
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(KIND_TITLE[d.kind])} ${e(d.number)}</title><style>
  @page { size: A4; margin: 14mm }
  body { font: 10pt/1.45 Inter, system-ui, sans-serif; color: #1f2937; margin: 0 }
  .wrap { max-width: 186mm; margin: 0 auto; padding: 8mm 0 }
  header { display: flex; justify-content: space-between; gap: 12mm; border-bottom: 2px solid #0055A4; padding-bottom: 5mm }
  h1 { font: 600 20pt/1.1 Geist, Inter, sans-serif; color: #0055A4; margin: 0 }
  .muted { color: #6b7280 } .small { font-size: 8.5pt }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin: 6mm 0 }
  .box { border: 1px solid #e5e7eb; border-radius: 3mm; padding: 4mm }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 4mm }
  table.lines th { text-align: left; font-weight: 600; font-size: 8.5pt; color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 2mm 1.5mm }
  table.lines td { border-bottom: 1px solid #f1f5f9; padding: 2mm 1.5mm; vertical-align: top }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums }
  .lbl { font-weight: 500 } .desc { color: #6b7280; font-size: 8.5pt }
  .totals { margin-left: auto; width: 80mm; margin-top: 5mm } .totals td { padding: 1mm 0 }
  .grand td { font-weight: 700; font-size: 12pt; border-top: 1px solid #1f2937; padding-top: 2mm }
  .draft { color: #b45309; font-weight: 600 }
  footer { margin-top: 10mm; font-size: 8pt; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 3mm }
  </style></head><body><div class="wrap">
  <header>
    <div><div style="font-weight:600;font-size:12pt">${e(d.company.name || d.company.legalName)}</div>
      <div class="small muted">${e(d.company.address).replace(/\n/g, '<br>')}</div></div>
    <div style="text-align:right"><h1>${e(KIND_TITLE[d.kind])}</h1>
      <div style="font-weight:600">${e(d.number)}</div>
      ${d.draft ? '<div class="draft">Brouillon — sans valeur</div>' : ''}
      ${d.issueDate ? `<div class="small">Date : ${e(frDay(d.issueDate))}</div>` : ''}
      ${d.validUntil ? `<div class="small">Valable jusqu'au ${e(frDay(d.validUntil))}</div>` : ''}
      ${d.dueDate ? `<div class="small">Échéance : ${e(frDay(d.dueDate))}</div>` : ''}
      ${d.periodStart && d.periodEnd ? `<div class="small">Période : ${e(frDay(d.periodStart))} – ${e(frDay(d.periodEnd))}</div>` : ''}
      ${d.creditedNumber ? `<div class="small">Avoir sur la facture ${e(d.creditedNumber)}</div>` : ''}
    </div>
  </header>
  <section class="parties">
    <div>${d.title ? `<div style="font-weight:600">${e(d.title)}</div>` : ''}${d.site ? `<div class="small">Chantier : ${e(d.site.name)}${d.site.address ? `, ${e(d.site.address)}` : ''}</div>` : ''}</div>
    <div class="box"><div class="small muted">Client</div><div style="font-weight:600">${e(d.client.name)}</div>
      <div class="small">${e(d.client.address).replace(/\n/g, '<br>')}</div>${d.client.siret ? `<div class="small muted">SIRET ${e(d.client.siret)}</div>` : ''}</div>
  </section>
  <table class="lines"><thead><tr><th>Désignation</th><th class="num">Quantité</th><th class="num">Prix unitaire HT</th><th class="num">Remise</th><th class="num">TVA</th><th class="num">Total HT</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals"><tbody>
    <tr><td>Total HT</td><td class="num">${e(eur(d.totals.totalHT))}</td></tr>${vat}
    <tr class="grand"><td>Total TTC</td><td class="num">${e(eur(d.totals.totalTTC))}</td></tr>
    ${balance !== null ? `<tr><td>Déjà réglé</td><td class="num">${e(eur(d.amountPaid ?? 0))}</td></tr><tr><td><strong>Reste à payer</strong></td><td class="num"><strong>${e(eur(balance))}</strong></td></tr>` : ''}
  </tbody></table>
  ${d.notes ? `<p class="small">${e(d.notes).replace(/\n/g, '<br>')}</p>` : ''}
  ${d.terms ? `<p class="small muted">${e(d.terms).replace(/\n/g, '<br>')}</p>` : ''}
  ${d.kind === 'QUOTE' ? '<p class="small">Bon pour accord — date, nom et signature :</p>' : ''}
  <footer>
    ${d.kind !== 'QUOTE' && d.paymentTerms ? `<div>${e(d.paymentTerms)}</div>` : ''}
    ${d.company.iban && d.kind !== 'QUOTE' ? `<div>Règlement par virement : IBAN ${e(d.company.iban)}</div>` : ''}
    <div>${[d.company.legalName, d.company.siret ? `SIRET ${d.company.siret}` : '', d.company.vatNumber ? `TVA ${d.company.vatNumber}` : ''].filter(Boolean).map(e).join(' — ')}</div>
  </footer></div></body></html>`
}
