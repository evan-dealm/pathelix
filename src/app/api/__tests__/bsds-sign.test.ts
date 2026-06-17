import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

// Single shared class — same reference in both mocks so instanceof works
const { MockTdApiError } = vi.hoisted(() => {
  class MockTdApiError extends Error {
    errors: Array<{ message: string }>
    statusCode?: number
    constructor(msg: string, errors: Array<{ message: string }>, code?: number) {
      super(msg)
      this.name = 'TdApiError'
      this.errors = errors
      this.statusCode = code
    }
  }
  return { MockTdApiError }
})

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'admin' })),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/apiError', () => ({
  handleApiError: vi.fn(() => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })),
}))
vi.mock('@/lib/trackdechets/client', () => ({ TdApiError: MockTdApiError }))

// Inline real validator logic — no importOriginal to avoid resetModules issues
vi.mock('@/lib/trackdechets/bsdService', () => ({
  signBsddInTd: vi.fn(),
  getTokenFromAccount: vi.fn(() => 'plain-token'),
  mapTdStatus: vi.fn((s: string) => s),
  validatePayloadForProducerSign: (payload: unknown) => {
    const errors: string[] = []
    const p  = payload as Record<string, unknown> | null
    const wd = (p?.wasteDetails ?? {}) as Record<string, unknown>
    if (!wd.name || String(wd.name).trim() === '') {
      errors.push('wasteDetails.name — nom commercial du déchet requis à la signature producteur')
    }
    if (wd.quantity === undefined || wd.quantity === null) {
      errors.push('wasteDetails.quantity — quantité requise à la signature producteur')
    }
    return errors
  },
  validatePayloadForTransporterSign: (payload: unknown) => {
    const errors: string[] = []
    const p  = payload as Record<string, unknown> | null
    const tr = (p?.transporter ?? null) as Record<string, unknown> | null
    if (!tr) {
      errors.push('transporter — bloc transporteur requis pour la signature transporteur')
      return errors
    }
    if (!tr.receipt || String(tr.receipt).trim() === '') {
      errors.push('transporter.receipt — récépissé transporteur requis')
    }
    if (!tr.department || String(tr.department).trim() === '') {
      errors.push('transporter.department — département transporteur requis')
    }
    if (!tr.validityLimit || String(tr.validityLimit).trim() === '') {
      errors.push('transporter.validityLimit — date de validité du récépissé requise')
    }
    return errors
  },
  TdApiError: MockTdApiError,
}))

const mockGetRequestContext = vi.mocked(
  (await import('@/lib/data/context')).getRequestContext,
)

const mockFindFirst  = vi.hoisted(() => vi.fn())
const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpdate     = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    bsd: { findFirst: mockFindFirst, update: mockUpdate },
    trackdechetsAccount: { findUnique: mockFindUnique },
  },
}))

const validSignBody = { signatureType: 'PRODUCER', signatureAuthor: 'Jean Dupont' }

const validPayload = {
  emitter:      { company: { siret: '12345678901234', name: 'Sté', address: '1 rue' } },
  recipient:    { processingOperation: 'D9', company: { siret: '12345678901234', name: 'Centre', address: '2 av' } },
  wasteDetails: { code: '17 09 04', name: 'Gravats', quantity: 2.5 },
  transporter: {
    company:       { siret: '12345678901234', name: 'Transport', address: '3 bd' },
    receipt:       'REC-75-001',
    department:    '75',
    validityLimit: '2027-06-01',
  },
}

const payloadMissingName        = { ...validPayload, wasteDetails: { code: '17 09 04', quantity: 2.5 } }
const payloadMissingTransporter = { ...validPayload, transporter: undefined }

function makeReq(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/bsds/bsd-1/sign'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

// ─── Mock mode ────────────────────────────────────────────────────────────────

describe('POST /api/bsds/[id]/sign — mock mode', () => {
  it('returns ok:true with SIGNED_BY_PRODUCER status', async () => {
    const { POST } = await import('@/app/api/bsds/[id]/sign/route')
    const res  = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe('SIGNED_BY_PRODUCER')
  })

  it('returns 403 for driver', async () => {
    mockGetRequestContext.mockReturnValueOnce({ tenantId: 'tenant-1', userId: 'u1', requestId: 'r1', trade: null, role: 'driver' })
    const { POST } = await import('@/app/api/bsds/[id]/sign/route')
    const res = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 422 on empty signatureAuthor', async () => {
    const { POST } = await import('@/app/api/bsds/[id]/sign/route')
    const res = await POST(makeReq({ signatureType: 'PRODUCER', signatureAuthor: '' }), {
      params: Promise.resolve({ id: 'bsd-1' }),
    })
    expect(res.status).toBe(422)
  })
})

// ─── Real mode ────────────────────────────────────────────────────────────────

describe('POST /api/bsds/[id]/sign — real mode', () => {
  let POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let mockSignBsdd: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    vi.stubEnv('USE_MOCK_DATA', 'false')
    vi.resetModules()
    ;({ POST } = await import('@/app/api/bsds/[id]/sign/route'))
    mockSignBsdd = vi.mocked((await import('@/lib/trackdechets/bsdService')).signBsddInTd)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns 404 when BSD not found', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 409 when no TD account', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'bsd-1', tdId: 'td-abc', tenantId: 'tenant-1', payload: validPayload })
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-1' }) })
    expect(res.status).toBe(409)
  })

  it('signs BSD and updates status', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'bsd-1', tdId: 'td-abc', tenantId: 'tenant-1', payload: validPayload })
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })
    mockSignBsdd.mockResolvedValueOnce({ id: 'td-abc', status: 'SIGNED_BY_PRODUCER', readableId: '' })
    mockUpdate.mockResolvedValueOnce({})

    const res  = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe('SIGNED_BY_PRODUCER')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bsd-1' } }))
  })

  it('returns 400 on non-JSON body', async () => {
    const req = new NextRequest(new URL('http://localhost/api/bsds/bsd-1/sign'), {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'bsd-1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 422 with field list when producer sign missing wasteDetails.name', async () => {
    mockSignBsdd.mockClear()
    mockFindFirst.mockResolvedValueOnce({
      id: 'bsd-1', tdId: 'td-abc', tenantId: 'tenant-1',
      payload: payloadMissingName,
    })
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })

    const res  = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-1' }) })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(Array.isArray(body.fields)).toBe(true)
    expect(body.fields.some((f: string) => f.includes('wasteDetails.name'))).toBe(true)
    expect(mockSignBsdd).not.toHaveBeenCalled()
  })

  it('returns 422 when transporter sign missing transporter block', async () => {
    mockSignBsdd.mockClear()
    mockFindFirst.mockResolvedValueOnce({
      id: 'bsd-1', tdId: 'td-abc', tenantId: 'tenant-1',
      payload: payloadMissingTransporter,
    })
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })

    const body_req = { signatureType: 'TRANSPORTER', signatureAuthor: 'Marie Martin' }
    const res  = await POST(makeReq(body_req), { params: Promise.resolve({ id: 'bsd-1' }) })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.fields[0]).toContain('transporter')
    expect(mockSignBsdd).not.toHaveBeenCalled()
  })

  it('returns 502 with Trackdéchets error when recipient not registered', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'bsd-1', tdId: 'td-abc', tenantId: 'tenant-1', payload: validPayload })
    mockFindUnique.mockResolvedValueOnce({ id: 'acc-1', encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })
    mockSignBsdd.mockRejectedValueOnce(new MockTdApiError(
      "L'établissement avec le SIRET 12345678901234 n'est pas inscrit sur Trackdéchets",
      [{ message: "L'établissement avec le SIRET 12345678901234 n'est pas inscrit sur Trackdéchets" }],
    ))

    const res  = await POST(makeReq(validSignBody), { params: Promise.resolve({ id: 'bsd-1' }) })
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.error).toContain('Trackdéchets')
  })
})
