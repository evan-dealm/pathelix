import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── session.ts ───────────────────────────────────────────────────────────────

describe('verifySession hardening', () => {
  beforeEach(() => { vi.stubEnv('SESSION_SECRET', 'x'.repeat(40)) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('rejects a legacy tracking link token (sub "track:…") even though it is correctly signed', async () => {
    const { signSession, verifySession } = await import('@/lib/session')
    const token = await signSession({ sub: 'track:m1', role: 'driver', tenantId: 'tenant-abc' })
    expect(await verifySession(token)).toBeNull()
  })

  it('carries the session version (sv) through sign/verify', async () => {
    const { signSession, verifySession } = await import('@/lib/session')
    const token = await signSession({ sub: 'u1', role: 'admin', tenantId: 'tenant-abc', sv: 3 })
    expect((await verifySession(token))?.sv).toBe(3)
  })

  it('rejects a token without exp', async () => {
    const { signSession, verifySession } = await import('@/lib/session')
    const valid = await signSession({ sub: 'u1', role: 'admin', tenantId: 'tenant-abc' })
    const [h, b] = valid.split('.')
    const body = JSON.parse(Buffer.from(b, 'base64url').toString())
    delete body.exp
    const forgedBody = Buffer.from(JSON.stringify(body)).toString('base64url')
    // Re-sign properly so only the missing exp is under test.
    const { createHmac } = await import('node:crypto')
    const sig = createHmac('sha256', 'x'.repeat(40)).update(`${h}.${forgedBody}`).digest('base64url')
    expect(await verifySession(`${h}.${forgedBody}.${sig}`)).toBeNull()
  })
})

// ─── sessionRevocation.ts ─────────────────────────────────────────────────────

const mockUserFindUnique = vi.hoisted(() => vi.fn())
const mockUserUpdateMany = vi.hoisted(() => vi.fn(async () => ({ count: 1 })))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany } },
}))

describe('isSessionCurrent', () => {
  beforeEach(() => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    mockUserFindUnique.mockReset()
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('accepts a token whose sv matches the user', async () => {
    const { isSessionCurrent } = await import('@/lib/sessionRevocation')
    mockUserFindUnique.mockResolvedValueOnce({ sessionVersion: 2 })
    expect(await isSessionCurrent({ sub: 'u1', role: 'admin', tenantId: 't', sv: 2 })).toBe(true)
  })

  it('rejects a token issued before a password/role change', async () => {
    const { isSessionCurrent } = await import('@/lib/sessionRevocation')
    mockUserFindUnique.mockResolvedValueOnce({ sessionVersion: 3 })
    expect(await isSessionCurrent({ sub: 'u1', role: 'admin', tenantId: 't', sv: 2 })).toBe(false)
  })

  it('rejects the session of a deleted user', async () => {
    const { isSessionCurrent } = await import('@/lib/sessionRevocation')
    mockUserFindUnique.mockResolvedValueOnce(null)
    expect(await isSessionCurrent({ sub: 'gone', role: 'driver', tenantId: 't' })).toBe(false)
  })

  it('resolves an impersonation session (sa:<id>) to the superadmin', async () => {
    const { isSessionCurrent } = await import('@/lib/sessionRevocation')
    mockUserFindUnique.mockResolvedValueOnce({ sessionVersion: 0 })
    await isSessionCurrent({ sub: 'sa:root', role: 'admin', tenantId: 't' })
    expect(mockUserFindUnique.mock.calls[0][0].where).toEqual({ id: 'root' })
  })

  it('revokeUserSessions takes effect immediately on this instance (cache dropped)', async () => {
    const { isSessionCurrent, revokeUserSessions } = await import('@/lib/sessionRevocation')
    mockUserFindUnique.mockResolvedValueOnce({ sessionVersion: 0 })
    expect(await isSessionCurrent({ sub: 'u1', role: 'admin', tenantId: 't', sv: 0 })).toBe(true)
    await revokeUserSessions('u1')
    mockUserFindUnique.mockResolvedValueOnce({ sessionVersion: 1 })
    expect(await isSessionCurrent({ sub: 'u1', role: 'admin', tenantId: 't', sv: 0 })).toBe(false)
  })
})

// ─── driverAccess.ts ──────────────────────────────────────────────────────────

describe('canActForDriver / planContainsMission', () => {
  it('lets staff of the tenant and the driver itself act, nobody else', async () => {
    const { canActForDriver } = await import('@/lib/driverAccess')
    expect(canActForDriver({ role: 'dispatcher', tenantId: 't1', sub: 'u' }, 'd1', 't1')).toBe(true)
    expect(canActForDriver({ role: 'driver', tenantId: 't1', sub: 'u', driverRef: 'd1' }, 'd1', 't1')).toBe(true)
    expect(canActForDriver({ role: 'driver', tenantId: 't1', sub: 'u', driverRef: 'd2' }, 'd1', 't1')).toBe(false)
    expect(canActForDriver({ role: 'admin', tenantId: 't2', sub: 'u' }, 'd1', 't1')).toBe(false)
  })

  it('reads the plan missions whether stored as JSON array or string', async () => {
    const { planContainsMission } = await import('@/lib/driverAccess')
    const db = (missions: unknown) => ({ plan: { findFirst: async () => ({ missions }) } }) as never
    expect(await planContainsMission(db([{ id: 'm1' }]), 'd1', '2026-01-01', 'm1')).toBe(true)
    expect(await planContainsMission(db(JSON.stringify([{ id: 'm1' }])), 'd1', '2026-01-01', 'm1')).toBe(true)
    expect(await planContainsMission(db([{ id: 'm2' }]), 'd1', '2026-01-01', 'm1')).toBe(false)
    expect(await planContainsMission({ plan: { findFirst: async () => null } } as never, 'd1', '2026-01-01', 'm1')).toBe(false)
  })
})

// ─── pushEndpoints.ts ─────────────────────────────────────────────────────────

describe('isAllowedPushEndpoint', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['https://web.push.apple.com/abc', true],
    ['https://wns2-par02p.notify.windows.com/w/?token=x', true],
    ['http://fcm.googleapis.com/fcm/send/abc', false],
    ['https://fcm.googleapis.com:8443/x', false],
    ['https://fcm.googleapis.com.attacker.net/x', false],
    ['https://127.0.0.1/x', false],
    ['https://localhost/x', false],
    ['not a url', false],
  ])('%s → %s', async (url, expected) => {
    const { isAllowedPushEndpoint } = await import('@/lib/pushEndpoints')
    expect(isAllowedPushEndpoint(url)).toBe(expected)
  })
})

// ─── uploadStorage.ts ─────────────────────────────────────────────────────────

describe('uploadStorage', () => {
  it('detects the real format from the bytes', async () => {
    const { detectImageExt } = await import('@/lib/uploadStorage')
    expect(detectImageExt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(detectImageExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png')
    expect(detectImageExt(new Uint8Array(Buffer.from('RIFF0000WEBPVP8 ')))).toBe('webp')
    expect(detectImageExt(new Uint8Array(Buffer.from('<svg onload=alert(1)>')))).toBeNull()
  })

  it('refuses path segments that could escape the tenant directory', async () => {
    const { resolveUploadPath, isSafeSegment } = await import('@/lib/uploadStorage')
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '', '.hidden']) expect(isSafeSegment(bad)).toBe(false)
    expect(() => resolveUploadPath('t1', 'photos', '../../etc/passwd')).toThrow()
    expect(() => resolveUploadPath('../t2', 'photos', 'x.jpg')).toThrow()
  })

  it('stores outside public/ by default and honours UPLOAD_DIR', async () => {
    const { resolveUploadPath } = await import('@/lib/uploadStorage')
    expect(resolveUploadPath('t1', 'photos', 'a.jpg').replace(/\\/g, '/')).toMatch(/data\/uploads\/t1\/photos\/a\.jpg$/)
    vi.stubEnv('UPLOAD_DIR', '/srv/pathelix-files')
    expect(resolveUploadPath('t1', 'proofs', 'p.png').replace(/\\/g, '/')).toMatch(/\/srv\/pathelix-files\/t1\/proofs\/p\.png$/)
    vi.unstubAllEnvs()
  })
})
