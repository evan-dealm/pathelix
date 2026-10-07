// NOT migrated to getTenantDb() — `userId` here always comes from the JWT-verified request
// context (never client-supplied), and a User row belongs to exactly one tenant, so filtering
// by `userId` alone cannot cross a tenant boundary; adding `tenantId` would be redundant, not a
// fix for a real gap. Left on the raw client rather than changing hasPermission()'s signature
// (used at ~40 call sites) for a purely defense-in-depth gain with no real exposure today.
import prisma from '@/lib/db'
import { bust, onBust } from '@/lib/cacheBus'

export const ALL_PERMISSIONS = [
  'optimize',
  'manage_drivers',
  'manage_exutoires',
  'manage_missions',
  'manage_vehicles',
  'manage_users',
  'view_reports',
  'view_costs',
  'manage_settings',
  'api_access',
  'manage_integrations',
  'manage_sales',
  'manage_billing',
] as const

export type Permission = typeof ALL_PERMISSIONS[number]

export const DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  admin:      [...ALL_PERMISSIONS],
  superadmin: [...ALL_PERMISSIONS],
  dispatcher: ['optimize', 'manage_missions', 'manage_drivers', 'view_reports', 'manage_vehicles', 'view_costs', 'manage_sales'],
  driver:     [],
}

// On globalThis: the middleware and the route handlers are separate bundles (separate module
// instances, same process) — a module-level Map let a route invalidate its own copy while the
// middleware kept serving the stale entry from the other until the TTL expired.
const _gp = globalThis as typeof globalThis & { __pathelixPermCache?: Map<string, { perms: Set<string>; ts: number }> }
const _permCache = (_gp.__pathelixPermCache ??= new Map<string, { perms: Set<string>; ts: number }>())
const PERM_CACHE_TTL = 60_000

export async function hasPermission(
  userId: string,
  role: string,
  permission: Permission,
): Promise<boolean> {

  if (role === 'admin' || role === 'superadmin') return true

  const now = Date.now()
  const cached = _permCache.get(userId)
  if (cached && now - cached.ts < PERM_CACHE_TTL) {
    return cached.perms.has(permission)
  }

  const customPerms = await prisma.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  })

  let perms: Set<string>
  if (customPerms.length > 0) {

    perms = new Set(customPerms.map(p => p.permission))
  } else {

    perms = new Set(DEFAULT_PERMISSIONS[role] ?? [])
  }

  _permCache.set(userId, { perms, ts: now })
  return perms.has(permission)
}

onBust('perm', userId => { _permCache.delete(userId) })

/** Drops a user's cached permissions here and on every other instance. */
export function invalidatePermCache(userId: string): void {
  bust('perm', userId)
}
