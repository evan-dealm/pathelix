import { z } from 'zod'
import { apiRoute, conflict, notFound, unprocessable } from '@/lib/api/route'

const HandleSchema = z.object({
  status:   z.enum(['ACCEPTED', 'DONE', 'REJECTED']),
  response: z.string().max(2000).optional(),
  /** Accept and create the mission right away (rotation → ECHANGER/ALLER_RETOUR, pickup → RETIRER, extra bin → POSER). */
  createMission: z.object({ type: z.enum(['POSER', 'RETIRER', 'ECHANGER', 'ALLER_RETOUR']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(),
})

/** Answers a customer request; the answer is visible in their portal. */
export const PUT = apiRoute({ name: '/api/portal-requests/[id]', permission: 'manage_missions', schema: HandleSchema }, async ({ db, userId, body, params }) => {
  const r = await db.portalRequest.findFirst({ where: { id: params.id } })
  if (!r) throw notFound('Demande')
  let missionId = r.missionId
  if (body.createMission) {
    if (r.missionId) throw conflict('Une mission a déjà été créée pour cette demande', 'ALREADY_PLANNED')
    if (!r.siteId) throw unprocessable('La demande ne précise pas de site : créez la mission à la main', 'NO_SITE')
    const [site, client, container] = await Promise.all([
      db.site.findFirst({ where: { id: r.siteId }, select: { address: true, name: true, latitude: true, longitude: true, accessNotes: true, defaultManeuverMin: true } }),
      db.client.findFirst({ where: { id: r.clientId }, select: { name: true } }),
      r.containerId ? db.container.findFirst({ where: { id: r.containerId }, select: { id: true, typeId: true, type: { select: { capacityM3: true, name: true, tareKg: true } } } }) : null,
    ])
    if (!site) throw unprocessable('Site introuvable', 'NO_SITE')
    const collects = body.createMission.type !== 'POSER'
    const m = await db.mission.create({
      data: {
        type: body.createMission.type, date: body.createMission.date, address: site.address || site.name,
        latitude: site.latitude, longitude: site.longitude, needsGeocode: !site.latitude && !site.longitude,
        estimatedDurationMin: 20, maneuverTimeMin: site.defaultManeuverMin, clientId: r.clientId, clientName: client?.name ?? null,
        siteId: r.siteId, accessNotes: site.accessNotes || null, notes: `Demande client (portail)${r.message ? ` : ${r.message}` : ''}`,
        ...(container ? { containerTypeId: container.typeId, binSizeM3: container.type.capacityM3, binSize: container.type.name, binTareKg: container.type.tareKg, ...(collects ? { collectedContainerId: container.id } : {}) } : {}),
      } as Parameters<typeof db.mission.create>[0]['data'],
    })
    missionId = m.id
  }
  return db.portalRequest.update({ where: { id: r.id }, data: { status: body.status, response: body.response ?? r.response, handledBy: userId, missionId } })
})
