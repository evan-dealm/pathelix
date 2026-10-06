import { apiRoute, paged, pagination } from '@/lib/api/route'
import { InvoiceDraftSchema } from '@/lib/sales/schemas'
import { balanceOf, createInvoiceDraft, effectiveInvoiceStatus } from '@/lib/sales/invoices'
import { isoDay } from '@/lib/sales/lines'

/**
 * Invoices and credit notes. Filters: status (OVERDUE is derived from the due date), clientId,
 * kind, q (number, customer), from/to (issue date).
 */
export const GET = apiRoute({ name: '/api/invoices', permission: 'manage_billing' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const today = isoDay()
  const where: Record<string, unknown> = {}
  const status = sp.get('status')
  if (status === 'OVERDUE') Object.assign(where, { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: today } })
  else if (status === 'UNPAID') where.status = { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] }
  else if (status) where.status = status
  if (sp.get('clientId')) where.clientId = sp.get('clientId')
  if (sp.get('kind')) where.kind = sp.get('kind')
  if (sp.get('from') || sp.get('to')) where.issueDate = { ...(sp.get('from') ? { gte: sp.get('from') } : {}), ...(sp.get('to') ? { lte: sp.get('to') } : {}) }
  const q = sp.get('q')?.trim()
  if (q) where.OR = [{ number: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }]
  const [rows, total, open] = await Promise.all([
    db.invoice.findMany({ where, skip, take: limit, orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], include: { client: { select: { id: true, name: true } } } }),
    db.invoice.count({ where }),
    db.invoice.findMany({ where: { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] } }, select: { totalTTC: true, amountPaid: true, dueDate: true } }),
  ])
  const outstanding = open.reduce((a, i) => a + balanceOf(i), 0)
  const overdue = open.filter(i => i.dueDate && i.dueDate < today).reduce((a, i) => a + balanceOf(i), 0)
  return {
    ...paged(rows.map(r => ({ ...r, status: effectiveInvoiceStatus(r, today), balance: balanceOf(r) })), total, page, limit),
    summary: { outstanding: Math.round(outstanding * 100) / 100, overdue: Math.round(overdue * 100) / 100 },
  }
})

/** A draft — manual lines, or built from the field data of a period (done missions, rentals, weighings). */
export const POST = apiRoute({ name: '/api/invoices', permission: 'manage_billing', schema: InvoiceDraftSchema }, async ({ db, tenantId, userId, body }) => {
  return createInvoiceDraft(db, tenantId, userId, body)
})
