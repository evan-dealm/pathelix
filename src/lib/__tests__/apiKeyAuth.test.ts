import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: { apiKey: { findUnique, update } } }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

import { scopeAllows, authenticateApiKey, invalidateApiKeyCache, hashApiKey } from '@/lib/apiKeyAuth'

describe('scopeAllows — deny by default', () => {
  it('read scope covers GET only, on its own resource', () => {
    expect(scopeAllows(['missions:read'], 'GET', '/api/missions')).toBe(true)
    expect(scopeAllows(['missions:read'], 'GET', '/api/missions/abc')).toBe(true)
    expect(scopeAllows(['missions:read'], 'POST', '/api/missions')).toBe(false)
    expect(scopeAllows(['missions:read'], 'GET', '/api/drivers')).toBe(false)
  })

  it('write scope covers mutations only', () => {
    expect(scopeAllows(['drivers:write'], 'PUT', '/api/drivers/1')).toBe(true)
    expect(scopeAllows(['drivers:write'], 'GET', '/api/drivers')).toBe(false)
  })

  it('never matches a lookalike prefix or an uncovered route', () => {
    expect(scopeAllows(['missions:read'], 'GET', '/api/missions-export')).toBe(false)
    const all = ['missions:read', 'missions:write', 'drivers:read', 'drivers:write', 'optimize', 'reports:read']
    for (const path of ['/api/users', '/api/api-keys', '/api/settings', '/api/audit', '/api/permissions']) {
      expect(scopeAllows(all, 'GET', path)).toBe(false)
      expect(scopeAllows(all, 'POST', path)).toBe(false)
    }
  })

  it('optimize covers every method under /api/optimize', () => {
    expect(scopeAllows(['optimize'], 'POST', '/api/optimize')).toBe(true)
    expect(scopeAllows(['optimize'], 'GET', '/api/optimize/job-1')).toBe(true)
  })
})

describe('authenticateApiKey', () => {
  const RAW = 'ef_live_' + 'a'.repeat(64)
  beforeEach(() => { vi.clearAllMocks(); invalidateApiKeyCache(); process.env.USE_MOCK_DATA = 'false' })
  afterEach(() => { delete process.env.USE_MOCK_DATA })

  it('resolves a valid key by its hash', async () => {
    findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', scopes: ['missions:read'], revoked: false, expiresAt: null })
    expect(await authenticateApiKey(RAW)).toEqual({ id: 'k1', tenantId: 't1', scopes: ['missions:read'] })
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { keyHash: hashApiKey(RAW) } }))
  })

  it('rejects revoked and expired keys', async () => {
    findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', scopes: [], revoked: true, expiresAt: null })
    expect(await authenticateApiKey(RAW)).toBeNull()
    invalidateApiKeyCache()
    findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', scopes: [], revoked: false, expiresAt: new Date(Date.now() - 1000) })
    expect(await authenticateApiKey(RAW)).toBeNull()
  })

  it('rejects malformed keys without a DB lookup, and is disabled in mock mode', async () => {
    expect(await authenticateApiKey('nope')).toBeNull()
    process.env.USE_MOCK_DATA = 'true'
    expect(await authenticateApiKey(RAW)).toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('caches lookups until invalidated (revocation)', async () => {
    findUnique.mockResolvedValue({ id: 'k1', tenantId: 't1', scopes: [], revoked: false, expiresAt: null })
    await authenticateApiKey(RAW)
    await authenticateApiKey(RAW)
    expect(findUnique).toHaveBeenCalledTimes(1)
    invalidateApiKeyCache()
    await authenticateApiKey(RAW)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })
})
