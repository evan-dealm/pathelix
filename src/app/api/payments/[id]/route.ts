import { z } from 'zod'
import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { refreshPaymentStatus } from '@/lib/sales/invoices'

const AllocateSchema = z.object({ invoiceId: z.string().nullable() })

/** Matches (or unmatches) a payment with an invoice of the same customer — manual reconciliation. */
export const PUT = apiRoute({ name: '/api/payments/[id]', permission: 'manage_billing', schema: AllocateSchema }, async ({ db, body, params }) => {
  const p = await db.payment.findFirst({ where: { id: params.id }, select: { id: true, clientId: true, invoiceId: true } })
  if (!p) throw notFound('Paiement')
  if (body.invoiceId) {
    const inv = await db.invoice.findFirst({ where: { id: body.invoiceId }, select: { clientId: true, status: true, kind: true } })
    if (!inv || inv.clientId !== p.clientId) throw unprocessable('Cette facture n\'est pas celle de ce client', 'CLIENT_MISMATCH')
    if (inv.status === 'DRAFT' || inv.status === 'CANCELLED' || inv.kind !== 'INVOICE') throw unprocessable('Paiement possible sur une facture émise uniquement', 'NOT_PAYABLE')
  }
  return db.$transaction(async tx => {
    const updated = await tx.payment.update({ where: { id: p.id }, data: { invoiceId: body.invoiceId } })
    if (p.invoiceId) await refreshPaymentStatus(tx, p.invoiceId)
    if (body.invoiceId) await refreshPaymentStatus(tx, body.invoiceId)
    return updated
  })
})

/** Removes a payment recorded by mistake; the invoice balance is recomputed. */
export const DELETE = apiRoute({ name: '/api/payments/[id]', permission: 'manage_billing' }, async ({ db, params }) => {
  const p = await db.payment.findFirst({ where: { id: params.id }, select: { id: true, invoiceId: true } })
  if (!p) throw notFound('Paiement')
  await db.$transaction(async tx => {
    await tx.payment.delete({ where: { id: p.id } })
    if (p.invoiceId) await refreshPaymentStatus(tx, p.invoiceId)
  })
  return { ok: true }
})
