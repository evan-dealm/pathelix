import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  planningNote: {
    findUnique: vi.fn(),
    upsert:     vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => mockPrisma }))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'r1', trade: null })),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { GET, PUT } from '@/app/api/planning-notes/route'
import { getRequestContext } from '@/lib/data/context'

function makeGet(url: string): NextRequest {
  return new NextRequest(url)
}
function makePut(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/planning-notes', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't-1', userId: 'u-1', role: 'admin', requestId: 'r1', trade: null } as never)
})

describe('GET /api/planning-notes', () => {
  it('returns 400 for missing date', async () => {
    const res = await GET(makeGet('http://localhost/api/planning-notes'))
    expect(res.status).toBe(400)
  })

  it('returns empty text/null updatedAt when no note exists', async () => {
    mockPrisma.planningNote.findUnique.mockResolvedValue(null)
    const res = await GET(makeGet('http://localhost/api/planning-notes?date=2026-06-15'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ date: '2026-06-15', text: '', updatedAt: null })
  })

  it('returns the note text and updatedAt when found', async () => {
    const updatedAt = new Date('2026-06-15T10:00:00Z')
    mockPrisma.planningNote.findUnique.mockResolvedValue({ text: 'Jean absent', updatedAt })
    const res = await GET(makeGet('http://localhost/api/planning-notes?date=2026-06-15'))
    const json = await res.json()
    expect(json.text).toBe('Jean absent')
    expect(json.updatedAt).toBe(updatedAt.toISOString())
  })
})

describe('PUT /api/planning-notes', () => {
  it('returns 403 for driver role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't-1', userId: 'u-1', role: 'driver', requestId: 'r1', trade: null } as never)
    const res = await PUT(makePut({ date: '2026-06-15', text: 'x' }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for invalid body', async () => {
    const res = await PUT(makePut({ date: 'not-a-date', text: 'x' }))
    expect(res.status).toBe(422)
  })

  it('creates a note on first save (expectedUpdatedAt null)', async () => {
    mockPrisma.planningNote.findUnique.mockResolvedValue(null)
    mockPrisma.planningNote.upsert.mockResolvedValue({ text: 'hello', updatedAt: new Date('2026-06-15T10:00:00Z') })
    const res = await PUT(makePut({ date: '2026-06-15', text: 'hello', expectedUpdatedAt: null }))
    expect(res.status).toBe(200)
    expect(mockPrisma.planningNote.upsert).toHaveBeenCalledWith({
      where:  { tenantId_date: { tenantId: 't-1', date: '2026-06-15' } },
      create: { date: '2026-06-15', text: 'hello' },
      update: { text: 'hello' },
    })
  })

  it('409s when expectedUpdatedAt does not match the current row (concurrent edit)', async () => {
    const currentUpdatedAt = new Date('2026-06-15T11:00:00Z')
    mockPrisma.planningNote.findUnique.mockResolvedValue({ text: 'someone else wrote this', updatedAt: currentUpdatedAt })
    const res = await PUT(makePut({
      date: '2026-06-15', text: 'my edit', expectedUpdatedAt: new Date('2026-06-15T10:00:00Z').toISOString(),
    }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.current.text).toBe('someone else wrote this')
    expect(mockPrisma.planningNote.upsert).not.toHaveBeenCalled()
  })

  it('skips the optimistic check entirely when expectedUpdatedAt is omitted', async () => {
    mockPrisma.planningNote.upsert.mockResolvedValue({ text: 'x', updatedAt: new Date() })
    const res = await PUT(makePut({ date: '2026-06-15', text: 'x' }))
    expect(res.status).toBe(200)
    expect(mockPrisma.planningNote.findUnique).not.toHaveBeenCalled()
  })

  it('deletes the row when text is blank instead of storing an empty note', async () => {
    mockPrisma.planningNote.deleteMany.mockResolvedValue({ count: 1 })
    const res = await PUT(makePut({ date: '2026-06-15', text: '   ', expectedUpdatedAt: null }))
    expect(res.status).toBe(200)
    expect(mockPrisma.planningNote.deleteMany).toHaveBeenCalledWith({ where: { date: '2026-06-15' } })
    expect(mockPrisma.planningNote.upsert).not.toHaveBeenCalled()
  })

  it('dispatcher role is allowed to write', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 't-1', userId: 'u-1', role: 'dispatcher', requestId: 'r1', trade: null } as never)
    mockPrisma.planningNote.upsert.mockResolvedValue({ text: 'x', updatedAt: new Date() })
    const res = await PUT(makePut({ date: '2026-06-15', text: 'x' }))
    expect(res.status).toBe(200)
  })
})
