import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'admin' })),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/apiError', () => ({
  handleApiError: vi.fn((err: unknown) =>
    new Response(JSON.stringify({ error: 'internal' }), { status: 500 }),
  ),
}))

const mockGetRequestContext = vi.mocked(
  (await import('@/lib/data/context')).getRequestContext,
)

const mockFindFirst  = vi.hoisted(() => vi.fn())
const mockUpdate     = vi.hoisted(() => vi.fn())
const mockFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    bsd: { findFirst: mockFindFirst, update: mockUpdate },
    trackdechetsAccount: { findUnique: mockFindUnique },
  },
}))

vi.mock('@/lib/trackdechets/bsdService', () => ({
  fetchBsddStatusFromTd:  vi.fn(),
  getTokenFromAccount:    vi.fn(() => 'plain-token'),
  mapTdStatus:            vi.fn((s: string) => s),
}))

const { fetchBsddStatusFromTd } = await import('@/lib/trackdechets/bsdService')
const mockFetch = vi.mocked(fetchBsddStatusFromTd)

function makeGetReq(id: string, extra: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost/api/bsds/${id}`)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ─── Mock mode ────────────────────────────────────────────────────────────────

describe('GET /api/bsds/[id] — mock mode', () => {
  it('returns mock BSD', async () => {
    const { GET } = await import('@/app/api/bsds/[id]/route')
    const res  = await GET(makeGetReq('bsd-1'), params('bsd-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bsd.id).toBe('bsd-1')
    expect(body.bsd.status).toBe('DRAFT')
  })

  it('returns 403 for driver role', async () => {
    mockGetRequestContext.mockReturnValueOnce({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'driver' })
    const { GET } = await import('@/app/api/bsds/[id]/route')
    const res = await GET(makeGetReq('bsd-1'), params('bsd-1'))
    expect(res.status).toBe(403)
  })
})

// ─── Real mode ────────────────────────────────────────────────────────────────

describe('GET /api/bsds/[id] — real mode', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ GET } = await import('@/app/api/bsds/[id]/route'))
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  beforeEach(() => {
    mockFindFirst.mockClear()
    mockUpdate.mockClear()
    mockFindUnique.mockClear()
    mockFetch.mockClear()
  })

  it('returns 404 when BSD not found', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    const res = await GET(makeGetReq('missing'), params('missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/introuvable/i)
  })

  it('returns BSD without syncing when sync param absent', async () => {
    const bsd = { id: 'b1', tdId: 'TD-1', status: 'SEALED', payload: {}, missionId: null }
    mockFindFirst.mockResolvedValueOnce(bsd)
    const res  = await GET(makeGetReq('b1'), params('b1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bsd.id).toBe('b1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('syncs status from TD when sync=true and status differs', async () => {
    const bsd = { id: 'b1', tdId: 'TD-1', status: 'DRAFT', payload: {}, missionId: null }
    mockFindFirst.mockResolvedValueOnce(bsd)
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })
    mockFetch.mockResolvedValueOnce({ id: 'TD-1', status: 'SEALED' })
    mockUpdate.mockResolvedValueOnce({ ...bsd, status: 'SEALED' })

    const res  = await GET(makeGetReq('b1', { sync: 'true' }), params('b1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: { status: 'SEALED' } }),
    )
    expect(body.bsd.status).toBe('SEALED')
  })

  it('skips update when sync=true but status unchanged', async () => {
    const bsd = { id: 'b2', tdId: 'TD-2', status: 'DRAFT', payload: {}, missionId: null }
    mockFindFirst.mockResolvedValueOnce(bsd)
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })
    mockFetch.mockResolvedValueOnce({ id: 'TD-2', status: 'DRAFT' })

    const res = await GET(makeGetReq('b2', { sync: 'true' }), params('b2'))
    expect(res.status).toBe(200)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('continues without sync when no TD account', async () => {
    const bsd = { id: 'b3', tdId: 'TD-3', status: 'DRAFT', payload: {}, missionId: null }
    mockFindFirst.mockResolvedValueOnce(bsd)
    mockFindUnique.mockResolvedValueOnce(null)

    const res  = await GET(makeGetReq('b3', { sync: 'true' }), params('b3'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bsd.id).toBe('b3')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('swallows TD sync error and returns BSD with original status', async () => {
    const bsd = { id: 'b4', tdId: 'TD-4', status: 'DRAFT', payload: {}, missionId: null }
    mockFindFirst.mockResolvedValueOnce(bsd)
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })
    mockFetch.mockRejectedValueOnce(new Error('TD network error'))

    const res  = await GET(makeGetReq('b4', { sync: 'true' }), params('b4'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bsd.status).toBe('DRAFT')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
