import { z } from 'zod'
import { apiRoute, notFound } from '@/lib/api/route'
import { inviteUrl, makeInvite, sendInvite } from '@/lib/portal/invite'

const ActionSchema = z.object({ action: z.enum(['disable', 'enable', 'reset']) })

/**
 * Disable / re-enable a portal access (revokes its sessions), or send a new one-time link
 * (password reset; also revokes current sessions).
 */
export const POST = apiRoute({ name: '/api/portal-users/[id]', permission: 'manage_sales', schema: ActionSchema }, async ({ db, tenantId, body, params, req }) => {
  const u = await db.portalUser.findFirst({ where: { id: params.id }, select: { id: true, email: true, client: { select: { name: true } } } })
  if (!u) throw notFound('Accès portail')
  if (body.action === 'reset') {
    const invite = makeInvite()
    await db.portalUser.update({ where: { id: u.id }, data: { inviteTokenHash: invite.hash, inviteExpiresAt: invite.expiresAt, sessionVersion: { increment: 1 } } })
    const url = inviteUrl(req.nextUrl.origin, invite.token)
    const company = (await db.tenantSettings.findUnique({ where: { tenantId }, select: { companyDisplayName: true } }))?.companyDisplayName ?? ''
    return { inviteUrl: url, emailed: await sendInvite(u.email, url, company, u.client.name) }
  }
  await db.portalUser.update({ where: { id: u.id }, data: { disabled: body.action === 'disable', sessionVersion: { increment: 1 } } })
  return { ok: true }
})

export const DELETE = apiRoute({ name: '/api/portal-users/[id]', permission: 'manage_sales' }, async ({ db, params }) => {
  const u = await db.portalUser.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!u) throw notFound('Accès portail')
  await db.portalUser.delete({ where: { id: u.id } })
  return { ok: true }
})
