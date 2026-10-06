import { NextResponse } from 'next/server'
import { z } from 'zod'
import { portalRoute } from '@/lib/portal/route'
import { emitBusinessEvent } from '@/lib/events/outbound'
import { notify } from '@/lib/notifications'

const RequestSchema = z.object({
  kind:          z.enum(['ROTATION', 'PICKUP', 'NEW_CONTAINER', 'ISSUE', 'OTHER']),
  siteId:        z.string().optional(),
  containerId:   z.string().optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  message:       z.string().max(2000).optional(),
})

const LABEL: Record<string, string> = { ROTATION: 'Rotation demandée', PICKUP: 'Retrait demandé', NEW_CONTAINER: 'Benne supplémentaire demandée', ISSUE: 'Problème signalé', OTHER: 'Demande' }

/**
 * A request from the customer: the site and bin must be theirs. A pickup request also flags the
 * bin "to collect" in the fleet. The dispatch is notified and turns it into a mission.
 */
export const POST = portalRoute({ name: '/api/portal/requests', schema: RequestSchema }, async ({ db, session, user, body }) => {
  const clientId = session.clientId
  if (body.siteId && !(await db.site.findFirst({ where: { id: body.siteId, clientSites: { some: { clientId } } }, select: { id: true } }))) {
    return NextResponse.json({ error: 'Site inconnu' }, { status: 422 })
  }
  const container = body.containerId ? await db.container.findFirst({ where: { id: body.containerId, clientId }, select: { id: true, number: true, status: true, siteId: true } }) : null
  if (body.containerId && !container) return NextResponse.json({ error: 'Benne inconnue' }, { status: 422 })
  // A double tap (or an impatient customer) must not queue the same rotation twice.
  if (container) {
    const open = await db.portalRequest.findFirst({ where: { clientId, containerId: container.id, kind: body.kind, status: 'NEW' }, select: { id: true, status: true } })
    if (open) return { id: open.id, status: open.status, duplicate: true }
  }
  const r = await db.portalRequest.create({
    data: {
      clientId, portalUserId: user.id, kind: body.kind, siteId: body.siteId ?? container?.siteId ?? null, containerId: container?.id ?? null,
      preferredDate: body.preferredDate ?? null, message: body.message ?? '',
    } as Parameters<typeof db.portalRequest.create>[0]['data'],
  })
  if (container && (body.kind === 'PICKUP' || body.kind === 'ROTATION') && (container.status === 'AT_CUSTOMER' || container.status === 'FULL')) {
    await db.container.update({ where: { id: container.id }, data: { status: body.kind === 'PICKUP' ? 'TO_COLLECT' : 'FULL' } })
    await db.containerEvent.create({ data: { containerId: container.id, type: 'STATUS', fromStatus: container.status, toStatus: body.kind === 'PICKUP' ? 'TO_COLLECT' : 'FULL', clientId, notes: 'Demande du client (portail)' } as Parameters<typeof db.containerEvent.create>[0]['data'] })
  }
  const client = await db.client.findFirst({ where: { id: clientId }, select: { name: true } })
  void notify(session.tenantId, {
    kind: 'PORTAL_REQUEST', title: `${LABEL[body.kind]} — ${client?.name ?? ''}${container ? ` (benne ${container.number})` : ''}`,
    body: [body.preferredDate ? `Souhaité le ${body.preferredDate.split('-').reverse().join('/')}` : '', body.message ?? ''].filter(Boolean).join(' · '),
    link: 'sales', entityType: 'portalRequest', entityId: r.id,
  })
  void emitBusinessEvent(session.tenantId, 'portal.request', { requestId: r.id, kind: r.kind, clientId, containerId: r.containerId })
  return { id: r.id, status: r.status }
})
