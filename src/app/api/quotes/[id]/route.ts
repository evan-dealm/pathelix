import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { QuoteSchema } from '@/lib/sales/schemas'
import { effectiveQuoteStatus, updateQuote } from '@/lib/sales/quotes'

export const GET = apiRoute({ name: '/api/quotes/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const q = await db.quote.findFirst({
    where: { id: params.id },
    include: { lines: { orderBy: { position: 'asc' } }, client: { select: { id: true, name: true, email: true } }, site: { select: { id: true, name: true, address: true } }, order: { select: { id: true, number: true } } },
  })
  if (!q) throw notFound('Devis')
  return { ...q, status: effectiveQuoteStatus(q) }
})

export const PUT = apiRoute({ name: '/api/quotes/[id]', permission: 'manage_sales', schema: QuoteSchema.omit({ clientId: true }).partial() }, async ({ db, tenantId, body, params }) => {
  return updateQuote(db, tenantId, params.id, body)
})

/** Only a draft may be deleted — a sent quote is part of the customer history. */
export const DELETE = apiRoute({ name: '/api/quotes/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const q = await db.quote.findFirst({ where: { id: params.id }, select: { id: true, status: true } })
  if (!q) throw notFound('Devis')
  if (q.status !== 'DRAFT') throw unprocessable('Seul un brouillon peut être supprimé', 'NOT_DRAFT')
  await db.quote.delete({ where: { id: q.id } })
  return { ok: true }
})
