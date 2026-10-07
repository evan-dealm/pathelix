import { apiRoute, paged, pagination } from '@/lib/api/route'
import { PaymentSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { assertPayable, refreshPaymentStatus } from '@/lib/sales/invoices'
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
 * invoice's paid amount and status follow (partially paid, paid). On an invoice, the amount
 * cannot exceed what remains due — checked under the invoice's row lock, so the same balance
 * entered twice at the same moment is recorded once.
 */
export const POST = apiRoute({ name: '/api/payments', permission: 'manage_billing', schema: PaymentSchema }, async ({ db, tenantId, userId, body }) => {
  await assertTenantRefs(db, { clientId: body.clientId, invoiceId: body.invoiceId ?? undefined })
  const p = await db.$transaction(async tx => {
    if (body.invoiceId) await assertPayable(tx, body.invoiceId, body.clientId, body.amount)
    const created = await tx.payment.create({
      data: { ...body, invoiceId: body.invoiceId ?? null, method: body.method ?? 'TRANSFER', reference: body.reference ?? '', notes: body.notes ?? '', createdBy: userId } as Parameters<typeof tx.payment.create>[0]['data'],
    })
    if (created.invoiceId) await refreshPaymentStatus(tx, created.invoiceId)
    return created
  })
  void emitBusinessEvent(tenantId, 'payment.received', { paymentId: p.id, invoiceId: p.invoiceId, clientId: p.clientId, amount: p.amount, receivedAt: p.receivedAt })
  return p
})
