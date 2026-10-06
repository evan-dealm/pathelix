import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
const ctx = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('@/lib/data/context', () => ({ getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: ctx.role, requestId: 'r' })) }))
vi.mock('@/lib/permissions', async (orig) => {
  const real = await orig<typeof import('@/lib/permissions')>()
  return { ...real, hasPermission: vi.fn(async (_u: string, role: string, p: string) => role === 'admin' || (real.DEFAULT_PERMISSIONS[role] ?? []).includes(p as never)) }
})
const db = vi.hoisted(() => {
  const f = () => ({ findMany: vi.fn(async () => []) })
  return { mission: f(), client: f(), site: f(), container: f(), driver: f(), vehicle: f(), quote: f(), order: f(), invoice: f() }
})
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => db }))

import { GET } from '@/app/api/search/route'

const req = (q: string) => new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`)

beforeEach(() => { for (const m of Object.values(db)) m.findMany.mockClear() })

describe('GET /api/search', () => {
  it('needs two characters', async () => {
    expect(await (await GET(req('a'))).json()).toEqual({ hits: [] })
    expect(db.client.findMany).not.toHaveBeenCalled()
  })

  it('searches every family for an admin, case-insensitively', async () => {
    db.client.findMany.mockResolvedValueOnce([{ id: 'c1', name: 'Dupont BTP', email: 'a@b.fr', phone: '' }] as never)
    db.invoice.findMany.mockResolvedValueOnce([{ id: 'i1', number: 'FAC-2026-00001', clientName: 'Dupont BTP', kind: 'INVOICE', status: 'ISSUED', totalTTC: 120 }] as never)
    const body = await (await GET(req('dupont'))).json()
    expect(body.hits.map((h: { kind: string }) => h.kind)).toEqual(['client', 'invoice'])
    expect(JSON.stringify(db.client.findMany.mock.calls[0])).toContain('"mode":"insensitive"')
  })

  it('a dispatcher does not see invoices (no manage_billing)', async () => {
    ctx.role = 'dispatcher'
    await GET(req('dupont'))
    expect(db.invoice.findMany).not.toHaveBeenCalled()
    expect(db.quote.findMany).toHaveBeenCalled()
    ctx.role = 'admin'
  })

  it('refuses drivers', async () => {
    ctx.role = 'driver'
    expect((await GET(req('dupont'))).status).toBe(403)
    ctx.role = 'admin'
  })
})
