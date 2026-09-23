/**
 * Tests for GET/POST /api/missions/[id]/proof
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  mission:       { findFirst: vi.fn() },
  deliveryProof: { upsert: vi.fn() },
}))

vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1', userId: 'driver-1', role: 'driver', requestId: 'req-1', trade: null,
  })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { GET, POST } from '@/app/api/missions/[id]/proof/route'
import { getRequestContext } from '@/lib/data/context'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

const PROOF_URL = 'http://localhost/api/missions/m-1/proof'

describe('GET /api/missions/[id]/proof', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns proof when mission exists (200)', async () => {
    const proof = { id: 'p-1', missionId: 'm-1', signatureUrl: 'https://example.com/sig.png', photoUrl: null, notes: '', capturedAt: new Date() }
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', proof })
    const res  = await GET(makeGet(PROOF_URL), makeParams('m-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.proof).toBeDefined()
  })

  it('returns null proof when no proof exists', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', proof: null })
    const res  = await GET(makeGet(PROOF_URL), makeParams('m-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.proof).toBeNull()
  })

  it('returns 404 when mission not found or wrong tenant', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)
    const res = await GET(makeGet(PROOF_URL), makeParams('other-tenant-mission'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/missions/[id]/proof', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('driver can save proof for own mission (200)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'driver-1', role: 'driver', requestId: 'req-1', trade: null })
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', tenantId: 'tenant-1' })
    const proof = { id: 'p-1', missionId: 'm-1', driverId: 'driver-1', photoUrl: null, signatureUrl: 'https://example.com/sig.png', notes: 'OK', capturedAt: new Date() }
    mockPrisma.deliveryProof.upsert.mockResolvedValue(proof)

    const res  = await POST(makePost(PROOF_URL, {
      driverId:     'driver-1',
      signatureUrl: 'https://example.com/sig.png',
      notes:        'OK',
    }), makeParams('m-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.proof).toBeDefined()
  })

  it('admin can save proof for any mission (200)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'admin-1', role: 'admin', requestId: 'req-1', trade: null })
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', tenantId: 'tenant-1' })
    mockPrisma.deliveryProof.upsert.mockResolvedValue({ id: 'p-1', missionId: 'm-1', driverId: 'd-1' })

    const res = await POST(makePost(PROOF_URL, {
      driverId: 'd-1',
      notes:    'Signed by admin',
    }), makeParams('m-1'))
    expect(res.status).toBe(200)
  })

  it('driver cannot save proof for another driver mission (403)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'driver-A', role: 'driver', requestId: 'req-1', trade: null })
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', tenantId: 'tenant-1' })

    const res = await POST(makePost(PROOF_URL, {
      driverId: 'driver-B',
      notes:    'Hijack attempt',
    }), makeParams('m-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when mission not found', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)
    const res = await POST(makePost(PROOF_URL, { driverId: 'driver-1' }), makeParams('missing-mission'))
    expect(res.status).toBe(404)
  })

  it('returns 422 for invalid signatureUrl', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', tenantId: 'tenant-1' })
    const res = await POST(makePost(PROOF_URL, {
      driverId:     'driver-1',
      signatureUrl: 'not-a-url',
    }), makeParams('m-1'))
    expect(res.status).toBe(422)
  })

  it('returns 422 when driverId missing', async () => {
    const res = await POST(makePost(PROOF_URL, { notes: 'no driver' }), makeParams('m-1'))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest(PROOF_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await POST(req, makeParams('m-1'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'admin-1', role: 'admin', requestId: 'req-1', trade: null })
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', tenantId: 'tenant-1' })
    mockPrisma.deliveryProof.upsert.mockRejectedValue(new Error('DB error'))

    const res = await POST(makePost(PROOF_URL, { driverId: 'd-1' }), makeParams('m-1'))
    expect(res.status).toBe(500)
  })
})
