import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'
import { NOTIFICATION_KINDS, type NotificationKind } from '@/lib/notifications'
import { mailConfigured } from '@/lib/mailer'

const KINDS = Object.keys(NOTIFICATION_KINDS) as [NotificationKind, ...NotificationKind[]]
const PrefSchema = z.object({ prefs: z.array(z.object({ kind: z.enum(KINDS), inApp: z.boolean(), email: z.boolean() })).max(KINDS.length) })

/** The current user's channels per kind (defaults: in-app; e-mail for critical ones). */
export const GET = apiRoute({ name: '/api/notifications/preferences' }, async ({ db, userId }) => {
  const rows = await db.notificationPreference.findMany({ where: { userId } })
  const byKind = new Map(rows.map(r => [r.kind, r]))
  return {
    emailAvailable: mailConfigured(),
    prefs: KINDS.map(kind => ({
      kind, label: NOTIFICATION_KINDS[kind].label, severity: NOTIFICATION_KINDS[kind].severity,
      inApp: byKind.get(kind)?.inApp ?? true, email: byKind.get(kind)?.email ?? NOTIFICATION_KINDS[kind].severity === 'critical',
    })),
  }
})

export const PUT = apiRoute({ name: '/api/notifications/preferences', schema: PrefSchema }, async ({ db, tenantId, userId, body }) => {
  await db.$transaction(body.prefs.map(p => db.notificationPreference.upsert({
    where: { tenantId_userId_kind: { tenantId, userId, kind: p.kind } },
    create: { userId, kind: p.kind, inApp: p.inApp, email: p.email } as Parameters<typeof db.notificationPreference.create>[0]['data'],
    update: { inApp: p.inApp, email: p.email },
  })))
  return { ok: true }
})
