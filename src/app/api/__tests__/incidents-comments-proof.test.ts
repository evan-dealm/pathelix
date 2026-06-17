import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  mission: {
    findFirst:   vi.fn(),
    findMany:    vi.fn(),
    count:       vi.fn(),
    update:      vi.fn(),
    updateMany:  vi.fn(),
  },
  missionComment: {
    findMany: vi.fn(),
    create:   vi.fn(),
  },
  deliveryProof: {
    findFirst: vi.fn(),
    upsert:    vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/incidentBroadcast', () => ({ broadcastIncident: vi.fn() }))

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir:     vi.fn().mockResolvedValue(undefined),
}))

import { GET as incidentGET, POST as incidentPOST } from '@/app/api/incidents/route'
import { GET as commentGET,  POST as commentPOST }  from '@/app/api/mission-comments/route'
import { GET as proofGET,    POST as proofPOST }    from '@/app/api/delivery-proof/route'

function makeGet(url: string): NextRequest {
  return new NextRequest(url)
}

function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeBadJson(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  })
}

function makeFormRequest(fields: Record<string, string>): NextRequest {
  const req = new NextRequest('http://localhost:3000/api/delivery-proof', { method: 'POST' })
  vi.spyOn(req, 'formData').mockResolvedValue({
    get: (key: string) => fields[key] ?? null,
  } as unknown as FormData)
  return req
}

describe('POST /api/incidents', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reports incident and returns ok (200)', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', address: '10 rue de Lyon', clientName: 'Acme' })
    mockPrisma.mission.updateMany.mockResolvedValue({ count: 1 })

    const res  = await incidentPOST(makePost('http://localhost:3000/api/incidents', { missionId: 'm-1', incidentType: 'panne' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('accepts optional notes', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', address: 'addr', clientName: '' })
    mockPrisma.mission.updateMany.mockResolvedValue({ count: 1 })

    const res = await incidentPOST(makePost('http://localhost:3000/api/incidents', { missionId: 'm-1', incidentType: 'accident', notes: 'Choc léger' }))
    expect(res.status).toBe(200)
  })

  it('returns 422 for invalid incidentType', async () => {
    const res = await incidentPOST(makePost('http://localhost:3000/api/incidents', { missionId: 'm-1', incidentType: 'unknown' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when missionId missing', async () => {
    const res = await incidentPOST(makePost('http://localhost:3000/api/incidents', { incidentType: 'panne' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await incidentPOST(makeBadJson('http://localhost:3000/api/incidents'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when mission not found', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)

    const res = await incidentPOST(makePost('http://localhost:3000/api/incidents', { missionId: 'nope', incidentType: 'accident' }))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error during update', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1', address: 'addr', clientName: '' })
    mockPrisma.mission.updateMany.mockRejectedValue(new Error('DB fail'))

    const res = await incidentPOST(makePost('http://localhost:3000/api/incidents', { missionId: 'm-1', incidentType: 'autre' }))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/incidents', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns incidents list (200)', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([
      { id: 'm-1', address: '10 rue', clientName: 'Acme', incidentAt: new Date(), incidentType: 'panne', incidentNotes: '' },
    ])
    mockPrisma.mission.count.mockResolvedValue(1)

    const res  = await incidentGET(makeGet('http://localhost:3000/api/incidents'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.incidents).toHaveLength(1)
    expect(json.incidents[0].incidentType).toBe('panne')
  })

  it('returns empty list when no incidents', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([])
    mockPrisma.mission.count.mockResolvedValue(0)

    const res  = await incidentGET(makeGet('http://localhost:3000/api/incidents'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.incidents).toHaveLength(0)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.mission.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await incidentGET(makeGet('http://localhost:3000/api/incidents'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/mission-comments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns comments for missionId (200)', async () => {
    mockPrisma.missionComment.findMany.mockResolvedValue([
      { id: 'c-1', missionId: 'm-1', content: 'Test', userId: 'u-1', role: 'admin', createdAt: new Date() },
    ])

    const res  = await commentGET(makeGet('http://localhost:3000/api/mission-comments?missionId=m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
  })

  it('returns empty list when no comments', async () => {
    mockPrisma.missionComment.findMany.mockResolvedValue([])

    const res  = await commentGET(makeGet('http://localhost:3000/api/mission-comments?missionId=m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(0)
  })

  it('returns 400 when missionId param missing', async () => {
    const res = await commentGET(makeGet('http://localhost:3000/api/mission-comments'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.missionComment.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await commentGET(makeGet('http://localhost:3000/api/mission-comments?missionId=m-1'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/mission-comments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates comment and returns 201', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1' })
    const comment = { id: 'c-1', missionId: 'm-1', content: 'Hello', userId: 'user-1', role: 'admin', createdAt: new Date() }
    mockPrisma.missionComment.create.mockResolvedValue(comment)

    const res  = await commentPOST(makePost('http://localhost:3000/api/mission-comments', { missionId: 'm-1', content: 'Hello' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.content).toBe('Hello')
  })

  it('returns 422 for empty content', async () => {
    const res = await commentPOST(makePost('http://localhost:3000/api/mission-comments', { missionId: 'm-1', content: '' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when missionId missing', async () => {
    const res = await commentPOST(makePost('http://localhost:3000/api/mission-comments', { content: 'Hello' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when mission not found in tenant', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)

    const res = await commentPOST(makePost('http://localhost:3000/api/mission-comments', { missionId: 'nope', content: 'Hi' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid JSON', async () => {
    const res = await commentPOST(makeBadJson('http://localhost:3000/api/mission-comments'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1' })
    mockPrisma.missionComment.create.mockRejectedValue(new Error('DB fail'))

    const res = await commentPOST(makePost('http://localhost:3000/api/mission-comments', { missionId: 'm-1', content: 'Hi' }))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/delivery-proof', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('saves proof and returns ok (200)', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1' })
    const proof = { id: 'p-1', missionId: 'm-1', driverId: 'd-1', tenantId: 'tenant-test' }
    mockPrisma.deliveryProof.upsert.mockResolvedValue(proof)

    const res  = await proofPOST(makeFormRequest({ missionId: 'm-1', driverId: 'd-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.proof.id).toBe('p-1')
  })

  it('returns 400 when formData throws', async () => {
    const req = new NextRequest('http://localhost:3000/api/delivery-proof', { method: 'POST' })
    vi.spyOn(req, 'formData').mockRejectedValue(new Error('bad form'))

    const res = await proofPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when missionId missing', async () => {
    const res = await proofPOST(makeFormRequest({ driverId: 'd-1' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when driverId missing', async () => {
    const res = await proofPOST(makeFormRequest({ missionId: 'm-1' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when mission not found', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)

    const res = await proofPOST(makeFormRequest({ missionId: 'nope', driverId: 'd-1' }))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-1' })
    mockPrisma.deliveryProof.upsert.mockRejectedValue(new Error('DB fail'))

    const res = await proofPOST(makeFormRequest({ missionId: 'm-1', driverId: 'd-1' }))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/delivery-proof', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns proof when found (200)', async () => {
    const proof = { id: 'p-1', missionId: 'm-1', driverId: 'd-1' }
    mockPrisma.deliveryProof.findFirst.mockResolvedValue(proof)

    const res  = await proofGET(makeGet('http://localhost:3000/api/delivery-proof?missionId=m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.proof.id).toBe('p-1')
  })

  it('returns null when proof not found (200)', async () => {
    mockPrisma.deliveryProof.findFirst.mockResolvedValue(null)

    const res  = await proofGET(makeGet('http://localhost:3000/api/delivery-proof?missionId=m-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.proof).toBeNull()
  })

  it('returns 400 when missionId param missing', async () => {
    const res = await proofGET(makeGet('http://localhost:3000/api/delivery-proof'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.deliveryProof.findFirst.mockRejectedValue(new Error('DB fail'))

    const res = await proofGET(makeGet('http://localhost:3000/api/delivery-proof?missionId=m-1'))
    expect(res.status).toBe(500)
  })
})
