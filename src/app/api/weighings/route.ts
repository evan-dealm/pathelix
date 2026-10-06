import { apiRoute, paged, pagination } from '@/lib/api/route'
import { WeighingSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { emitBusinessEvent } from '@/lib/events/outbound'

/** Weighing tickets. Filters: status (PENDING_REVIEW = OCR readings to confirm), missionId, clientId. */
export const GET = apiRoute({ name: '/api/weighings' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  for (const k of ['status', 'missionId', 'clientId', 'exutoireId'] as const) if (sp.get(k)) where[k] = sp.get(k)
  const [rows, total] = await Promise.all([
    db.weighing.findMany({ where, skip, take: limit, orderBy: { weighedAt: 'desc' } }),
    db.weighing.count({ where }),
  ])
  return paged(rows, total, page, limit)
})

/** A ticket typed in the office (or imported): validated on entry, a person entered it. */
export const POST = apiRoute({ name: '/api/weighings', permission: 'manage_missions', schema: WeighingSchema }, async ({ db, tenantId, userId, body }) => {
  await assertTenantRefs(db, { missionId: body.missionId ?? undefined, exutoireId: body.exutoireId ?? undefined, containerId: body.containerId ?? undefined, materialId: body.materialId ?? undefined, clientId: body.clientId ?? undefined })
  let clientId = body.clientId ?? null
  if (!clientId && body.missionId) clientId = (await db.mission.findFirst({ where: { id: body.missionId }, select: { clientId: true } }))?.clientId ?? null
  const w = await db.weighing.create({
    data: {
      ...body, clientId, source: 'MANUAL', status: 'VALIDATED', validatedBy: userId, validatedAt: new Date(),
      weighedAt: body.weighedAt ? new Date(body.weighedAt) : new Date(), ticketNumber: body.ticketNumber ?? '', notes: body.notes ?? '',
    } as Parameters<typeof db.weighing.create>[0]['data'],
  })
  if (w.missionId) await db.mission.update({ where: { id: w.missionId }, data: { weightKg: w.netKg, weightSource: 'WEIGHED', weightUncertaintyKg: 0 } })
  void emitBusinessEvent(tenantId, 'weighing.created', { weighingId: w.id, missionId: w.missionId, netKg: w.netKg })
  return w
})
