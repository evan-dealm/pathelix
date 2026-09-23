import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext } from '@/lib/data/context'
import type { NextRequest } from 'next/server'

const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

export async function writeAudit(
  req:        NextRequest,
  action:     string,
  entityType: string,
  entityId:   string,
  changes:    Record<string, unknown> = {},
): Promise<void> {
  if (USE_MOCK) return
  try {
    const { tenantId, userId } = getRequestContext(req)
    const db = getTenantDb(tenantId)
    await db.auditLog.create({
      data: {
        userId:     userId ?? 'system',
        action,
        entityType,
        entityId,
        changes,
      } as Parameters<typeof db.auditLog.create>[0]['data'],
    })
  } catch {

  }
}

export function auditAsync(
  req:        NextRequest,
  action:     string,
  entityType: string,
  entityId:   string,
  changes:    Record<string, unknown> = {},
): void {
  void writeAudit(req, action, entityType, entityId, changes)
}
