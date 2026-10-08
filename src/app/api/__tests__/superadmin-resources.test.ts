/**
 * Tests for POST /api/superadmin/tenants/[id]/resources
 * Covers: RBAC, create/update/delete actions, tenant isolation, audit trail
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TENANT = 'tenant-abc'
const OTHER_TENANT = 'tenant-xyz'

const mockDriver = vi.hoisted(() => ({
  create:     vi.fn(),
  update:     vi.fn(),
  delete:     vi.fn(),
  findUnique: vi.fn(),
}))

const mockTenant = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))

const mockLogSuperadminAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  default: {
    driver:  mockDriver,
    client:  mockDriver,
    vehicle: mockDriver,
    exutoire: mockDriver,
    site:    mockDriver,
    mission: mockDriver,
    missionTemplate: mockDriver,
    tenant:  mockTenant,
  },
}))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'sa-tenant', userId: 'sa-1', role: 'superadmin', requestId: 'r1', trade: null })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/superadminAudit', () => ({
  logSuperadminAction: mockLogSuperadminAction,
}))

import { getRequestContext } from '@/lib/data/context'

function setRole(role: string) {
  vi.mocked(getRequestContext).mockReturnValue({
    tenantId: 'sa-tenant', userId: 'sa-1', role, requestId: 'r1', trade: null,
  })
}

function makeReq(tenantId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/superadmin/tenants/${tenantId}/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

// Every column a driver needs: the route refuses a create that leaves one out (the database
// would refuse it anyway — the shorter payloads used here before only passed against the mock).
const DRIVER = { firstName: 'Bob', lastName: 'Martin', sector: 'Annecy', depotName: '12 rue de la Paix, Annecy', depotLat: '45.9', depotLng: '6.12' }

beforeEach(() => {
  vi.clearAllMocks()
  setRole('superadmin')
  mockTenant.findUnique.mockResolvedValue({ id: TENANT })
  mockDriver.findUnique.mockResolvedValue({ id: 'res-1', tenantId: TENANT })
  mockDriver.create.mockResolvedValue({ id: 'new-res', tenantId: TENANT })
  mockDriver.update.mockResolvedValue({ id: 'res-1', tenantId: TENANT })
  mockDriver.delete.mockResolvedValue({ id: 'res-1' })
})

// ── RBAC ────────────────────────────────────────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/resources — RBAC', () => {
  it('returns 403 for admin', async () => {
    setRole('admin')
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: { firstName: 'Bob' } }), makeParams(TENANT))
    expect(res.status).toBe(403)
  })

  it('returns 403 for dispatcher', async () => {
    setRole('dispatcher')
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: { firstName: 'Bob' } }), makeParams(TENANT))
    expect(res.status).toBe(403)
  })

  it('returns 403 for driver role', async () => {
    setRole('driver')
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: { firstName: 'Bob' } }), makeParams(TENANT))
    expect(res.status).toBe(403)
  })

  it('returns 200 for superadmin on create', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: DRIVER }), makeParams(TENANT))
    expect(res.status).toBe(200)
  })
})

// ── Validation ───────────────────────────────────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/resources — validation', () => {
  it('returns 400 on invalid JSON', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const req = new NextRequest(`http://localhost/api/superadmin/tenants/${TENANT}/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req, makeParams(TENANT))
    expect(res.status).toBe(400)
  })

  it('returns 422 on invalid entity', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'unknown_entity', action: 'create', data: {} }), makeParams(TENANT))
    expect(res.status).toBe(422)
  })

  it('returns 422 on create without data', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'create' }), makeParams(TENANT))
    expect(res.status).toBe(422)
  })

  it('returns 404 when tenant not found', async () => {
    mockTenant.findUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq('no-tenant', { entity: 'driver', action: 'create', data: { firstName: 'Bob' } }), makeParams('no-tenant'))
    expect(res.status).toBe(404)
  })
})

// ── Create action ────────────────────────────────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/resources — create', () => {
  it('calls model.create with tenantId injected', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: { ...DRIVER, firstName: 'Alice' } }), makeParams(TENANT))
    expect(mockDriver.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, firstName: 'Alice' }) })
    )
  })

  it('strips id/createdAt/updatedAt from create data', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    await POST(makeReq(TENANT, {
      entity: 'driver', action: 'create',
      data: { ...DRIVER, id: 'old-id', createdAt: '2020-01-01', updatedAt: '2020-01-01' },
    }), makeParams(TENANT))
    const callArg = mockDriver.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(callArg.data.id).toBeUndefined()
    expect(callArg.data.createdAt).toBeUndefined()
    expect(callArg.data.updatedAt).toBeUndefined()
  })

  it('logs superadmin action on create', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: DRIVER }), makeParams(TENANT))
    expect(mockLogSuperadminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resource_created', details: expect.objectContaining({ entity: 'driver' }) })
    )
  })

  // The console adds a driver, a vehicle, an outlet… to an organisation: an incomplete form is
  // refused by naming the missing columns, not by a database error.
  it('refuses a create that leaves a required column out (422), naming it', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'create', data: { firstName: 'Bob', lastName: '' } }), makeParams(TENANT))
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('lastName')
    expect(body.error).toContain('depotLat')
    expect(mockDriver.create).not.toHaveBeenCalled()
  })

  it('creates an outlet with its opening hours and service time as numbers', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, {
      entity: 'exutoire', action: 'create',
      data: { name: 'Déchetterie', address: 'ZI Nord', lat: '45.9', lng: '6.1', openingHoursOpen: '420', openingHoursClose: '1020', serviceTimeMin: '15' },
    }), makeParams(TENANT))
    expect(res.status).toBe(200)
    expect(mockDriver.create).toHaveBeenCalledWith({
      data: { name: 'Déchetterie', address: 'ZI Nord', lat: 45.9, lng: 6.1, openingHoursOpen: 420, openingHoursClose: 1020, serviceTimeMin: 15, tenantId: TENANT },
    })
  })

  it('creates a client from its name alone', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'client', action: 'create', data: { name: 'BTP Alpes' } }), makeParams(TENANT))
    expect(res.status).toBe(200)
  })
})

// ── Update action ────────────────────────────────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/resources — update', () => {
  it('returns 422 without id', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'update', data: { firstName: 'New' } }), makeParams(TENANT))
    expect(res.status).toBe(422)
  })

  it('returns 404 when resource belongs to other tenant', async () => {
    mockDriver.findUnique.mockResolvedValue({ id: 'res-1', tenantId: OTHER_TENANT })
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'update', id: 'res-1', data: { firstName: 'New' } }), makeParams(TENANT))
    expect(res.status).toBe(404)
  })

  // The console's edit form sends every value as text: saving a driver used to fail on the
  // first number or boolean column.
  it('converts the form text values to the column types', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, {
      entity: 'driver', action: 'update', id: 'res-1',
      data: { firstName: 'Léa', depotLat: '45.19', depotLng: '5.72', maxBinSizeM3: '', archived: 'true' },
    }), makeParams(TENANT))
    expect(res.status).toBe(200)
    expect(mockDriver.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { firstName: 'Léa', depotLat: 45.19, depotLng: 5.72, maxBinSizeM3: null, archived: true },
    })
  })

  it.each([
    ['a relation to another row', { vehicleId: 'veh-of-another-tenant' }],
    ['an unknown column', { isAdmin: 'true' }],
    ['a coordinate that is not a number', { depotLat: 'abc' }],
  ])('refuses %s (422) without writing', async (_label, data) => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'update', id: 'res-1', data }), makeParams(TENANT))
    expect(res.status).toBe(422)
    expect(mockDriver.update).not.toHaveBeenCalled()
  })

  it('calls model.update on valid request', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'update', id: 'res-1', data: { firstName: 'Updated' } }), makeParams(TENANT))
    expect(res.status).toBe(200)
    expect(mockDriver.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'res-1' }, data: expect.objectContaining({ firstName: 'Updated' }) })
    )
  })

  it('logs superadmin action on update', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    await POST(makeReq(TENANT, { entity: 'driver', action: 'update', id: 'res-1', data: { firstName: 'Updated' } }), makeParams(TENANT))
    expect(mockLogSuperadminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resource_updated', details: expect.objectContaining({ entity: 'driver', resourceId: 'res-1' }) })
    )
  })
})

// ── Delete action ────────────────────────────────────────────────────────────

describe('POST /api/superadmin/tenants/[id]/resources — delete', () => {
  it('returns 422 without id', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'delete' }), makeParams(TENANT))
    expect(res.status).toBe(422)
  })

  it('returns 404 when resource not found', async () => {
    mockDriver.findUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'delete', id: 'ghost' }), makeParams(TENANT))
    expect(res.status).toBe(404)
  })

  it('calls model.delete on valid request', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'delete', id: 'res-1' }), makeParams(TENANT))
    expect(res.status).toBe(200)
    expect(mockDriver.delete).toHaveBeenCalledWith({ where: { id: 'res-1' } })
  })

  it('returns 404 when resource belongs to other tenant (isolation)', async () => {
    mockDriver.findUnique.mockResolvedValue({ id: 'res-1', tenantId: OTHER_TENANT })
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    const res = await POST(makeReq(TENANT, { entity: 'driver', action: 'delete', id: 'res-1' }), makeParams(TENANT))
    expect(res.status).toBe(404)
    expect(mockDriver.delete).not.toHaveBeenCalled()
  })

  it('logs superadmin action on delete', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    await POST(makeReq(TENANT, { entity: 'driver', action: 'delete', id: 'res-1' }), makeParams(TENANT))
    expect(mockLogSuperadminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resource_deleted', details: expect.objectContaining({ entity: 'driver', resourceId: 'res-1' }) })
    )
  })
})
