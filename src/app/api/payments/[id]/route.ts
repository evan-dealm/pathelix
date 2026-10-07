import { PaymentAllocateSchema } from '@/lib/sales/schemas'
import { apiRoute, notFound } from '@/lib/api/route'
import { assertPayable, refreshPaymentStatus } from '@/lib/sales/invoices'

/** Matches (or unmatches) a payment with an invoice of the same customer — manual reconciliation. */
export const PUT = apiRoute({ name: '/api/payments/[id]', permission: 'manage_billing', schema: PaymentAllocateSchema }, async ({ db, body, params }) => {
  const p = await db.payment.findFirst({ where: { id: params.id }, select: { id: true, clientId: true, invoiceId: true, amount: true } })
  if (!p) throw notFound('Paiement')
  return db.$transaction(async tx => {
    // Same rule as a new payment: never more than what remains due on the invoice.
    if (body.invoiceId) await assertPayable(tx, body.invoiceId, p.clientId, p.amount, p.id)
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
