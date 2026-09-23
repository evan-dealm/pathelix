import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGroupBy = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({
  mission: { groupBy: mockGroupBy },
}))

vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: mockPrisma }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { GET } from '@/app/api/admin/geocoding-audit/route'
import { NextRequest } from 'next/server'

function makeReq(role: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/geocoding-audit', {
    headers: {
      'x-tenant-id': 'tenant-abc',
      'x-user-id': 'user-1',
      'x-user-role': role,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/geocoding-audit', () => {
  it('returns 403 for non-superadmin', async () => {
    const res = await GET(makeReq('admin'))
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher', async () => {
    const res = await GET(makeReq('dispatcher'))
    expect(res.status).toBe(403)
  })

  it('returns grouped counts for superadmin', async () => {
    mockGroupBy.mockResolvedValue([
      { tenantId: 'tenant-abc', _count: { id: 12 } },
      { tenantId: 'tenant-xyz', _count: { id: 3 } },
    ])

    const res = await GET(makeReq('superadmin'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.total).toBe(15)
    expect(data.byTenant).toHaveLength(2)
    expect(data.byTenant[0]).toEqual({ tenantId: 'tenant-abc', count: 12 })
  })

  it('returns total=0 when no missions need geocoding', async () => {
    mockGroupBy.mockResolvedValue([])

    const res = await GET(makeReq('superadmin'))
    const data = await res.json()
    expect(data.total).toBe(0)
    expect(data.byTenant).toHaveLength(0)
  })

  it('filters by needsGeocode=true', async () => {
    mockGroupBy.mockResolvedValue([])

    await GET(makeReq('superadmin'))

    const [args] = mockGroupBy.mock.calls[0]
    expect(args.where).toEqual({ needsGeocode: true })
  })

  it('returns 500 on DB error', async () => {
    mockGroupBy.mockRejectedValue(new Error('DB down'))

    const res = await GET(makeReq('superadmin'))
    expect(res.status).toBe(500)
  })
})
