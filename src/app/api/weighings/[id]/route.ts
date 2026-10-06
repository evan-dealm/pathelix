import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { WeighingReviewSchema } from '@/lib/sales/schemas'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { emitBusinessEvent } from '@/lib/events/outbound'

/**
 * Review of a ticket: correct the figures and validate, or reject. An OCR reading is never used
 * (billing, BSD) before a person validated it here.
 */
export const PUT = apiRoute({ name: '/api/weighings/[id]', permission: 'manage_missions', schema: WeighingReviewSchema }, async ({ db, tenantId, userId, body, params }) => {
  const w = await db.weighing.findFirst({ where: { id: params.id }, select: { id: true, status: true } })
  if (!w) throw notFound('Pesée')
  const billed = await db.invoiceLine.count({ where: { weighingId: w.id, invoice: { status: { notIn: ['DRAFT', 'CANCELLED'] } } } })
  if (billed > 0) throw unprocessable('Pesée déjà facturée : corrigez par un avoir', 'BILLED')
  await assertTenantRefs(db, { missionId: body.missionId ?? undefined, exutoireId: body.exutoireId ?? undefined, containerId: body.containerId ?? undefined, materialId: body.materialId ?? undefined, clientId: body.clientId ?? undefined })
  const { status, weighedAt, ...rest } = body
  const updated = await db.weighing.update({
    where: { id: w.id },
    data: {
      ...rest, ...(weighedAt ? { weighedAt: new Date(weighedAt) } : {}),
      ...(status ? { status, validatedBy: userId, validatedAt: new Date() } : {}),
    },
  })
  if (status === 'VALIDATED' && updated.missionId) {
    await db.mission.update({ where: { id: updated.missionId }, data: { weightKg: updated.netKg, weightSource: 'WEIGHED', weightUncertaintyKg: 0 } })
    if (w.status === 'PENDING_REVIEW') void emitBusinessEvent(tenantId, 'weighing.created', { weighingId: updated.id, missionId: updated.missionId, netKg: updated.netKg })
  }
  return updated
})
