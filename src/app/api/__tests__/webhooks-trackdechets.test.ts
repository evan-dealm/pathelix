import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/apiError', () => ({
  handleApiError: vi.fn(() => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })),
}))

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpdate     = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    bsd: { findUnique: mockFindUnique, update: mockUpdate },
  },
}))

vi.mock('@/lib/trackdechets/bsdService', () => ({
  mapTdStatus: vi.fn((s: string) => s),
}))

const rlAllowed = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check: vi.fn(async () => rlAllowed.value) }),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

const WEBHOOK_SECRET = 'test-webhook-secret-abc'

function makeSignature(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function makeReq(body: unknown, sig?: string | null): NextRequest {
  const rawBody = JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sig !== null) {
    headers['x-hub-signature-256'] = sig ?? makeSignature(rawBody)
  }
  return new NextRequest(new URL('http://localhost/api/webhooks/trackdechets'), {
    method: 'POST',
    body: rawBody,
    headers,
  })
}

const validPayload = {
  type: 'BSD_STATUS_UPDATED',
  payload: { id: 'td-abc', status: 'SEALED', readableId: 'TD-26-AAA-00001' },
}

// ─── No secret configured ─────────────────────────────────────────────────────

describe('POST /api/webhooks/trackdechets — no secret', () => {
  it('returns 503 when TRACKDECHETS_WEBHOOK_SECRET not set', async () => {
    const { POST } = await import('@/app/api/webhooks/trackdechets/route')
    const req = makeReq(validPayload)
    const res = await POST(req)
    expect(res.status).toBe(503)
  })
})

// ─── With secret ──────────────────────────────────────────────────────────────

describe('POST /api/webhooks/trackdechets — with secret', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    vi.stubEnv('TRACKDECHETS_WEBHOOK_SECRET', WEBHOOK_SECRET)
    vi.resetModules()
    ;({ POST } = await import('@/app/api/webhooks/trackdechets/route'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns 401 on missing signature', async () => {
    const req = makeReq(validPayload, null)
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate limit exceeded — regression: webhook must be rate limited', async () => {
    rlAllowed.value = false
    const res = await POST(makeReq(validPayload))
    expect(res.status).toBe(429)
    rlAllowed.value = true
  })

  it('returns 401 on wrong signature', async () => {
    const req = makeReq(validPayload, 'sha256=badbadbad')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 on signature with wrong secret', async () => {
    const rawBody = JSON.stringify(validPayload)
    const sig = makeSignature(rawBody, 'wrong-secret')
    const req = makeReq(validPayload, sig)
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('ignores non-BSD_STATUS_UPDATED event types', async () => {
    const body = { type: 'OTHER_EVENT', payload: { id: 'td-abc', status: 'DRAFT' } }
    const rawBody = JSON.stringify(body)
    const req = makeReq(body, makeSignature(rawBody))
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ignored).toBe(true)
    expect(json.type).toBe('OTHER_EVENT')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': makeSignature('not json'),
    }
    const req = new NextRequest(new URL('http://localhost/api/webhooks/trackdechets'), {
      method: 'POST',
      body: 'not json',
      headers,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 on valid JSON but wrong payload shape', async () => {
    const body = { type: 'BSD_STATUS_UPDATED', payload: { missing_id: 'x' } }
    const rawBody = JSON.stringify(body)
    const req = makeReq(body, makeSignature(rawBody))
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('ignores when BSD not found locally', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const rawBody = JSON.stringify(validPayload)
    const req = makeReq(validPayload, makeSignature(rawBody))
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.ignored).toBe(true)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('updates BSD status when found', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'bsd-local-1', tenantId: 'tenant-1', status: 'DRAFT' })
    mockUpdate.mockResolvedValueOnce({})

    const rawBody = JSON.stringify(validPayload)
    const req = makeReq(validPayload, makeSignature(rawBody))
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tdId: 'td-abc' },
        data:  expect.objectContaining({ status: 'SEALED' }),
      }),
    )
  })

  it('includes readableId in update when provided', async () => {
    mockUpdate.mockClear()
    mockFindUnique.mockResolvedValueOnce({ id: 'bsd-local-1', tenantId: 'tenant-1', status: 'DRAFT' })
    mockUpdate.mockResolvedValueOnce({})

    const rawBody = JSON.stringify(validPayload)
    const req = makeReq(validPayload, makeSignature(rawBody))
    await POST(req)

    const updateCall = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data.readableId).toBe('TD-26-AAA-00001')
  })

  it('omits readableId from update when not in payload', async () => {
    mockUpdate.mockClear()
    const bodyNoReadable = {
      type: 'BSD_STATUS_UPDATED',
      payload: { id: 'td-abc', status: 'SENT' },
    }
    mockFindUnique.mockResolvedValueOnce({ id: 'bsd-local-1', tenantId: 'tenant-1', status: 'DRAFT' })
    mockUpdate.mockResolvedValueOnce({})

    const rawBody = JSON.stringify(bodyNoReadable)
    const req = makeReq(bodyNoReadable, makeSignature(rawBody))
    await POST(req)

    const updateCall = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect('readableId' in updateCall.data).toBe(false)
  })
})
