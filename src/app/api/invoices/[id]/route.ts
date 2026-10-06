import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { InvoiceUpdateSchema } from '@/lib/sales/schemas'
import { balanceOf, effectiveInvoiceStatus, updateInvoiceDraft } from '@/lib/sales/invoices'

export const GET = apiRoute({ name: '/api/invoices/[id]', permission: 'manage_billing' }, async ({ db, params }) => {
  const inv = await db.invoice.findFirst({
    where: { id: params.id },
    include: {
      lines: { orderBy: { position: 'asc' } }, client: { select: { id: true, name: true, email: true } },
      payments: { orderBy: { receivedAt: 'asc' } }, creditNotes: { select: { id: true, number: true, status: true, totalTTC: true } },
      creditedInvoice: { select: { id: true, number: true } }, order: { select: { id: true, number: true } },
    },
  })
  if (!inv) throw notFound('Facture')
  return { ...inv, status: effectiveInvoiceStatus(inv), balance: balanceOf(inv) }
})

export const PUT = apiRoute({ name: '/api/invoices/[id]', permission: 'manage_billing', schema: InvoiceUpdateSchema }, async ({ db, tenantId, body, params }) => {
  return updateInvoiceDraft(db, tenantId, params.id, body)
})

/** Drafts only: an issued invoice is never deleted (French law) — it is cancelled by a credit note. */
export const DELETE = apiRoute({ name: '/api/invoices/[id]', permission: 'manage_billing' }, async ({ db, params }) => {
  const inv = await db.invoice.findFirst({ where: { id: params.id }, select: { id: true, status: true } })
  if (!inv) throw notFound('Facture')
  if (inv.status !== 'DRAFT') throw unprocessable('Une facture émise ne se supprime pas : faites un avoir', 'NOT_DRAFT')
  await db.invoice.delete({ where: { id: inv.id } })
  return { ok: true }
})
