import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  apiKey: {
    findMany: vi.fn(),
    create:   vi.fn(),
  },
  userPermission: {
    findMany: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { GET, POST } from '@/app/api/api-keys/route'
import { getRequestContext } from '@/lib/data/context'

function makeGet(url: string): NextRequest {
  return new NextRequest(url)
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('GET /api/api-keys', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns api keys list for admin (200)', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([
      { id: 'k-1', name: 'CI Key', prefix: 'ef_live_abc', scopes: ['missions:read'], lastUsedAt: null, expiresAt: null, createdAt: new Date() },
    ])
    const res  = await GET(makeGet('http://localhost/api/api-keys'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
    expect(json[0].name).toBe('CI Key')
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await GET(makeGet('http://localhost/api/api-keys'))
    expect(res.status).toBe(403)
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'driver', requestId: 'req-1', trade: null })
    const res = await GET(makeGet('http://localhost/api/api-keys'))
    expect(res.status).toBe(403)
  })

  it('returns empty array when no keys', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'admin', requestId: 'req-1', trade: null })
    mockPrisma.apiKey.findMany.mockResolvedValue([])
    const res  = await GET(makeGet('http://localhost/api/api-keys'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toHaveLength(0)
  })
})

describe('POST /api/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('creates API key and returns token once (201)', async () => {
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'k-new', name: 'Test Key', prefix: 'ef_live_abc', scopes: ['missions:read'], expiresAt: null, createdAt: new Date(),
    })
    const res  = await POST(makePost({ name: 'Test Key', scopes: ['missions:read'] }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.name).toBe('Test Key')
    expect(json.token).toBeDefined()
    expect(json.token).toMatch(/^ef_live_/)
    expect(json.message).toContain('Copiez')
  })

  it('creates key with expiry when expiresInDays provided', async () => {
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'k-2', name: 'Expiring Key', prefix: 'ef_live_xyz', scopes: ['missions:write'], expiresAt: new Date(), createdAt: new Date(),
    })
    const res  = await POST(makePost({ name: 'Expiring Key', scopes: ['missions:write'], expiresInDays: 30 }))
    expect(res.status).toBe(201)
    expect(mockPrisma.apiKey.create.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await POST(makePost({ name: 'Key', scopes: ['missions:read'] }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for missing name', async () => {
    const res = await POST(makePost({ scopes: ['missions:read'] }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for empty scopes', async () => {
    const res = await POST(makePost({ name: 'Key', scopes: [] }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for expiresInDays > 365', async () => {
    const res = await POST(makePost({ name: 'Key', scopes: ['missions:read'], expiresInDays: 400 }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid scope', async () => {
    const res = await POST(makePost({ name: 'Key', scopes: ['read'] }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/api-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
