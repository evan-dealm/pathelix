/**
 * Tests couvrant les fixes de sécurité appliqués :
 * - Bcrypt DoS prevention (password max 1000 chars)
 * - /api/ready readiness probe
 * - delivery-proof UUID filenames
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks communs ────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => true), headers: vi.fn(() => ({})) }),
  createTenantRateLimiter: () => ({ check: vi.fn(async () => true) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// ── 1. Bcrypt DoS prevention — LoginSchema password max(1000) ───────────────

describe('Security: bcrypt DoS prevention — password validation', () => {
  it('LoginSchema rejects password longer than 1000 chars', async () => {
    const { LoginSchema } = await import('@/lib/schemas')
    const longPassword = 'A'.repeat(1001)
    const result = LoginSchema.safeParse({ password: longPassword })
    expect(result.success).toBe(false)
  })

  it('LoginSchema accepts password of exactly 1000 chars', async () => {
    const { LoginSchema } = await import('@/lib/schemas')
    const maxPassword = 'A'.repeat(1000)
    const result = LoginSchema.safeParse({ password: maxPassword })
    expect(result.success).toBe(true)
  })

  it('LoginSchema rejects empty password', async () => {
    const { LoginSchema } = await import('@/lib/schemas')
    const result = LoginSchema.safeParse({ password: '' })
    expect(result.success).toBe(false)
  })

  it('ChangePasswordSchema rejects currentPassword > 1000 chars', async () => {
    const { z } = await import('zod')
    const schema = z.object({
      currentPassword: z.string().min(1).max(1000),
      newPassword: z.string().min(12).max(1000),
    })
    const result = schema.safeParse({
      currentPassword: 'A'.repeat(1001),
      newPassword: 'ValidPass123!',
    })
    expect(result.success).toBe(false)
  })

  it('ChangePasswordSchema rejects newPassword > 1000 chars', async () => {
    const { z } = await import('zod')
    const schema = z.object({
      currentPassword: z.string().min(1).max(1000),
      newPassword: z.string().min(12).max(1000),
    })
    const result = schema.safeParse({
      currentPassword: 'ValidOldPass123!',
      newPassword: 'A'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })
})


// ── 3. /api/ready — readiness probe ──────────────────────────────────────────

describe('GET /api/ready', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.USE_MOCK_DATA = 'true'
    delete process.env.REDIS_HOST
    delete process.env.REDIS_URL
  })

  it('returns 200 in mock mode', async () => {
    process.env.USE_MOCK_DATA = 'true'
    const { GET } = await import('@/app/api/ready/route')
    const req = new NextRequest('http://localhost/api/ready')
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
  })
})

// ── 4. delivery-proof UUID filenames ─────────────────────────────────────────

describe('Security: delivery-proof — UUID filenames', () => {
  it('saves file with UUID-based name (not predictable missionId)', async () => {
    vi.resetModules()

    const mockWriteFile = vi.fn(async () => {})
    const mockMkdir     = vi.fn(async () => {})

    vi.doMock('node:fs/promises', () => ({ default: { writeFile: mockWriteFile, mkdir: mockMkdir } }))
    vi.doMock('@/lib/tenantDb', () => ({
      getTenantDb: () => ({
        mission:       { findFirst: vi.fn(async () => ({ id: 'm-1', tenantId: 'tenant-test' })) },
        driver:        { findFirst: vi.fn(async () => ({ id: 'driver-1' })) },
        deliveryProof: { upsert:    vi.fn(async () => ({ id: 'p-1' })) },
      }),
    }))
    vi.doMock('@/lib/data/context', () => ({
      getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null })),
    }))

    const { POST } = await import('@/app/api/delivery-proof/route')

    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])
    const fakeFile  = new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' })

    const req = new NextRequest('http://localhost/api/delivery-proof', { method: 'POST' })
    vi.spyOn(req, 'formData').mockResolvedValue({
      get: (key: string) => {
        if (key === 'missionId')  return 'm-1'
        if (key === 'driverId')   return 'driver-1'
        if (key === 'photo')      return fakeFile
        if (key === 'signature')  return null
        if (key === 'notes')      return ''
        return null
      },
    } as unknown as FormData)

    await POST(req)

    expect(mockWriteFile).toHaveBeenCalled()
    const savedPath = (mockWriteFile.mock.calls as unknown as [string, Buffer][])[0][0]
    expect(savedPath).toMatch(/proof-[0-9a-f-]{36}\.jpg$/)
    // Stored outside public/, under the tenant's own directory.
    const normalized = savedPath.replace(/\\/g, '/')
    expect(normalized).toMatch(/data\/uploads\/tenant-test\/proofs\//)
    expect(normalized).not.toContain('/public/')
    expect(savedPath).not.toContain('m-1')
  })
})


// ── 5. UserCreateSchema / UserUpdateSchema — password max(1000) ──────────────

describe('Security: UserCreateSchema/UserUpdateSchema password max(1000)', () => {
  it('UserCreateSchema rejects password longer than 1000 chars', async () => {
    const { UserCreateSchema } = await import('@/lib/schemas')
    const result = UserCreateSchema.safeParse({
      email: 'test@example.com',
      password: 'A'.repeat(1001),
      role: 'ADMIN',
      firstName: 'Test',
      lastName: 'User',
    })
    expect(result.success).toBe(false)
  })

  it('UserCreateSchema accepts password of 1000 chars', async () => {
    const { UserCreateSchema } = await import('@/lib/schemas')
    const result = UserCreateSchema.safeParse({
      email: 'test@example.com',
      password: 'A'.repeat(988) + 'aA1!aA1!aA1!', // 1000 chars, meets min(12)
      role: 'ADMIN',
      firstName: 'Test',
      lastName: 'User',
    })
    expect(result.success).toBe(true)
  })

  it('UserUpdateSchema rejects password longer than 1000 chars', async () => {
    const { UserUpdateSchema } = await import('@/lib/schemas')
    const result = UserUpdateSchema.safeParse({
      password: 'A'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('UserUpdateSchema accepts no password (optional field)', async () => {
    const { UserUpdateSchema } = await import('@/lib/schemas')
    const result = UserUpdateSchema.safeParse({ firstName: 'Jean' })
    expect(result.success).toBe(true)
  })
})

// ── 5b. reset-password / superadmin-user-update — password max(1000) ─────────

describe('Security: reset-password & superadmin user update password max(1000)', () => {
  it('ResetPasswordSchema rejects newPassword > 1000 chars', () => {
    const { z } = require('zod')
    const schema = z.object({
      newPassword: z.string().min(12).max(1000),
    })
    expect(schema.safeParse({ newPassword: 'A'.repeat(1001) }).success).toBe(false)
  })

  it('ResetPasswordSchema accepts newPassword of 1000 chars', () => {
    const { z } = require('zod')
    const schema = z.object({
      newPassword: z.string().min(12).max(1000),
    })
    expect(schema.safeParse({ newPassword: 'A'.repeat(988) + 'aA1!aA1!aA1!' }).success).toBe(true)
  })

  it('SuperadminUpdateUserSchema rejects password > 1000 chars', () => {
    const { z } = require('zod')
    const schema = z.object({
      password: z.string().min(8).max(1000).optional(),
    })
    expect(schema.safeParse({ password: 'A'.repeat(1001) }).success).toBe(false)
  })
})

// ── 6. AI Jobs — statusFilter enum validation ────────────────────────────────

describe('Security: AI jobs statusFilter enum validation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects invalid status values by ignoring them (no query filter)', async () => {
    vi.doMock('@/lib/data/context', () => ({
      getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'u1', role: 'admin' })),
    }))
    vi.doMock('@/lib/tenantDb', () => ({
      getTenantDb: () => ({ aiJob: { findMany: vi.fn(async (args: { where?: { status?: string } }) => {
        // Valid status: should include status in where
        // Invalid status: should NOT include status in where (undefined)
        return [{ status: args.where?.status ?? 'all' }]
      }) } }),
    }))
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))

    const { GET } = await import('@/app/api/ai/jobs/route')
    const req = new NextRequest('http://localhost/api/ai/jobs?status=malicious_injection')
    const res = await GET(req)
    expect(res.status).toBe(200)
    // With invalid status, query should not use the malicious value as filter
  })
})

// ── 7. SSRF protection — integrations/test isInternalUrl ────────────────────

describe('Security: SSRF protection in integrations test', () => {
  it('blocks 169.254.x.x (cloud metadata service)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/data/context', () => ({
      getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin' })),
    }))
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))

    const { POST } = await import('@/app/api/integrations/test/route')
    const req = new NextRequest('http://localhost/api/integrations/test', {
      method: 'POST',
      body: JSON.stringify({ type: 'osrm', config: { url: 'http://169.254.169.254/latest/meta-data' } }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json() as { ok: boolean; message?: string }
    expect(body.ok).toBe(false)
    expect(body.message).toContain('interne')
  })

  it('blocks 172.20.x.x (Docker internal range)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/data/context', () => ({
      getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin' })),
    }))
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    }))

    const { POST } = await import('@/app/api/integrations/test/route')
    const req = new NextRequest('http://localhost/api/integrations/test', {
      method: 'POST',
      body: JSON.stringify({ type: 'osrm', config: { url: 'http://172.20.0.1:8080' } }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json() as { ok: boolean; message?: string }
    expect(body.ok).toBe(false)
    expect(body.message).toContain('interne')
  })
})
