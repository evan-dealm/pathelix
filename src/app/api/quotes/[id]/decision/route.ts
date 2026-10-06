import { apiRoute } from '@/lib/api/route'
import { QuoteDecisionSchema } from '@/lib/sales/schemas'
import { decideQuote } from '@/lib/sales/quotes'
import { emitBusinessEvent } from '@/lib/events/outbound'

/** Records the customer's answer (accepted / refused), e.g. after a signed copy came back. */
export const POST = apiRoute({ name: '/api/quotes/[id]/decision', permission: 'manage_sales', schema: QuoteDecisionSchema }, async ({ db, tenantId, userId, body, params }) => {
  const q = await decideQuote(db, params.id, body.decision, body.by ?? userId, body.reason)
  if (q.status === 'ACCEPTED') void emitBusinessEvent(tenantId, 'quote.accepted', { quoteId: q.id, number: q.number, clientId: q.clientId, totalHT: q.totalHT })
  return q
})
