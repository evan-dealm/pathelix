import type { SessionPayload } from '@/lib/session'

/**
 * Server-side session revocation. Session JWTs are stateless (24h), so without this a deleted
 * user, a demoted admin or a changed password kept a working token until expiry. Each token
 * carries the user's `sessionVersion` (`sv`) at sign time; bumping the column invalidates every
 * token issued before.
 *
 * Checked by the middleware on every authenticated request, with a short per-process cache
 * (same trade-off as the tenant suspension cache in src/lib/data/context.ts): a revocation is
 * effective immediately on the instance that performed it (the cache entry is dropped) and
 * within CACHE_TTL_MS on the others.
 */

const CACHE_TTL_MS = 30_000
const CACHE_MAX    = 5_000

const _cache = new Map<string, { version: number | null; checkedAt: number }>()

/** The User row a session belongs to — impersonation sessions (`sa:<id>`) belong to the superadmin. */
export function sessionUserId(session: Pick<SessionPayload, 'sub'>): string {
  return session.sub.startsWith('sa:') ? session.sub.slice(3) : session.sub
}

async function loadVersion(userId: string): Promise<number | null> {
  const now = Date.now()
  const hit = _cache.get(userId)
  if (hit && now - hit.checkedAt < CACHE_TTL_MS) return hit.version

  const { unscopedPrisma: prisma } = await import('@/lib/tenantDb')
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } })
  const version = row ? row.sessionVersion : null

  if (_cache.size >= CACHE_MAX) {
    for (const [k, v] of _cache) if (now - v.checkedAt >= CACHE_TTL_MS) _cache.delete(k)
    if (_cache.size >= CACHE_MAX) _cache.clear()
  }
  _cache.set(userId, { version, checkedAt: now })
  return version
}

/**
 * True when the session still matches its user: the user exists and its sessionVersion equals
 * the token's `sv` (tokens minted before the column existed carry no `sv` and count as 0).
 * Mock mode has no User table to check against.
 */
export async function isSessionCurrent(session: SessionPayload): Promise<boolean> {
  if (process.env.USE_MOCK_DATA !== 'false') return true
  const version = await loadVersion(sessionUserId(session))
  if (version === null) return false
  return version === (session.sv ?? 0)
}

/** Invalidates every session of a user (password/role change, deletion). */
export async function revokeUserSessions(userId: string): Promise<void> {
  _cache.delete(userId)
  const { unscopedPrisma: prisma } = await import('@/lib/tenantDb')
  await prisma.user.updateMany({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
  _cache.delete(userId)
}

/** Drops the cached version (call after deleting a user so the next request re-checks). */
export function forgetSessionVersion(userId: string): void {
  _cache.delete(userId)
}
