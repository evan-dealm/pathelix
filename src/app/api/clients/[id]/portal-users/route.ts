import { z } from 'zod'
import { apiRoute, conflict, notFound } from '@/lib/api/route'
import { unscopedPrisma } from '@/lib/tenantDb'
import { inviteUrl, makeInvite, sendInvite } from '@/lib/portal/invite'

const InviteSchema = z.object({ email: z.string().email().max(200), name: z.string().trim().max(120).optional() })

export const GET = apiRoute({ name: '/api/clients/[id]/portal-users', permission: 'manage_sales' }, async ({ db, params }) => {
  const data = await db.portalUser.findMany({
    where: { clientId: params.id },
    select: { id: true, email: true, name: true, disabled: true, lastLoginAt: true, inviteExpiresAt: true, passwordHash: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return { data: data.map(({ passwordHash, ...u }) => ({ ...u, activated: !!passwordHash })) }
})

/** Gives a customer contact access to the portal: one-time link (e-mailed when SMTP is set). */
export const POST = apiRoute({ name: '/api/clients/[id]/portal-users', permission: 'manage_sales', schema: InviteSchema }, async ({ db, tenantId, userId, body, params, req }) => {
  const client = await db.client.findFirst({ where: { id: params.id }, select: { id: true, name: true } })
  if (!client) throw notFound('Client')
  const email = body.email.trim().toLowerCase()
  // E-mails are unique platform-wide (they resolve the account at login).
  const exists = await unscopedPrisma.portalUser.findUnique({ where: { email }, select: { id: true } })
  if (exists) throw conflict('Cette adresse a déjà un accès portail')
  const invite = makeInvite()
  await db.portalUser.create({
    data: { clientId: client.id, email, name: body.name ?? '', inviteTokenHash: invite.hash, inviteExpiresAt: invite.expiresAt, createdBy: userId } as Parameters<typeof db.portalUser.create>[0]['data'],
  })
  const url = inviteUrl(req.nextUrl.origin, invite.token)
  const company = (await db.tenantSettings.findUnique({ where: { tenantId }, select: { companyDisplayName: true } }))?.companyDisplayName ?? ''
  const emailed = await sendInvite(email, url, company, client.name)
  return { inviteUrl: url, emailed }
})
