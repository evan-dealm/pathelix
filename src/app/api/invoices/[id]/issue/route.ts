import { apiRoute } from '@/lib/api/route'
import { issueInvoice } from '@/lib/sales/invoices'
import { emitBusinessEvent } from '@/lib/events/outbound'
import { archiveSalesPdf } from '@/lib/documents/archive'

/** Issues a draft: number, dates, legal snapshot. The PDF is archived when the PDF worker runs. */
export const POST = apiRoute({ name: '/api/invoices/[id]/issue', permission: 'manage_billing' }, async ({ db, tenantId, userId, params }) => {
  const inv = await issueInvoice(db, tenantId, params.id)
  void emitBusinessEvent(tenantId, 'invoice.issued', { invoiceId: inv.id, number: inv.number, kind: inv.kind, clientId: inv.clientId, totalTTC: inv.totalTTC, dueDate: inv.dueDate })
  void archiveSalesPdf(db, tenantId, userId, 'INVOICE', inv.id)
  return inv
})
