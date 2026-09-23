import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    missionTemplate: {
      findMany: vi.fn(),
      create:   vi.fn(),
      update:   vi.fn(),
      delete:   vi.fn(),
    },
    userPermission: { findMany: vi.fn(() => Promise.resolve([])) },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma, getTenantDb: () => mockPrisma }))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
  },
}))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { GET, POST } from '@/app/api/templates/route'
import { PUT, DELETE } from '@/app/api/templates/[id]/route'
import { getRequestContext } from '@/lib/data/context'

function makeGet(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

function makePost(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makePut(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function makeDelete(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'DELETE' })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const validTemplate = {
  label:      'Livraison benne hebdo',
  type:       'POSER',
  recurrence: { kind: 'weekly', weekDays: [1, 3] },
  address:    '10 rue de Lyon, Lyon',
  latitude:   45.764,
  longitude:  4.836,
  startDate:  '2026-04-01',
}

describe('GET /api/templates', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns template list (200)', async () => {
    const templates = [
      { id: 't-1', ...validTemplate, tenantId: 'tenant-test', enabled: true, createdAt: new Date() },
    ]
    mockPrisma.missionTemplate.findMany.mockResolvedValue(templates)

    const res  = await GET(makeGet('/api/templates'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(1)
    expect(json[0].id).toBe('t-1')
  })

  it('returns empty array when no templates', async () => {
    mockPrisma.missionTemplate.findMany.mockResolvedValue([])

    const res  = await GET(makeGet('/api/templates'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(0)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.missionTemplate.findMany.mockRejectedValue(new Error('DB fail'))

    const res = await GET(makeGet('/api/templates'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' } as never)
  })

  it('creates a template with valid body (201)', async () => {
    const created = { id: 't-new', ...validTemplate, tenantId: 'tenant-test', enabled: true, createdAt: new Date() }
    mockPrisma.missionTemplate.create.mockResolvedValue(created)

    const res  = await POST(makePost('/api/templates', validTemplate))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.id).toBe('t-new')
  })

  it('rejects invalid mission type (422)', async () => {
    const res = await POST(makePost('/api/templates', { ...validTemplate, type: 'INVALID' }))
    expect(res.status).toBe(422)
  })

  it('rejects missing required fields (422)', async () => {
    const res = await POST(makePost('/api/templates', { label: 'test' }))
    expect(res.status).toBe(422)
  })

  it('rejects invalid latitude (422)', async () => {
    const res = await POST(makePost('/api/templates', { ...validTemplate, latitude: 200 }))
    expect(res.status).toBe(422)
  })

  it('rejects invalid startDate format (422)', async () => {
    const res = await POST(makePost('/api/templates', { ...validTemplate, startDate: '01/04/2026' }))
    expect(res.status).toBe(422)
  })

  it('rejects invalid timeWindow (closeMin <= openMin) (422)', async () => {
    const res = await POST(makePost('/api/templates', {
      ...validTemplate,
      timeWindow: { openMin: 600, closeMin: 540 },
    }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.missionTemplate.create.mockRejectedValue(new Error('DB fail'))

    const res = await POST(makePost('/api/templates', validTemplate))
    expect(res.status).toBe(500)
  })

  // Found during the A7/N22 follow-up privilege-escalation review: POST /api/templates had
  // NO role/permission gate at all (getTenantId-only) — any authenticated role, including
  // driver, could create recurring mission templates for the tenant. Fixed with the same
  // hasPermission('manage_missions') pattern used by POST /api/missions.
  it('driver role (no default permissions) gets 403, template not created', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'driver-1', role: 'driver', requestId: 'r1' } as never)

    const res = await POST(makePost('/api/templates', validTemplate))
    expect(res.status).toBe(403)
    expect(mockPrisma.missionTemplate.create).not.toHaveBeenCalled()
  })

  it('dispatcher with no custom UserPermission gets the role default (manage_missions included, 201)', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'disp-default', role: 'dispatcher', requestId: 'r1' } as never)
    mockPrisma.missionTemplate.create.mockResolvedValue({ id: 't-new', ...validTemplate, tenantId: 'tenant-test' })

    const res = await POST(makePost('/api/templates', validTemplate))
    expect(res.status).toBe(201)
  })
})

describe('PUT /api/templates/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' } as never)
  })

  it('updates a template (200)', async () => {
    const updated = { id: 't-1', label: 'Updated', tenantId: 'tenant-test' }
    mockPrisma.missionTemplate.update.mockResolvedValue(updated)

    const res  = await PUT(makePut('/api/templates/t-1', { label: 'Updated' }), makeParams('t-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.label).toBe('Updated')
  })

  it('strips disallowed fields from update', async () => {
    const updated = { id: 't-1', label: 'Updated', tenantId: 'tenant-test' }
    mockPrisma.missionTemplate.update.mockResolvedValue(updated)

    await PUT(makePut('/api/templates/t-1', { label: 'Updated', tenantId: 'evil', role: 'superadmin' }), makeParams('t-1'))

    const callData = mockPrisma.missionTemplate.update.mock.calls[0][0].data
    expect(callData).not.toHaveProperty('tenantId')
    expect(callData).not.toHaveProperty('role')
    expect(callData).toHaveProperty('label')
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await PUT(makePut('/api/templates/t-1', { label: 'x' }), makeParams('t-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown template (P2025)', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' })
    mockPrisma.missionTemplate.update.mockRejectedValue(err)

    const res = await PUT(makePut('/api/templates/nope', { label: 'x' }), makeParams('nope'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/templates/t-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'bad{',
    })
    const res = await PUT(req, makeParams('t-1'))
    expect(res.status).toBe(400)
  })

  it('rejects out-of-range latitude (400) — regression: PUT must validate values via Zod', async () => {
    const res = await PUT(makePut('/api/templates/t-1', { latitude: 999 }), makeParams('t-1'))
    expect(res.status).toBe(400)
    expect(mockPrisma.missionTemplate.update).not.toHaveBeenCalled()
  })

  it('rejects invalid mission type (400)', async () => {
    const res = await PUT(makePut('/api/templates/t-1', { type: 'HACK' }), makeParams('t-1'))
    expect(res.status).toBe(400)
    expect(mockPrisma.missionTemplate.update).not.toHaveBeenCalled()
  })

  it('rejects malformed timeWindow (closeMin <= openMin) (400)', async () => {
    const res = await PUT(makePut('/api/templates/t-1', { timeWindow: { openMin: 600, closeMin: 500 } }), makeParams('t-1'))
    expect(res.status).toBe(400)
    expect(mockPrisma.missionTemplate.update).not.toHaveBeenCalled()
  })

  it('does not inject defaults for absent fields on partial update', async () => {
    mockPrisma.missionTemplate.update.mockResolvedValue({ id: 't-1', label: 'x' })

    await PUT(makePut('/api/templates/t-1', { label: 'x' }), makeParams('t-1'))

    const callData = mockPrisma.missionTemplate.update.mock.calls[0][0].data
    expect(Object.keys(callData)).toEqual(['label'])
  })

  it('dispatcher role can also update', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'u', role: 'dispatcher', requestId: 'r' } as never)
    mockPrisma.missionTemplate.update.mockResolvedValue({ id: 't-1', label: 'x' })

    const res = await PUT(makePut('/api/templates/t-1', { label: 'x' }), makeParams('t-1'))
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/templates/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-test', userId: 'user-1', role: 'admin', requestId: 'r1' } as never)
  })

  it('deletes a template (200)', async () => {
    mockPrisma.missionTemplate.delete.mockResolvedValue({ id: 't-1' })

    const res  = await DELETE(makeDelete('/api/templates/t-1'), makeParams('t-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't', userId: 'u', role: 'driver', requestId: 'r' } as never)

    const res = await DELETE(makeDelete('/api/templates/t-1'), makeParams('t-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown template (P2025)', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' })
    mockPrisma.missionTemplate.delete.mockRejectedValue(err)

    const res = await DELETE(makeDelete('/api/templates/nope'), makeParams('nope'))
    expect(res.status).toBe(404)
  })
})
