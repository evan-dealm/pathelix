import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'

const log = createLogger('superadmin-audit')

export interface SuperadminAuditEntry {

  superadminId: string

  targetTenantId: string

  isImpersonation: boolean

  method: string

  path: string

  action: string

  details?: Record<string, unknown>
}

export function isSuperadminSession(userId: string, role: string): boolean {
  return role === 'superadmin' || userId.startsWith('sa:')
}

export function extractSuperadminId(userId: string): string {
  return userId.startsWith('sa:') ? userId.slice(3) : userId
}

/**
 * Records a superadmin action in the target organisation's audit log. Routes await it, so the
 * entry is written before the response leaves; it never rejects — a failed write is logged and
 * must not turn an action that already happened into an error.
 */
export async function logSuperadminAction(entry: SuperadminAuditEntry): Promise<void> {

  log.warn('SUPERADMIN_ACTION', {
    ...entry,
    timestamp: new Date().toISOString(),
  })

  try {
    await prisma.auditLog.create({
      data: {
        tenantId:   entry.targetTenantId,
        userId:     `sa:${entry.superadminId}`,
        action:     `superadmin:${entry.action}`,
        entityType: 'superadmin_audit',
        entityId:   entry.path,
        changes: {
          method:          entry.method,
          path:            entry.path,
          isImpersonation: entry.isImpersonation,
          superadminId:    entry.superadminId,
          ...(entry.details ?? {}),
        } as unknown as Parameters<typeof prisma.auditLog.create>[0]['data']['changes'],
      },
    })
  } catch (err) {
    log.error('Failed to persist superadmin audit', { err: err instanceof Error ? err.message : String(err) })
  }
}

export function auditSuperadminRequest(
  userId: string,
  role: string,
  tenantId: string,
  method: string,
  path: string,
  action: string,
  details?: Record<string, unknown>,
): void {
  if (!isSuperadminSession(userId, role)) return

  void logSuperadminAction({
    superadminId:    extractSuperadminId(userId),
    targetTenantId:  tenantId,
    isImpersonation: userId.startsWith('sa:'),
    method,
    path,
    action,
    details,
  })
}
