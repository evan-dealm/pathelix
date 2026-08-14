import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    integration: {
      findMany:  vi.fn(),
      findFirst: vi.fn(),
      upsert:    vi.fn(),
      update:    vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    driver: {
      findMany: vi.fn((): Promise<{ id: string }[]> => Promise.resolve([])),
    },
    userPermission: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

const { getRequestContext } = vi.hoisted(() => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1' })),
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext,
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}))

vi.mock('@/lib/audit', () => ({ auditAsync: vi.fn() }))

function makeRequest(url: string, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  const init: Record<string, unknown> = { method: opts?.method ?? 'GET' }
  if (opts?.body) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'Content-Type': 'application/json', ...opts?.headers }
  }
  return new NextRequest(url, init)
}

describe('GET /api/integrations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns marketplace with configured integrations', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { id: 'int-1', type: 'slack', name: 'Slack', enabled: true, lastSyncAt: null, lastError: null, createdAt: new Date() },
    ])

    const { GET } = await import('@/app/api/integrations/route')
    const res = await GET(makeRequest('http://localhost:3000/api/integrations'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.marketplace).toBeDefined()
    expect(json.integrations).toHaveLength(1)
    expect(json.integrations[0].type).toBe('slack')
  })
})

describe('POST /api/integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRequestContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1' })
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', 'a'.repeat(64))
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('[SEC-C3] integration config is encrypted before storage (not plaintext)', async () => {
    mockPrisma.integration.upsert.mockResolvedValue({ id: 'int-1', type: 'here', name: 'HERE Truck Routing', enabled: true })

    const { POST } = await import('@/app/api/integrations/route')
    const req = makeRequest('http://localhost:3000/api/integrations', {
      method: 'POST',
      body: { type: 'here', config: { apiKey: 'supersecret-api-key-123' } },
    })
    await POST(req)

    const upsertCall = mockPrisma.integration.upsert.mock.calls[0][0]
    const storedConfig = upsertCall.create.config as Record<string, unknown>
    expect(storedConfig).not.toEqual({ apiKey: 'supersecret-api-key-123' })
    expect(storedConfig.v).toBe(1)
    expect(typeof storedConfig.iv).toBe('string')
    expect(typeof storedConfig.data).toBe('string')
  })

  it('creates/updates an integration (admin)', async () => {
    mockPrisma.integration.upsert.mockResolvedValue({
      id: 'int-new', type: 'slack', name: 'Slack', enabled: true,
    })

    const { POST } = await import('@/app/api/integrations/route')
    const req = makeRequest('http://localhost:3000/api/integrations', {
      method: 'POST',
      body: { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' }, enabled: true },
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockPrisma.integration.upsert).toHaveBeenCalled()
  })

  it('rejects unknown integration type', async () => {
    const { POST } = await import('@/app/api/integrations/route')
    const req = makeRequest('http://localhost:3000/api/integrations', {
      method: 'POST',
      body: { type: 'unknown_type', config: {} },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects non-admin role', async () => {
    getRequestContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'u', role: 'driver', requestId: 'r' })

    const { POST } = await import('@/app/api/integrations/route')
    const req = makeRequest('http://localhost:3000/api/integrations', {
      method: 'POST',
      body: { type: 'slack', config: {} },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  // Phase 0.1: configuring an integration (which can mean rotating a webhook secret / API key)
  // previously left no AuditLog trace. The secret/config VALUE must never be logged — only that
  // a config change happened.
  it('logs the integration change to the audit trail without leaking the secret value', async () => {
    mockPrisma.integration.upsert.mockResolvedValue({ id: 'int-1', type: 'here', name: 'HERE Truck Routing', enabled: true })

    const { POST } = await import('@/app/api/integrations/route')
    const { auditAsync } = await import('@/lib/audit')
    const req = makeRequest('http://localhost:3000/api/integrations', {
      method: 'POST',
      body: { type: 'here', config: { apiKey: 'supersecret-api-key-123' } },
    })
    await POST(req)

    expect(auditAsync).toHaveBeenCalledWith(
      expect.anything(), 'integration.configure', 'Integration', 'int-1',
      expect.objectContaining({ type: 'here', configChanged: true }),
    )
    const loggedDetails = JSON.stringify(vi.mocked(auditAsync).mock.calls[0])
    expect(loggedDetails).not.toContain('supersecret-api-key-123')
  })
})

describe('POST /api/integrations/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRequestContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'u', role: 'admin', requestId: 'r' })
  })

  it('validates Nessy secret format', async () => {
    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'nessy', config: { webhookSecret: 'short' } },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(json.message).toContain('trop court')
  })

  it('validates Nessy secret accepts long enough secret', async () => {
    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'nessy', config: { webhookSecret: 'a-very-long-secret-for-hmac-testing' } },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
  })

  it('blocks internal URLs (SSRF protection)', async () => {
    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'custom_webhook', config: { url: 'http://localhost:5432/admin' } },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(json.message).toContain('interne')
  })

  it('rejects non-admin role', async () => {
    getRequestContext.mockReturnValue({ tenantId: 'tenant-1', userId: 'u', role: 'dispatcher', requestId: 'r' })

    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'slack', config: {} },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('validates API key format for generic services', async () => {
    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'trimble', config: { apiKey: 'abc' } },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(json.message).toContain('trop courte')
  })

  it('accepts valid API key format', async () => {
    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'trimble', config: { apiKey: 'trimble_key_123456789' } },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
  })

  it('returns error for unknown type', async () => {
    const { POST } = await import('@/app/api/integrations/test/route')
    const req = makeRequest('http://localhost:3000/api/integrations/test', {
      method: 'POST',
      body: { type: 'nonexistent', config: {} },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(json.message).toContain('non supporte')
  })
})

describe('POST /api/webhooks/geotab', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects request without API key', async () => {
    const { POST } = await import('@/app/api/webhooks/geotab/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/geotab', {
      method: 'POST',
      body: [],
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects request with invalid API key', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', config: { apiKey: 'correct-key' } },
    ])

    const { POST } = await import('@/app/api/webhooks/geotab/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/geotab', {
      method: 'POST',
      body: [{ deviceId: 'd1', latitude: 45.76, longitude: 6.05, speed: 50 }],
      headers: { 'x-api-key': 'wrong-key' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when no integration matches API key', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([])

    const { POST } = await import('@/app/api/webhooks/geotab/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/geotab', {
      method: 'POST',
      body: [],
      headers: { 'x-api-key': 'some-key' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // Regression N15: decryptConfig() called directly inside the .find() predicate, uncaught — one
  // tenant's corrupted/undecryptable config (missing INTEGRATION_ENCRYPTION_KEY, tampered data)
  // threw out of .find() entirely, crashing auth for every OTHER tenant's valid Geotab
  // integration in the same batch, not just the broken one.
  it('skips a tenant whose config fails to decrypt and still matches a later valid integration', async () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', '') // forces getKey() to throw for the encrypted-shaped config
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-broken', config: { v: 1, iv: 'ab', tag: 'cd', data: 'ef' } },
      { tenantId: 'tenant-1',      config: { apiKey: 'good-key' } },
    ])

    const { POST } = await import('@/app/api/webhooks/geotab/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/geotab', {
      method: 'POST',
      body: [{ deviceId: 'd1', latitude: 45.76, longitude: 6.05, speed: 50 }],
      headers: { 'x-api-key': 'good-key' },
    })
    const res = await POST(req)
    expect(res.status).not.toBe(500)
    expect(res.status).toBe(200)
    vi.unstubAllEnvs()
  })

  // Regression: driverId (from Geotab deviceMapping or raw deviceId fallback) had no tenant
  // check before being written via recordOBDReading — a device mapped (accidentally or not) to
  // another tenant's driverId could overwrite that driver's live GPS position.
  it('skips a reading whose resolved driverId does not belong to this tenant', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', config: { apiKey: 'good-key' } },
    ])
    mockPrisma.driver.findMany.mockResolvedValue([]) // no driver in tenant-1 matches 'd1'

    const { POST } = await import('@/app/api/webhooks/geotab/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/geotab', {
      method: 'POST',
      body: [{ deviceId: 'd1', latitude: 45.76, longitude: 6.05, speed: 50 }],
      headers: { 'x-api-key': 'good-key' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.recorded).toBe(0)
  })

  it('records a reading whose resolved driverId belongs to this tenant', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', config: { apiKey: 'good-key' } },
    ])
    mockPrisma.driver.findMany.mockResolvedValue([{ id: 'd1' }])

    const { POST } = await import('@/app/api/webhooks/geotab/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/geotab', {
      method: 'POST',
      body: [{ deviceId: 'd1', latitude: 45.76, longitude: 6.05, speed: 50 }],
      headers: { 'x-api-key': 'good-key' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.recorded).toBe(1)
  })
})

describe('POST /api/webhooks/samsara', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects request without token', async () => {
    const { POST } = await import('@/app/api/webhooks/samsara/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/samsara', {
      method: 'POST',
      body: [],
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects request with invalid token', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', config: { apiToken: 'correct-token' } },
    ])

    const { POST } = await import('@/app/api/webhooks/samsara/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/samsara', {
      method: 'POST',
      body: [],
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // Regression N15: same uncaught decryptConfig() issue as Geotab (see equivalent test above).
  it('skips a tenant whose config fails to decrypt and still matches a later valid integration', async () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', '')
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-broken', config: { v: 1, iv: 'ab', tag: 'cd', data: 'ef' } },
      { tenantId: 'tenant-1',      config: { apiToken: 'good-token' } },
    ])

    const { POST } = await import('@/app/api/webhooks/samsara/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/samsara', {
      method: 'POST',
      body: [],
      headers: { Authorization: 'Bearer good-token' },
    })
    const res = await POST(req)
    // The point of this test is that auth succeeds despite tenant-broken's undecryptable config
    // (not 401/500) — not the exact shape of a valid Samsara payload, so don't over-assert there.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    vi.unstubAllEnvs()
  })

  // Regression: Samsara driverId comes straight from vehicle.name/vehicle.id/driverId in the
  // payload with no tenant check before recordOBDReading — same class of bug as the Geotab fix.
  it('skips an event whose driverId does not belong to this tenant', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', config: { apiToken: 'good-token' } },
    ])
    mockPrisma.driver.findMany.mockResolvedValue([])

    const { POST } = await import('@/app/api/webhooks/samsara/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/samsara', {
      method: 'POST',
      body: [{ driverId: 'driver-other-tenant', location: { latitude: 45.76, longitude: 6.05, speed: 50 } }],
      headers: { Authorization: 'Bearer good-token' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.recorded).toBe(0)
  })

  it('records an event whose driverId belongs to this tenant', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', config: { apiToken: 'good-token' } },
    ])
    mockPrisma.driver.findMany.mockResolvedValue([{ id: 'driver-1' }])

    const { POST } = await import('@/app/api/webhooks/samsara/route')
    const req = makeRequest('http://localhost:3000/api/webhooks/samsara', {
      method: 'POST',
      body: [{ driverId: 'driver-1', location: { latitude: 45.76, longitude: 6.05, speed: 50 } }],
      headers: { Authorization: 'Bearer good-token' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.recorded).toBe(1)
  })
})