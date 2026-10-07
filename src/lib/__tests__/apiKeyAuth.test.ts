import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: { apiKey: { findUnique, update } } }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import {
  scopeAllows,
  authenticateApiKey,
  apiKeyPermissions,
  isApiKeyRequest,
  invalidateApiKeyCache,
  hashApiKey,
} from '@/lib/apiKeyAuth'

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
    const all = [
      'missions:read',
      'missions:write',
      'drivers:read',
      'drivers:write',
      'optimize',
      'reports:read',
    ]
    for (const path of [
      '/api/users',
      '/api/api-keys',
      '/api/settings',
      '/api/audit',
      '/api/permissions',
    ]) {
      expect(scopeAllows(all, 'GET', path)).toBe(false)
      expect(scopeAllows(all, 'POST', path)).toBe(false)
    }
  })

  it('optimize covers every method under /api/optimize', () => {
    expect(scopeAllows(['optimize'], 'POST', '/api/optimize')).toBe(true)
    expect(scopeAllows(['optimize'], 'GET', '/api/optimize/job-1')).toBe(true)
  })
})

describe('scopeAllows — business resources', () => {
  it('each business scope covers its own routes, read and write apart', () => {
    expect(scopeAllows(['containers:read'], 'GET', '/api/containers/stats')).toBe(true)
    expect(scopeAllows(['containers:read'], 'GET', '/api/container-types')).toBe(true)
    expect(scopeAllows(['containers:read'], 'POST', '/api/containers/c1/relocate')).toBe(false)
    expect(scopeAllows(['containers:write'], 'POST', '/api/containers/c1/relocate')).toBe(true)
    expect(scopeAllows(['orders:write'], 'POST', '/api/orders/o1/missions')).toBe(true)
    expect(scopeAllows(['quotes:write'], 'POST', '/api/quotes/q1/convert')).toBe(true)
    expect(scopeAllows(['invoices:read'], 'GET', '/api/invoices/export')).toBe(true)
    expect(scopeAllows(['invoices:read'], 'POST', '/api/invoices/i1/issue')).toBe(false)
    expect(scopeAllows(['payments:write'], 'POST', '/api/payments')).toBe(true)
    expect(scopeAllows(['weighings:read'], 'GET', '/api/weighings')).toBe(true)
    expect(scopeAllows(['contracts:read'], 'GET', '/api/contracts/k1')).toBe(true)
  })

  it('a business scope opens nothing else', () => {
    expect(scopeAllows(['invoices:write'], 'POST', '/api/payments')).toBe(false)
    expect(scopeAllows(['orders:read'], 'GET', '/api/quotes')).toBe(false)
    expect(scopeAllows(['containers:write'], 'POST', '/api/container-types-admin')).toBe(false)
    expect(
      scopeAllows(['quotes:read', 'orders:read', 'invoices:read'], 'GET', '/api/price-lists'),
    ).toBe(false)
    expect(scopeAllows(['invoices:write'], 'POST', '/api/webhook-endpoints')).toBe(false)
  })

  // The invite answer carries a one-time link that opens a customer portal account.
  it('no key can invite or list portal users, whatever its scopes', () => {
    const all = ['clients:read', 'clients:write', 'invoices:write', 'optimize']
    expect(scopeAllows(all, 'POST', '/api/clients/c1/portal-users')).toBe(false)
    expect(scopeAllows(all, 'GET', '/api/clients/c1/portal-users')).toBe(false)
    expect(scopeAllows(all, 'POST', '/api/clients/c1/contacts')).toBe(true)
  })

  it('a scope named after an object built-in is ignored, not a crash', () => {
    expect(scopeAllows(['constructor:read', 'toString:write'], 'GET', '/api/missions')).toBe(false)
  })
})

describe('isApiKeyRequest', () => {
  it('recognises only the identity the middleware gives a key', () => {
    expect(isApiKeyRequest('apikey:k1')).toBe(true)
    expect(isApiKeyRequest('cmucc9nff00013snw00jwr2k4')).toBe(false)
    expect(isApiKeyRequest('sa:apikey:k1')).toBe(false)
    expect(isApiKeyRequest(undefined)).toBe(false)
  })
})

describe('apiKeyPermissions', () => {
  const RAW = 'ef_live_' + 'b'.repeat(64)
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateApiKeyCache()
    process.env.USE_MOCK_DATA = 'false'
  })
  afterEach(() => {
    delete process.env.USE_MOCK_DATA
  })

  it('billing scopes bring the billing permission; the others bring nothing extra', async () => {
    findUnique.mockResolvedValue({
      id: 'k-bill',
      tenantId: 't1',
      scopes: ['invoices:read', 'missions:write'],
      revoked: false,
      expiresAt: null,
    })
    await authenticateApiKey(RAW)
    expect([...(await apiKeyPermissions('k-bill'))]).toEqual(['manage_billing'])
    // Served from what the middleware just resolved: no second lookup.
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('reads the key when nothing is cached, and grants nothing to a key without billing scopes', async () => {
    findUnique.mockResolvedValue({
      scopes: ['missions:read', 'orders:write'],
      revoked: false,
      expiresAt: null,
    })
    expect((await apiKeyPermissions('k-ops')).size).toBe(0)
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'k-ops' } }))
  })

  it('a revoked, expired or unknown key grants nothing', async () => {
    findUnique.mockResolvedValue({ scopes: ['invoices:write'], revoked: true, expiresAt: null })
    expect((await apiKeyPermissions('k1')).size).toBe(0)
    findUnique.mockResolvedValue({
      scopes: ['invoices:write'],
      revoked: false,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect((await apiKeyPermissions('k2')).size).toBe(0)
    findUnique.mockResolvedValue(null)
    expect((await apiKeyPermissions('k3')).size).toBe(0)
  })
})

describe('authenticateApiKey', () => {
  const RAW = 'ef_live_' + 'a'.repeat(64)
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateApiKeyCache()
    process.env.USE_MOCK_DATA = 'false'
  })
  afterEach(() => {
    delete process.env.USE_MOCK_DATA
  })

  it('resolves a valid key by its hash', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      tenantId: 't1',
      scopes: ['missions:read'],
      revoked: false,
      expiresAt: null,
    })
    expect(await authenticateApiKey(RAW)).toEqual({
      id: 'k1',
      tenantId: 't1',
      scopes: ['missions:read'],
    })
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash: hashApiKey(RAW) } }),
    )
  })

  it('rejects revoked and expired keys', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      tenantId: 't1',
      scopes: [],
      revoked: true,
      expiresAt: null,
    })
    expect(await authenticateApiKey(RAW)).toBeNull()
    invalidateApiKeyCache()
    findUnique.mockResolvedValue({
      id: 'k1',
      tenantId: 't1',
      scopes: [],
      revoked: false,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await authenticateApiKey(RAW)).toBeNull()
  })

  it('rejects malformed keys without a DB lookup, and is disabled in mock mode', async () => {
    expect(await authenticateApiKey('nope')).toBeNull()
    process.env.USE_MOCK_DATA = 'true'
    expect(await authenticateApiKey(RAW)).toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('caches lookups until invalidated (revocation)', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      tenantId: 't1',
      scopes: [],
      revoked: false,
      expiresAt: null,
    })
    await authenticateApiKey(RAW)
    await authenticateApiKey(RAW)
    expect(findUnique).toHaveBeenCalledTimes(1)
    invalidateApiKeyCache()
    await authenticateApiKey(RAW)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })
})
