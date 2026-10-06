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
    // The version cache lives on globalThis (shared by middleware and route bundles), so a module
    // reset no longer clears it — drop it explicitly to keep tests independent.
    delete (globalThis as { __pathelixSessionVersionCache?: unknown }).__pathelixSessionVersionCache
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

// ─── outboundUrl.ts ───────────────────────────────────────────────────────────

describe('SSRF guard (outboundUrl)', () => {
  it.each([
    ['127.0.0.1', true], ['127.0.0.2', true], ['10.1.2.3', true], ['172.20.0.5', true],
    ['192.168.1.1', true], ['169.254.169.254', true], ['100.64.1.1', true], ['0.0.0.0', true],
    ['::1', true], ['::ffff:127.0.0.1', true], ['fd12:3456::1', true], ['fe80::1', true],
    ['8.8.8.8', false], ['2a00:1450:4007:80e::200e', false],
  ])('isPrivateAddress(%s) = %s', async (ip, expected) => {
    const { isPrivateAddress } = await import('@/lib/outboundUrl')
    expect(isPrivateAddress(ip)).toBe(expected)
  })

  it.each([
    'http://127.0.0.1:6379/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://169.254.169.254/latest/meta-data',
    'file:///etc/passwd', 'gopher://x/', 'http://user:pw@8.8.8.8/',
  ])('assertPublicUrl rejects %s', async (url) => {
    const { assertPublicUrl } = await import('@/lib/outboundUrl')
    await expect(assertPublicUrl(url)).rejects.toThrow()
  })

  it('accepts a public IP literal and an explicitly allowed internal host', async () => {
    const { assertPublicUrl } = await import('@/lib/outboundUrl')
    await expect(assertPublicUrl('https://8.8.8.8/x')).resolves.toBeInstanceOf(URL)
    vi.stubEnv('OUTBOUND_ALLOWED_HOSTS', 'osrm, valhalla')
    await expect(assertPublicUrl('http://osrm:5000/route')).resolves.toBeInstanceOf(URL)
    vi.unstubAllEnvs()
  })
})

// ─── tenantRefs.ts ────────────────────────────────────────────────────────────

describe('assertTenantRefs', () => {
  const dbWith = (known: Record<string, string[]>) => new Proxy({}, {
    get: (_t, model: string) => ({
      findFirst: async ({ where }: { where: { id: string } }) => (known[model] ?? []).includes(where.id) ? { id: where.id } : null,
      count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter(id => (known[model] ?? []).includes(id)).length,
    }),
  }) as never

  it('accepts references that exist in the tenant and ignores unset/cleared ones', async () => {
    const { assertTenantRefs } = await import('@/lib/tenantRefs')
    await expect(assertTenantRefs(dbWith({ client: ['c1'], exutoire: ['e1'] }), {
      clientId: 'c1', linkedExutoireId: 'e1', siteId: null, productId: '',
    })).resolves.toBeUndefined()
  })

  it.each([
    ['clientId', 'client'], ['siteId', 'site'], ['productId', 'siteProduct'], ['linkedExutoireId', 'exutoire'],
    ['dependsOnId', 'mission'], ['driverId', 'driver'], ['defaultExutoireId', 'exutoire'],
  ])('rejects a %s that is not in the tenant (another tenant\'s id)', async (field) => {
    const { assertTenantRefs, ForeignTenantRefError } = await import('@/lib/tenantRefs')
    await expect(assertTenantRefs(dbWith({}), { [field]: 'foreign-id' })).rejects.toBeInstanceOf(ForeignTenantRefError)
  })

  it('assertTenantDrivers rejects a batch containing one foreign driver', async () => {
    const { assertTenantDrivers } = await import('@/lib/tenantRefs')
    await expect(assertTenantDrivers(dbWith({ driver: ['d1', 'd2'] }), ['d1', 'd2', 'd1'])).resolves.toBeUndefined()
    await expect(assertTenantDrivers(dbWith({ driver: ['d1'] }), ['d1', 'other-tenant-driver'])).rejects.toThrow()
  })
})
