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

const mockGetRequestContext = vi.mocked(
  (await import('@/lib/data/context')).getRequestContext,
)

const mockFindMany     = vi.hoisted(() => vi.fn())
const mockCount        = vi.hoisted(() => vi.fn())
const mockCreate       = vi.hoisted(() => vi.fn())
const mockFindUnique   = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    bsd: { findMany: mockFindMany, count: mockCount, create: mockCreate },
    trackdechetsAccount: { findUnique: mockFindUnique },
  },
}))

vi.mock('@/lib/trackdechets/bsdService', () => ({
  createBsddInTd: vi.fn(),
  getTokenFromAccount: vi.fn(() => 'plain-token'),
  mapTdStatus: vi.fn((s: string) => s),
  TdApiError: class TdApiError extends Error {
    errors: Array<{ message: string }>
    statusCode?: number
    constructor(msg: string, errors: Array<{ message: string }>, code?: number) {
      super(msg)
      this.name = 'TdApiError'
      this.errors = errors
      this.statusCode = code
    }
  },
}))
vi.mock('@/lib/trackdechets/client', () => ({
  TdApiError: class TdApiError extends Error {
    errors: Array<{ message: string }>
    statusCode?: number
    constructor(msg: string, errors: Array<{ message: string }>, code?: number) {
      super(msg)
      this.name = 'TdApiError'
      this.errors = errors
      this.statusCode = code
    }
  },
}))

const { createBsddInTd } = await import('@/lib/trackdechets/bsdService')
const mockCreate_td = vi.mocked(createBsddInTd)

const validBody = {
  emitter: {
    company: { siret: '12345678901234', name: 'Sté A', address: '1 rue Test 75001 Paris' },
  },
  recipient: {
    processingOperation: 'D9',
    company: { siret: '12345678901234', name: 'Centre', address: '2 av 69001 Lyon' },
  },
  wasteDetails: { code: '17 09 04' },
}

function makeGetReq(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/bsds')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function makePostReq(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/bsds'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

// ─── Mock mode ────────────────────────────────────────────────────────────────

describe('GET /api/bsds — mock mode', () => {
  it('returns mock BSD list', async () => {
    const { GET } = await import('@/app/api/bsds/route')
    const res  = await GET(makeGetReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(body.bsds)).toBe(true)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })

  it('returns 403 for driver role', async () => {
    mockGetRequestContext.mockReturnValueOnce({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'driver' })
    const { GET } = await import('@/app/api/bsds/route')
    const res = await GET(makeGetReq())
    expect(res.status).toBe(403)
  })
})

describe('POST /api/bsds — mock mode', () => {
  it('returns mock BSD in mock mode', async () => {
    const { POST } = await import('@/app/api/bsds/route')
    const res  = await POST(makePostReq(validBody))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.bsdId).toBeDefined()
    expect(body.tdId).toBeDefined()
    expect(mockCreate_td).not.toHaveBeenCalled()
  })

  it('returns 422 on invalid body', async () => {
    const { POST } = await import('@/app/api/bsds/route')
    const res = await POST(makePostReq({ emitter: {} }))
    expect(res.status).toBe(422)
  })
})

// ─── Real mode ────────────────────────────────────────────────────────────────

describe('GET /api/bsds — real mode', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ GET } = await import('@/app/api/bsds/route'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('queries DB with tenantId filter and returns list', async () => {
    const bsds = [{ id: 'b1', tdId: 'TD-1', type: 'BSDD', status: 'DRAFT', missionId: null, readableId: 'TD-1', createdAt: new Date(), updatedAt: new Date() }]
    mockFindMany.mockResolvedValueOnce(bsds)
    mockCount.mockResolvedValueOnce(1)

    const res  = await GET(makeGetReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bsds).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }),
    )
  })

  it('filters by status when provided', async () => {
    mockFindMany.mockResolvedValueOnce([])
    mockCount.mockResolvedValueOnce(0)
    await GET(makeGetReq({ status: 'SEALED' }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'SEALED' }) }),
    )
  })

  it('filters by missionId when provided', async () => {
    mockFindMany.mockResolvedValueOnce([])
    mockCount.mockResolvedValueOnce(0)
    await GET(makeGetReq({ missionId: 'mission-1' }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ missionId: 'mission-1' }) }),
    )
  })
})

describe('POST /api/bsds — real mode', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ POST } = await import('@/app/api/bsds/route'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns 409 when no TD account configured', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await POST(makePostReq(validBody))
    expect(res.status).toBe(409)
  })

  it('creates BSD in TD and stores in DB', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1,
    })
    mockCreate_td.mockResolvedValueOnce({ id: 'td-abc', status: 'DRAFT', readableId: 'TD-26-AAA-00001' })
    mockCreate.mockResolvedValueOnce({ id: 'bsd-1', tdId: 'td-abc', status: 'DRAFT', readableId: 'TD-26-AAA-00001' })

    const res  = await POST(makePostReq(validBody))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.bsdId).toBe('bsd-1')
    expect(body.tdId).toBe('td-abc')
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('returns 400 on non-JSON body', async () => {
    const req = new NextRequest(new URL('http://localhost/api/bsds'), {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
