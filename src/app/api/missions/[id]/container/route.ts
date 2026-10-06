import { apiRoute } from '@/lib/api/route'
import { MissionContainerSchema } from '@/lib/containers/schemas'
import { reserveForMission } from '@/lib/containers/service'

/** Reserves the bin a pose/échange will put down (null releases the reservation). */
export const POST = apiRoute({ name: '/api/missions/[id]/container', permission: 'manage_missions', schema: MissionContainerSchema }, async ({ db, body, params, userId }) => {
  await db.$transaction(tx => reserveForMission(tx, params.id, body.containerId, userId))
  return { ok: true }
})
