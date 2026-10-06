import { apiRoute, paged, pagination, unprocessable } from '@/lib/api/route'
import { PaymentSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { refreshPaymentStatus } from '@/lib/sales/invoices'
import { emitBusinessEvent } from '@/lib/events/outbound'

export const GET = apiRoute({ name: '/api/payments', permission: 'manage_billing' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  if (sp.get('clientId')) where.clientId = sp.get('clientId')
  if (sp.get('invoiceId')) where.invoiceId = sp.get('invoiceId')
  if (sp.get('unallocated') === '1') where.invoiceId = null
  const [rows, total] = await Promise.all([
    db.payment.findMany({ where, skip, take: limit, orderBy: { receivedAt: 'desc' }, include: { client: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } } } }),
    db.payment.count({ where }),
  ])
  return paged(rows, total, page, limit)
})

/**
 * Records a payment received (transfer, cheque…), on an invoice or not yet matched. The
 * invoice's paid amount and status follow (partially paid, paid).
 */
export const POST = apiRoute({ name: '/api/payments', permission: 'manage_billing', schema: PaymentSchema }, async ({ db, tenantId, userId, body }) => {
  await assertTenantRefs(db, { clientId: body.clientId, invoiceId: body.invoiceId ?? undefined })
  if (body.invoiceId) {
    const inv = await db.invoice.findFirst({ where: { id: body.invoiceId }, select: { clientId: true, status: true, kind: true } })
    if (!inv || inv.clientId !== body.clientId) throw unprocessable('Cette facture n\'est pas celle de ce client', 'CLIENT_MISMATCH')
    if (inv.status === 'DRAFT' || inv.status === 'CANCELLED' || inv.kind !== 'INVOICE') throw unprocessable('Paiement possible sur une facture émise uniquement', 'NOT_PAYABLE')
  }
  const p = await db.$transaction(async tx => {
    const created = await tx.payment.create({
      data: { ...body, invoiceId: body.invoiceId ?? null, method: body.method ?? 'TRANSFER', reference: body.reference ?? '', notes: body.notes ?? '', createdBy: userId } as Parameters<typeof tx.payment.create>[0]['data'],
    })
    if (created.invoiceId) await refreshPaymentStatus(tx, created.invoiceId)
    return created
  })
  void emitBusinessEvent(tenantId, 'payment.received', { paymentId: p.id, invoiceId: p.invoiceId, clientId: p.clientId, amount: p.amount, receivedAt: p.receivedAt })
  return p
})
