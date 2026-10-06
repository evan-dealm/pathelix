import { NextResponse } from 'next/server'
import { z } from 'zod'
import { portalRoute } from '@/lib/portal/route'
import { decideQuote } from '@/lib/sales/quotes'
import { emitBusinessEvent } from '@/lib/events/outbound'
import { notify } from '@/lib/notifications'

const DecisionSchema = z.object({ decision: z.enum(['ACCEPTED', 'REFUSED']), reason: z.string().max(1000).optional() })

/** The customer accepts or refuses a quote sent to them (recorded with their name). */
export const POST = portalRoute({ name: '/api/portal/quotes/[id]/decision', schema: DecisionSchema }, async ({ db, session, user, body, params }) => {
  const q = await db.quote.findFirst({ where: { id: params.id, clientId: session.clientId, status: 'SENT' }, select: { id: true, number: true } })
  if (!q) return NextResponse.json({ error: 'Ce devis n\'attend pas de réponse' }, { status: 404 })
  const updated = await decideQuote(db, q.id, body.decision, `${user.name || user.email} (portail client)`, body.reason ?? '')
  void emitBusinessEvent(session.tenantId, body.decision === 'ACCEPTED' ? 'quote.accepted' : 'quote.refused', { quoteId: q.id, number: q.number, via: 'portal' })
  void notify(session.tenantId, {
    kind: 'PORTAL_REQUEST', title: `Devis ${q.number} ${body.decision === 'ACCEPTED' ? 'accepté' : 'refusé'} par le client`,
    body: body.reason ?? '', link: 'sales', entityType: 'quote', entityId: q.id,
  })
  return { status: updated.status }
})
