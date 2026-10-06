import type { TenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { mailFailureMessage, sendMail, type MailAttachment } from '@/lib/mailer'
import { KIND_TITLE, eur, loadSalesDocument, renderSalesHtml, type SalesDocumentData } from './document'

const log = createLogger('sales-delivery')

/**
 * PDF of a sales document through the PDF worker; null when the worker is not running (the caller
 * then offers the printable HTML version instead).
 */
export async function salesPdf(tenantId: string, data: SalesDocumentData): Promise<Buffer | null> {
  try {
    const { generatePdfViaWorker } = await import('@/lib/queue/pdfQueue')
    return await generatePdfViaWorker({ kind: 'sales', tenantId, data }, 15_000)
  } catch (err) {
    log.warn('Sales PDF unavailable', { err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Recipient of a customer's documents: the given address, else the invoicing contact, else the customer e-mail. */
async function recipientFor(db: TenantDb, clientId: string, explicit?: string): Promise<string | null> {
  if (explicit) return explicit
  const contact = await db.clientContact.findFirst({ where: { clientId, receivesInvoices: true, email: { not: '' } }, select: { email: true } })
  if (contact) return contact.email
  const client = await db.client.findFirst({ where: { id: clientId }, select: { email: true } })
  return client?.email || null
}

/** E-mails a quote or invoice to the customer, PDF attached (HTML when the PDF worker is down). */
export async function deliverSalesDocument(db: TenantDb, tenantId: string, kind: 'QUOTE' | 'INVOICE', id: string, email?: string, message?: string): Promise<{ sent: boolean; message: string }> {
  const data = await loadSalesDocument(db, tenantId, kind, id)
  const clientId = kind === 'QUOTE'
    ? (await db.quote.findFirst({ where: { id }, select: { clientId: true } }))?.clientId
    : (await db.invoice.findFirst({ where: { id }, select: { clientId: true } }))?.clientId
  const to = clientId ? await recipientFor(db, clientId, email) : null
  if (!to) return { sent: false, message: 'Aucune adresse e-mail pour ce client : renseignez-la ou téléchargez le document.' }
  const pdf = await salesPdf(tenantId, data)
  const title = `${KIND_TITLE[data.kind]} ${data.number}`
  const attachment: MailAttachment = pdf
    ? { filename: `${data.number}.pdf`, content: pdf, contentType: 'application/pdf' }
    : { filename: `${data.number}.html`, content: Buffer.from(renderSalesHtml(data), 'utf8'), contentType: 'text/html' }
  const from = data.company.name || data.company.legalName || 'Pathélix'
  const text = [
    message?.trim() || `Bonjour,\n\nVeuillez trouver ci-joint ${data.kind === 'QUOTE' ? 'notre devis' : data.kind === 'CREDIT_NOTE' ? 'notre avoir' : 'notre facture'} ${data.number} d'un montant de ${eur(data.totals.totalTTC)} TTC.`,
    data.validUntil ? `Ce devis est valable jusqu'au ${data.validUntil.split('-').reverse().join('/')}.` : '',
    data.dueDate ? `Échéance : ${data.dueDate.split('-').reverse().join('/')}.` : '',
    `\nCordialement,\n${from}`,
  ].filter(Boolean).join('\n')
  const r = await sendMail({ to, subject: `${title} — ${from}`, text, attachments: [attachment] })
  if (!r.sent) return { sent: false, message: mailFailureMessage(r) }
  if (kind === 'INVOICE') {
    const inv = await db.invoice.findFirst({ where: { id }, select: { status: true } })
    await db.invoice.update({ where: { id }, data: { sentAt: new Date(), ...(inv?.status === 'ISSUED' ? { status: 'SENT' } : {}) } })
  }
  return { sent: true, message: `Envoyé à ${to}` }
}
