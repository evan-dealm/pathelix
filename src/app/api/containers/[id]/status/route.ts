import { apiRoute } from '@/lib/api/route'
import { ContainerStatusSchema } from '@/lib/containers/schemas'
import { setStatus } from '@/lib/containers/service'

/** Manual status change (maintenance, lost, full, to collect…) along the allowed transitions. */
export const POST = apiRoute({ name: '/api/containers/[id]/status', permission: 'manage_vehicles', schema: ContainerStatusSchema }, async ({ db, body, params, userId }) => {
  await db.$transaction(tx => setStatus(tx, params.id, body.status, userId, body.notes ?? ''))
  return { ok: true }
})
