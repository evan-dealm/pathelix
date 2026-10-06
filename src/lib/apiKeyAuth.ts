import { createHash } from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('apiKeyAuth')

/**
 * Programmatic access with `X-API-Key: ef_live_…` (keys created in Admin → Paramètres → Accès API).
 *
 * A key acts as a dispatcher of its tenant, narrowed to its scopes: the middleware only lets an
 * API-key request through when one of the key's scopes covers the path and method — everything
 * else (users, settings, keys themselves, audit…) is denied by default.
 */
export { API_SCOPES, type ApiScope } from '@/lib/apiScopes'

/** Role the route handlers see for an API-key request. */
export const API_KEY_ROLE = 'dispatcher'

const RESOURCE_PATHS: Record<string, RegExp> = {
  missions: /^\/api\/missions(?:\/|$)/,
  drivers:  /^\/api\/drivers(?:\/|$)/,
  vehicles: /^\/api\/vehicles(?:\/|$)/,
  clients:  /^\/api\/clients(?:\/|$)/,
  sites:    /^\/api\/sites(?:\/|$)/,
  plans:    /^\/api\/plans(?:\/|$)/,
  optimize: /^\/api\/optimize(?:\/|$)/,
  reports:  /^\/api\/reports(?:\/|$)/,
}

const READ_METHODS = new Set(['GET', 'HEAD'])

/** True when one of `scopes` covers `method pathname`. Unknown paths are never covered. */
export function scopeAllows(scopes: readonly string[], method: string, pathname: string): boolean {
  const isRead = READ_METHODS.has(method.toUpperCase())
  for (const scope of scopes) {
    const [resource, access] = scope.split(':')
    const re = RESOURCE_PATHS[resource]
    if (!re || !re.test(pathname)) continue
    if (scope === 'optimize') return true
    if (access === 'read' && isRead) return true
    if (access === 'write' && !isRead) return true
  }
  return false
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface ApiKeyIdentity {
  id:       string
  tenantId: string
  scopes:   string[]
}

const CACHE_TTL_MS      = 30_000
const CACHE_MAX         = 2_000
const TOUCH_INTERVAL_MS = 5 * 60_000
// Kept on globalThis: the middleware and the route handlers are separate bundles with their own
// module instances in the same process — a module-level Map would let the revoke route clear
// its copy while the middleware kept serving the revoked key from the other.
type CacheEntry = { identity: ApiKeyIdentity | null; checkedAt: number }
const _g = globalThis as typeof globalThis & { __pathelixApiKeyCache?: Map<string, CacheEntry>; __pathelixApiKeyTouch?: Map<string, number> }
const _cache = (_g.__pathelixApiKeyCache ??= new Map<string, CacheEntry>())
const _lastTouch = (_g.__pathelixApiKeyTouch ??= new Map<string, number>())

/**
 * Resolves a raw key to its tenant and scopes — null when unknown, revoked or expired. Cached
 * per process for 30 s (a revocation is immediate on the instance that performed it, within 30 s
 * elsewhere — same trade-off as session revocation). Mock mode has no key table.
 */
export async function authenticateApiKey(raw: string): Promise<ApiKeyIdentity | null> {
  if (process.env.USE_MOCK_DATA !== 'false') return null
  if (!raw.startsWith('ef_live_') || raw.length > 200) return null

  const keyHash = hashApiKey(raw)
  const now = Date.now()
  const hit = _cache.get(keyHash)
  if (hit && now - hit.checkedAt < CACHE_TTL_MS) return hit.identity

  // Cross-tenant by design: the key itself is what identifies the tenant (like webhook secrets).
  const { unscopedPrisma: prisma } = await import('@/lib/tenantDb')
  const row = await prisma.apiKey.findUnique({
    where:  { keyHash },
    select: { id: true, tenantId: true, scopes: true, revoked: true, expiresAt: true },
  })
  const valid = row && !row.revoked && (!row.expiresAt || row.expiresAt.getTime() > now)
  const identity: ApiKeyIdentity | null = valid
    ? { id: row.id, tenantId: row.tenantId, scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === 'string') : [] }
    : null

  if (_cache.size >= CACHE_MAX) _cache.clear()
  _cache.set(keyHash, { identity, checkedAt: now })

  if (identity && now - (_lastTouch.get(identity.id) ?? 0) > TOUCH_INTERVAL_MS) {
    _lastTouch.set(identity.id, now)
    prisma.apiKey.update({ where: { id: identity.id }, data: { lastUsedAt: new Date(now) } })
      .catch(err => log.warn('lastUsedAt update failed', { keyId: identity.id, err: err instanceof Error ? err.message : String(err) }))
  }
  return identity
}

/** Drops cached identities so a revocation takes effect immediately on this instance. */
export function invalidateApiKeyCache(): void {
  _cache.clear()
}
