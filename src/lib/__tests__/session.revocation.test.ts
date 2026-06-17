process.env.SESSION_SECRET = 'test-revocation-secret-32-chars!!'

import { describe, it, expect, beforeEach } from 'vitest'
import {
  signSession,
  verifySession,
  revokeSessionsForTenant,
  unrevokeSessionsForTenant,
} from '@/lib/session'

beforeEach(() => {
  // Ensure tenants used in tests are not revoked at start
  unrevokeSessionsForTenant('tenant-revoke-1')
  unrevokeSessionsForTenant('tenant-revoke-2')
  unrevokeSessionsForTenant('tenant-toggle')
  unrevokeSessionsForTenant('tenant-super')
})

describe('revokeSessionsForTenant', () => {
  it('revoked tenant session is rejected', async () => {
    const token = await signSession({ sub: 'u-1', role: 'admin', tenantId: 'tenant-revoke-1' })
    revokeSessionsForTenant('tenant-revoke-1')
    expect(await verifySession(token)).toBeNull()
    unrevokeSessionsForTenant('tenant-revoke-1')
  })

  it('superadmin is NOT affected by tenant revocation', async () => {
    const token = await signSession({ sub: 'sa-1', role: 'superadmin', tenantId: 'tenant-revoke-2' })
    revokeSessionsForTenant('tenant-revoke-2')
    const payload = await verifySession(token)
    expect(payload).not.toBeNull()
    expect(payload!.role).toBe('superadmin')
    unrevokeSessionsForTenant('tenant-revoke-2')
  })

  it('unrevoke restores access for non-superadmin', async () => {
    revokeSessionsForTenant('tenant-toggle')
    unrevokeSessionsForTenant('tenant-toggle')
    const token = await signSession({ sub: 'u-2', role: 'driver', tenantId: 'tenant-toggle' })
    expect(await verifySession(token)).not.toBeNull()
  })

  it('non-revoked tenants are unaffected', async () => {
    revokeSessionsForTenant('tenant-revoke-1')
    const token = await signSession({ sub: 'u-3', role: 'dispatcher', tenantId: 'tenant-unrelated' })
    expect(await verifySession(token)).not.toBeNull()
    unrevokeSessionsForTenant('tenant-revoke-1')
    unrevokeSessionsForTenant('tenant-unrelated')
  })
})

describe('verifySession — tenantId format validation', () => {
  it('rejects tenantId longer than 64 chars', async () => {
    const longId = 'a'.repeat(65)
    const token  = await signSession({ sub: 'u-1', role: 'admin', tenantId: longId })
    expect(await verifySession(token)).toBeNull()
  })

  it('rejects tenantId with spaces', async () => {
    const token = await signSession({ sub: 'u-1', role: 'admin', tenantId: 'tenant with space' })
    expect(await verifySession(token)).toBeNull()
  })

  it('rejects tenantId with special chars (@)', async () => {
    const token = await signSession({ sub: 'u-1', role: 'admin', tenantId: 'tenant@evil.com' })
    expect(await verifySession(token)).toBeNull()
  })

  it('accepts tenantId with hyphens and underscores', async () => {
    const token = await signSession({ sub: 'u-1', role: 'admin', tenantId: 'valid-tenant_id-123' })
    expect(await verifySession(token)).not.toBeNull()
    unrevokeSessionsForTenant('valid-tenant_id-123')
  })
})

describe('verifySession — clock skew rejection', () => {
  it('rejects token with iat more than 60s in the future', async () => {
    const realNow = Date.now
    Date.now = () => realNow() + 300_000  // sign 5 minutes in the future

    const token = await signSession({ sub: 'u-1', role: 'admin', tenantId: 'tenant-future' })

    Date.now = realNow  // restore real time before verifying

    // iat = nowReal + 300s → iat > nowReal + 60s → clock skew rejection
    const payload = await verifySession(token)
    expect(payload).toBeNull()
    unrevokeSessionsForTenant('tenant-future')
  })
})
