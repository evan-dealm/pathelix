import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { ContainerUpdateSchema } from '@/lib/containers/schemas'
import { allowedManualTargets, daysOnSite, type ContainerStatus } from '@/lib/containers/lifecycle'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { setStatus } from '@/lib/containers/service'

/** One bin with its history (last 200 events) and the missions that moved it. */
export const GET = apiRoute({ name: '/api/containers/[id]' }, async ({ db, params }) => {
  const c = await db.container.findFirst({
    where: { id: params.id },
    include: {
      type:   true,
      client: { select: { id: true, name: true, phone: true } },
      site:   { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
    },
  })
  if (!c) throw notFound('Contenant')
  const [events, missions] = await Promise.all([
    db.containerEvent.findMany({ where: { containerId: c.id }, orderBy: { at: 'desc' }, take: 200 }),
    db.mission.findMany({
      where: { OR: [{ placedContainerId: c.id }, { collectedContainerId: c.id }] },
      select: { id: true, type: true, date: true, clientName: true, address: true, completedAt: true },
      orderBy: { date: 'desc' }, take: 50,
    }),
  ])
  // Names for the people and places in the history.
  const clientIds = [...new Set(events.map(e => e.clientId).filter((x): x is string => !!x))]
  const driverIds = [...new Set(events.map(e => e.driverId).filter((x): x is string => !!x))]
  const [clients, drivers] = await Promise.all([
    clientIds.length ? db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [],
    driverIds.length ? db.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
  ])
  const clientName = new Map(clients.map(x => [x.id, x.name]))
  const driverName = new Map(drivers.map(x => [x.id, `${x.firstName} ${x.lastName}`.trim()]))
  const rotations90 = await db.containerEvent.count({ where: { containerId: c.id, type: 'EMPTIED', at: { gte: new Date(Date.now() - 90 * 86_400_000) } } })
  return {
    ...c,
    daysOnSite: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'].includes(c.status) ? daysOnSite(c.placedAt) : null,
    rotations90,
    allowedStatuses: allowedManualTargets(c.status as ContainerStatus),
    events: events.map(e => ({ ...e, clientName: e.clientId ? clientName.get(e.clientId) ?? null : null, driverName: e.driverId ? driverName.get(e.driverId) ?? null : null })),
    missions,
  }
})

export const PUT = apiRoute({ name: '/api/containers/[id]', permission: 'manage_vehicles', schema: ContainerUpdateSchema }, async ({ db, body, params }) => {
  const c = await db.container.findFirst({ where: { id: params.id }, select: { id: true, number: true } })
  if (!c) throw notFound('Contenant')
  if (body.typeId) await assertTenantRefs(db, { typeId: body.typeId })
  if (body.number && body.number !== c.number) {
    const dup = await db.container.findFirst({ where: { number: body.number }, select: { id: true } })
    if (dup) throw unprocessable(`Le numéro ${body.number} existe déjà`, 'DUPLICATE')
  }
  return db.container.update({ where: { id: c.id }, data: body })
})

/** Taken out of the fleet (archived) — the history stays. */
export const DELETE = apiRoute({ name: '/api/containers/[id]', permission: 'manage_vehicles' }, async ({ db, params, userId }) => {
  const c = await db.container.findFirst({ where: { id: params.id }, select: { id: true, status: true } })
  if (!c) throw notFound('Contenant')
  await db.$transaction(async tx => {
    await setStatus(tx, c.id, 'ARCHIVED', userId, 'Sortie du parc')
    await tx.container.update({ where: { id: c.id }, data: { archived: true } })
  })
  return { ok: true }
})
