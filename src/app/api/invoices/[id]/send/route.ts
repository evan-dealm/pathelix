import { SendDocumentSchema } from '@/lib/sales/schemas'
import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { deliverSalesDocument } from '@/lib/sales/delivery'
import { emitBusinessEvent } from '@/lib/events/outbound'

/** E-mails an issued invoice (PDF attached) — or only marks it as sent (posted, handed over…). */
export const POST = apiRoute({ name: '/api/invoices/[id]/send', permission: 'manage_billing', schema: SendDocumentSchema }, async ({ db, tenantId, body, params }) => {
  const inv = await db.invoice.findFirst({ where: { id: params.id }, select: { id: true, status: true, number: true } })
  if (!inv) throw notFound('Facture')
  if (inv.status === 'DRAFT') throw unprocessable('Émettez la facture avant de l\'envoyer', 'NOT_ISSUED')
  if (body.markOnly) {
    await db.invoice.update({ where: { id: inv.id }, data: { sentAt: new Date(), ...(inv.status === 'ISSUED' ? { status: 'SENT' } : {}) } })
    void emitBusinessEvent(tenantId, 'invoice.sent', { invoiceId: inv.id, number: inv.number })
    return { sent: true, message: 'Marquée comme envoyée' }
  }
  const r = await deliverSalesDocument(db, tenantId, 'INVOICE', inv.id, body.email, body.message)
  if (r.sent) void emitBusinessEvent(tenantId, 'invoice.sent', { invoiceId: inv.id, number: inv.number })
  return r
})
