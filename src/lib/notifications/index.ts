import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { sendMail } from '@/lib/mailer'
import { hasPermission, type Permission } from '@/lib/permissions'

const log = createLogger('notifications')

export const NOTIFICATION_KINDS = {
  P1_CREATED:          { label: 'Urgence P1 créée',                 severity: 'critical', permission: 'manage_missions' },
  UNASSIGNED:          { label: 'Missions non planifiées',          severity: 'warning',  permission: 'optimize' },
  DRIVER_ABSENT:       { label: 'Chauffeur absent',                 severity: 'warning',  permission: 'manage_drivers' },
  VEHICLE_DOWN:        { label: 'Camion immobilisé',                severity: 'warning',  permission: 'manage_vehicles' },
  MAINTENANCE_DUE:     { label: 'Entretien ou contrôle à prévoir',  severity: 'info',     permission: 'manage_vehicles' },
  CONTAINER_LONG_STAY: { label: 'Bennes longtemps chez un client',  severity: 'info',     permission: 'manage_vehicles' },
  CONTRACT_ENDING:     { label: 'Contrat bientôt échu',             severity: 'info',     permission: 'manage_sales' },
  QUOTE_EXPIRING:      { label: 'Devis bientôt expiré',             severity: 'info',     permission: 'manage_sales' },
  INVOICE_OVERDUE:     { label: 'Factures en retard',               severity: 'warning',  permission: 'manage_billing' },
  WEBHOOK_FAILING:     { label: 'Intégration en échec',             severity: 'warning',  permission: 'manage_integrations' },
  PORTAL_REQUEST:      { label: 'Demande d\'un client',             severity: 'info',     permission: 'manage_missions' },
  WEIGHING_REVIEW:     { label: 'Ticket de pesée à vérifier',       severity: 'info',     permission: 'manage_missions' },
  INCIDENT:            { label: 'Incident terrain',                 severity: 'critical', permission: 'manage_missions' },
} as const satisfies Record<string, { label: string; severity: 'info' | 'warning' | 'critical'; permission: Permission }>

export type NotificationKind = keyof typeof NOTIFICATION_KINDS

export interface NotifyInput {
  kind:       NotificationKind
  title:      string
  body?:      string
  link?:      string
  entityType?: string
  entityId?:  string
  /** Same key within 24 h is not notified twice (default: kind + entity). */
  dedupeKey?: string
}

const DEDUPE_WINDOW_MS = 24 * 3_600_000

/**
 * Notifies the staff of a tenant who may act on it (by permission), once per dedupe key per day,
 * in the app and — per their preferences — by e-mail (critical: e-mail by default when configured).
 * Never throws.
 */
export async function notify(tenantId: string, n: NotifyInput): Promise<number> {
  try {
    const db = getTenantDb(tenantId)
    const def = NOTIFICATION_KINDS[n.kind]
    const dedupeKey = n.dedupeKey ?? `${n.kind}:${n.entityId ?? ''}`
    const users = await db.user.findMany({ where: { role: { in: ['ADMIN', 'DISPATCHER'] } }, select: { id: true, role: true, email: true } })
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS)
    const prefs = await db.notificationPreference.findMany({ where: { kind: n.kind }, select: { userId: true, inApp: true, email: true } })
    const prefOf = new Map(prefs.map(p => [p.userId, p]))
    let created = 0
    const emails: string[] = []
    for (const u of users) {
      if (!(await hasPermission(u.id, u.role.toLowerCase(), def.permission))) continue
      const pref = prefOf.get(u.id)
      const inApp = def.severity === 'critical' || (pref?.inApp ?? true)
      const wantsEmail = pref ? pref.email : def.severity === 'critical'
      const dup = await db.notification.findFirst({ where: { userId: u.id, dedupeKey, createdAt: { gte: since } }, select: { id: true } })
      if (dup) continue
      if (inApp) {
        await db.notification.create({
          data: {
            userId: u.id, kind: n.kind, severity: def.severity, title: n.title.slice(0, 200), body: (n.body ?? '').slice(0, 2000),
            link: n.link ?? '', entityType: n.entityType ?? null, entityId: n.entityId ?? null, dedupeKey,
          } as Parameters<typeof db.notification.create>[0]['data'],
        })
        created++
      }
      if (wantsEmail && u.email) emails.push(u.email)
    }
    if (emails.length > 0) {
      void sendMail({ to: emails, subject: `[Pathélix] ${n.title}`, text: `${n.title}\n\n${n.body ?? ''}\n\nConnectez-vous à Pathélix pour agir.` })
    }
    return created
  } catch (err) {
    log.warn('Notification failed', { tenantId, kind: n.kind, err: err instanceof Error ? err.message : String(err) })
    return 0
  }
}
