import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const ctx = vi.hoisted(() => ({ value: { tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'r', trade: null, driverRef: null as string | null } }))
vi.mock('@/lib/data/context', () => ({ getRequestContext: () => ctx.value }))

const mockReadFile = vi.hoisted(() => vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff])))
vi.mock('node:fs/promises', () => ({ default: { readFile: mockReadFile } }))

const mockDriverFindFirst = vi.hoisted(() => vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'd1' })))
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => ({ driver: { findFirst: mockDriverFindFirst } }) }))

import { GET } from '@/app/api/files/[...path]/route'

const call = (segments: string[]) =>
  GET(new NextRequest(`http://localhost/api/files/${segments.join('/')}`), { params: Promise.resolve({ path: segments }) })

beforeEach(() => {
  vi.clearAllMocks()
  ctx.value = { tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'r', trade: null, driverRef: null }
})

describe('GET /api/files/[...path]', () => {
  it('serves a file of the caller\'s tenant with a safe content type', async () => {
    const res = await call(['t1', 'proofs', 'proof-abc.jpg'])
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('private')
  })

  it('never serves another tenant\'s file', async () => {
    const res = await call(['t2', 'proofs', 'proof-abc.jpg'])
    expect(res.status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('rejects traversal segments and unknown kinds', async () => {
    expect((await call(['t1', 'photos', '..'])).status).toBe(404)
    expect((await call(['t1', 'secrets', 'a.jpg'])).status).toBe(404)
    expect((await call(['t1', 'photos', 'a.html'])).status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('lets a driver read only its own photos', async () => {
    ctx.value = { ...ctx.value, role: 'driver', driverRef: 'd1' }
    expect((await call(['t1', 'photos', 'd1_2026-01-01_m1.jpg'])).status).toBe(200)
    expect((await call(['t1', 'photos', 'd2_2026-01-01_m1.jpg'])).status).toBe(404)
    expect((await call(['t1', 'proofs', 'proof-x.jpg'])).status).toBe(404)
  })

  it('serves legacy proofs only to staff of the matching tenant', async () => {
    expect((await call(['legacy', 't1', 'proof-x.jpg'])).status).toBe(200)
    expect((await call(['legacy', 't2', 'proof-x.jpg'])).status).toBe(404)
  })

  it('checks a legacy photo\'s driver belongs to the caller\'s tenant', async () => {
    mockDriverFindFirst.mockResolvedValueOnce(null)
    expect((await call(['legacy', 'photos', 'dX_2026-01-01_m1.jpg'])).status).toBe(404)
    expect((await call(['legacy', 'photos', 'd1_2026-01-01_m1.jpg'])).status).toBe(200)
  })

  it('returns 404 when the file does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }))
    expect((await call(['t1', 'proofs', 'proof-missing.jpg'])).status).toBe(404)
  })
})
