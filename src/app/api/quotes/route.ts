import { apiRoute, paged, pagination } from '@/lib/api/route'
import { QuoteSchema } from '@/lib/sales/schemas'
import { createQuote, effectiveQuoteStatus } from '@/lib/sales/quotes'
import { isoDay } from '@/lib/sales/lines'

/** Quotes: filters status (EXPIRED is derived), clientId, q (number, title, customer). */
export const GET = apiRoute({ name: '/api/quotes', permission: 'manage_sales' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const today = isoDay()
  const where: Record<string, unknown> = {}
  const status = sp.get('status')
  if (status === 'EXPIRED') Object.assign(where, { status: 'SENT', validUntil: { lt: today } })
  else if (status === 'SENT') Object.assign(where, { status: 'SENT', validUntil: { gte: today } })
  else if (status) where.status = status
  if (sp.get('clientId')) where.clientId = sp.get('clientId')
  const q = sp.get('q')?.trim()
  if (q) where.OR = [{ number: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }]
  const [rows, total] = await Promise.all([
    db.quote.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { client: { select: { id: true, name: true } } } }),
    db.quote.count({ where }),
  ])
  return paged(rows.map(r => ({ ...r, status: effectiveQuoteStatus(r, today) })), total, page, limit)
})

export const POST = apiRoute({ name: '/api/quotes', permission: 'manage_sales', schema: QuoteSchema }, async ({ db, tenantId, userId, body }) => {
  return createQuote(db, tenantId, userId, body)
})
