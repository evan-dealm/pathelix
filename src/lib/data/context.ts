import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Autorise cuid (t7abc…), slugs avec tirets, et IDs préfixés type "t_xxx" (seed/import).
// Défense en profondeur seulement : le header est réinjecté par le middleware depuis le JWT vérifié.
// Exportée et réutilisée telle quelle par session.ts — une regex distincte y divergeait déjà une
// fois (rejet des tenantId avec underscore avant correction), une seule source évite la récidive.
export const TENANT_ID_RE = /^[a-z0-9][a-z0-9_\-]{5,}$/i

export interface RequestContext {
  tenantId:  string
  userId:    string
  role:      string
  requestId: string
  trade:     string | null
}

export function getRequestContext(req: NextRequest): RequestContext {
  const tenantId = req.headers.get('x-tenant-id') ?? ''
  if (!tenantId) {
    throw new Error('[context] x-tenant-id header is missing — request did not pass through middleware')
  }
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`[context] x-tenant-id has invalid format: "${tenantId.slice(0, 36)}"`)
  }
  return {
    tenantId,
    userId:    req.headers.get('x-user-id')    ?? 'unknown',
    role:      req.headers.get('x-user-role')  ?? 'driver',
    requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
    trade:     req.headers.get('x-tenant-trade') || null,
  }
}

export function getTenantId(req: NextRequest): string {
  const tenantId = req.headers.get('x-tenant-id') ?? ''
  if (!tenantId) {
    throw new Error('[context] x-tenant-id header is missing — request did not pass through middleware')
  }
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`[context] x-tenant-id has invalid format: "${tenantId.slice(0, 36)}"`)
  }
  return tenantId
}

// In-memory, per-process cache — relies on the documented single-instance deployment topology
// (see OPERATIONS.md §8: "serveur cloud dédié unique"). If Pathélix ever moves to multiple app
// instances, this cache needs a shared invalidation mechanism (e.g. Redis pub/sub) or a
// suspended tenant could keep working for up to SUSPENSION_CACHE_TTL on instances that haven't
// seen the suspension yet.
const _suspensionCache = new Map<string, { suspended: boolean; checkedAt: number }>()
const SUSPENSION_CACHE_TTL = 60_000
const SUSPENSION_CACHE_MAX = 500

export async function checkTenantSuspension(
  tenantId: string,
  role: string,
): Promise<NextResponse | null> {

  if (role === 'superadmin') return null

  const now = Date.now()
  const cached = _suspensionCache.get(tenantId)

  if (cached && now - cached.checkedAt < SUSPENSION_CACHE_TTL) {
    if (cached.suspended) {
      return NextResponse.json(
        { error: 'Compte suspendu. Contactez votre administrateur.' },
        { status: 403 },
      )
    }
    return null
  }

  const prisma = (await import('@/lib/db')).default
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { suspendedAt: true },
  })

  const suspended = tenant?.suspendedAt !== null

  if (_suspensionCache.size >= SUSPENSION_CACHE_MAX) {
    for (const [key, entry] of _suspensionCache) {
      if (now - entry.checkedAt >= SUSPENSION_CACHE_TTL) _suspensionCache.delete(key)
    }
  }

  _suspensionCache.set(tenantId, { suspended, checkedAt: now })

  if (suspended) {
    return NextResponse.json(
      { error: 'Compte suspendu. Contactez votre administrateur.' },
      { status: 403 },
    )
  }
  return null
}

export function invalidateSuspensionCache(tenantId: string): void {
  _suspensionCache.delete(tenantId)
}
