import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', role: 'admin' })),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/apiError', () => ({
  handleApiError: vi.fn(() => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })),
}))
vi.mock('@/lib/trackdechets/crypto', () => ({
  encryptToken: vi.fn(() => ({ encryptedToken: 'enc-tok', iv: '001122334455', keyVersion: 1 })),
  decryptToken: vi.fn(() => 'plain-token'),
}))

const mockGetRequestContext = vi.mocked(
  (await import('@/lib/data/context')).getRequestContext,
)

const mockFindUnique  = vi.hoisted(() => vi.fn())
const mockUpsert      = vi.hoisted(() => vi.fn())
const mockDelete      = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    trackdechetsAccount: {
      findUnique: mockFindUnique,
      upsert:     mockUpsert,
      delete:     mockDelete,
    },
  },
}))

function makeReq(method = 'GET', body?: unknown): NextRequest {
  const url = new URL('http://localhost/api/trackdechets/accounts')
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

// ─── Mock mode (USE_MOCK_DATA default ON) ─────────────────────────────────────

describe('GET /api/trackdechets/accounts — mock mode', () => {
  it('returns configured:true mock response', async () => {
    const { GET } = await import('@/app/api/trackdechets/accounts/route')
    const res  = await GET(makeReq('GET'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.configured).toBe(true)
    expect(body.accountId).toBe('mock-td-account')
  })
})

describe('POST /api/trackdechets/accounts — mock mode', () => {
  it('returns ok:true without hitting DB', async () => {
    const { POST } = await import('@/app/api/trackdechets/accounts/route')
    const res  = await POST(makeReq('POST', { token: 'a'.repeat(20) }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects non-admin role', async () => {
    mockGetRequestContext.mockReturnValueOnce({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'driver' })
    const { POST } = await import('@/app/api/trackdechets/accounts/route')
    const res = await POST(makeReq('POST', { token: 'a'.repeat(20) }))
    expect(res.status).toBe(403)
  })
})

// ─── Real mode ────────────────────────────────────────────────────────────────

describe('GET /api/trackdechets/accounts — real mode', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ GET } = await import('@/app/api/trackdechets/accounts/route'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns configured:true when account exists', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1' })
    const res  = await GET(makeReq('GET'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.configured).toBe(true)
    expect(body.accountId).toBe('acc-1')
  })

  it('returns configured:false when no account', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const res  = await GET(makeReq('GET'))
    const body = await res.json()
    expect(body.configured).toBe(false)
    expect(body.accountId).toBeNull()
  })

  it('returns 403 for dispatcher role', async () => {
    mockGetRequestContext.mockReturnValueOnce({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'dispatcher' })
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/trackdechets/accounts — real mode', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ POST } = await import('@/app/api/trackdechets/accounts/route'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('upserts account and returns ok:true', async () => {
    mockUpsert.mockResolvedValueOnce({ id: 'acc-new' })
    const res  = await POST(makeReq('POST', { token: 'a'.repeat(20) }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.accountId).toBe('acc-new')
    expect(mockUpsert).toHaveBeenCalledOnce()
  })

  it('returns 422 when token too short', async () => {
    const res = await POST(makeReq('POST', { token: 'short' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 on non-JSON body', async () => {
    const url = new URL('http://localhost/api/trackdechets/accounts')
    const badReq = new NextRequest(url, { method: 'POST', body: 'not json' })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/trackdechets/accounts/[id] — mock mode', () => {
  it('returns ok:true in mock mode', async () => {
    const { DELETE } = await import('@/app/api/trackdechets/accounts/[id]/route')
    const url = new URL('http://localhost/api/trackdechets/accounts/acc-1')
    const req = new NextRequest(url, { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 403 for driver role', async () => {
    mockGetRequestContext.mockReturnValueOnce({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'driver' })
    const { DELETE } = await import('@/app/api/trackdechets/accounts/[id]/route')
    const url = new URL('http://localhost/api/trackdechets/accounts/acc-1')
    const req = new NextRequest(url, { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc-1' }) })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/trackdechets/accounts/[id] — real mode', () => {
  let DELETE: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ DELETE } = await import('@/app/api/trackdechets/accounts/[id]/route'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('deletes account belonging to caller tenant', async () => {
    mockFindUnique.mockResolvedValueOnce({ tenantId: 'tenant-1' })
    mockDelete.mockResolvedValueOnce({})
    const url = new URL('http://localhost/api/trackdechets/accounts/acc-1')
    const req = new NextRequest(url, { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc-1' }) })
    expect(res.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledOnce()
  })

  it('returns 404 when account not found', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const url = new URL('http://localhost/api/trackdechets/accounts/acc-missing')
    const req = new NextRequest(url, { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc-missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when account belongs to different tenant (non-superadmin)', async () => {
    mockFindUnique.mockResolvedValueOnce({ tenantId: 'other-tenant' })
    const url = new URL('http://localhost/api/trackdechets/accounts/acc-other')
    const req = new NextRequest(url, { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc-other' }) })
    expect(res.status).toBe(403)
  })
})
