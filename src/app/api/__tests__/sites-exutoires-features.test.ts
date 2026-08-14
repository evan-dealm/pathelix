/**
 * Tests for:
 *   GET/POST    /api/sites
 *   GET/PUT/DELETE /api/exutoires/[id]
 *   GET/PUT     /api/features
 *   POST        /api/users/[id]/reset-password
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = vi.hoisted(() => ({
  site:            { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  client:          { findFirst: vi.fn(), count: vi.fn() },
  clientSite:      { findMany: vi.fn() },
  tenantSettings:  { upsert: vi.fn() },
  user:            { findFirst: vi.fn(), update: vi.fn() },
  userPermission:  { findMany: vi.fn(() => Promise.resolve([])) },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })),
  getTenantId:       vi.fn(() => 'tenant-1'),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    invalidateAll: vi.fn(),
    getOrSet: vi.fn((_m: string, _t: string, fn: () => Promise<unknown>) => fn()),
  },
}))

vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn() },
  METRIC:  { API_REQUESTS: 'api.requests', API_ERRORS: 'api.errors' },
}))

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlags:       vi.fn(async () => ({ advanced_vrp: true })),
  invalidateFlagsCache:  vi.fn(),
}))

vi.mock('@/lib/data/exutoires', () => ({
  getExutoire:    vi.fn(),
  updateExutoire: vi.fn(),
  deleteExutoire: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(async () => '$2b$12$newhash') },
  hash: vi.fn(async () => '$2b$12$newhash'),
}))

import { GET as sitesGET, POST as sitesPOST }       from '@/app/api/sites/route'
import { GET as exutoireGet, PUT as exutoirePut, DELETE as exutoireDel } from '@/app/api/exutoires/[id]/route'
import { GET as featuresGET, PUT as featuresPUT }   from '@/app/api/features/route'
import { POST as resetPasswordPost }                from '@/app/api/users/[id]/reset-password/route'
import { getRequestContext, getTenantId }            from '@/lib/data/context'
import { getExutoire, updateExutoire, deleteExutoire } from '@/lib/data/exutoires'

function makeGet(url: string): NextRequest { return new NextRequest(url) }
function makePost(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makePut(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function makeDelete(url: string): NextRequest { return new NextRequest(url, { method: 'DELETE' }) }
function makeParams(id: string) { return { params: Promise.resolve({ id }) } }

// ── GET /api/sites ────────────────────────────────────────────────────────────

describe('GET /api/sites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantId).mockReturnValue('tenant-1')
  })

  it('returns sites list with pagination (200)', async () => {
    mockPrisma.site.findMany.mockResolvedValue([{ id: 's-1', name: 'Site Alpha', clientSites: [] }])
    mockPrisma.site.count.mockResolvedValue(1)
    const res  = await sitesGET(makeGet('http://localhost/api/sites'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.pagination).toBeDefined()
  })

  it('returns empty list when no sites', async () => {
    mockPrisma.site.findMany.mockResolvedValue([])
    mockPrisma.site.count.mockResolvedValue(0)
    const res  = await sitesGET(makeGet('http://localhost/api/sites'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(0)
  })

  it('filters by clientId when provided', async () => {
    mockPrisma.client.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1' })
    mockPrisma.clientSite.findMany.mockResolvedValue([{ siteId: 's-1' }])
    mockPrisma.site.findMany.mockResolvedValue([])
    mockPrisma.site.count.mockResolvedValue(0)
    const res = await sitesGET(makeGet('http://localhost/api/sites?clientId=c-1'))
    expect(res.status).toBe(200)
  })

  it('returns 404 when clientId not found in tenant', async () => {
    mockPrisma.client.findFirst.mockResolvedValue(null)
    const res = await sitesGET(makeGet('http://localhost/api/sites?clientId=missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.site.findMany.mockRejectedValue(new Error('DB fail'))
    const res = await sitesGET(makeGet('http://localhost/api/sites'))
    expect(res.status).toBe(500)
  })
})

// ── POST /api/sites ───────────────────────────────────────────────────────────

describe('POST /api/sites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('creates site with valid body (201)', async () => {
    mockPrisma.site.create.mockResolvedValue({ id: 's-new', name: 'New Site', tenantId: 'tenant-1', clientSites: [] })
    const res  = await sitesPOST(makePost('http://localhost/api/sites', { name: 'New Site' }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.id).toBe('s-new')
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await sitesPOST(makePost('http://localhost/api/sites', { name: 'Site' }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for missing name', async () => {
    const res = await sitesPOST(makePost('http://localhost/api/sites', {}))
    expect(res.status).toBe(422)
  })

  it('returns 400 when clientIds reference unknown clients', async () => {
    mockPrisma.client.count.mockResolvedValue(0)
    const res = await sitesPOST(makePost('http://localhost/api/sites', { name: 'Site', clientIds: ['c-unknown'] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await sitesPOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.site.create.mockRejectedValue(new Error('DB fail'))
    const res = await sitesPOST(makePost('http://localhost/api/sites', { name: 'Site' }))
    expect(res.status).toBe(500)
  })
})

// ── GET /api/exutoires/[id] ───────────────────────────────────────────────────

describe('GET /api/exutoires/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getTenantId).mockReturnValue('tenant-1') })

  it('returns exutoire (200)', async () => {
    vi.mocked(getExutoire).mockResolvedValue({ id: 'e-1', name: 'Exutoire 1', tenantId: 'tenant-1' } as never)
    const res  = await exutoireGet(makeGet('http://localhost/api/exutoires/e-1'), makeParams('e-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.id).toBe('e-1')
  })

  it('returns 404 when not found', async () => {
    vi.mocked(getExutoire).mockResolvedValue(null)
    const res = await exutoireGet(makeGet('http://localhost/api/exutoires/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 on error', async () => {
    vi.mocked(getExutoire).mockRejectedValue(new Error('DB fail'))
    const res = await exutoireGet(makeGet('http://localhost/api/exutoires/e-1'), makeParams('e-1'))
    expect(res.status).toBe(500)
  })
})

// ── PUT /api/exutoires/[id] ───────────────────────────────────────────────────

describe('PUT /api/exutoires/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('updates exutoire (200)', async () => {
    vi.mocked(updateExutoire).mockResolvedValue({ id: 'e-1', name: 'Updated', tenantId: 'tenant-1' } as never)
    const res  = await exutoirePut(makePut('http://localhost/api/exutoires/e-1', { name: 'Updated' }), makeParams('e-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.name).toBe('Updated')
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await exutoirePut(makePut('http://localhost/api/exutoires/e-1', { name: 'X' }), makeParams('e-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when not found', async () => {
    vi.mocked(updateExutoire).mockResolvedValue(null)
    const res = await exutoirePut(makePut('http://localhost/api/exutoires/missing', { name: 'X' }), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/exutoires/e-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await exutoirePut(req, makeParams('e-1'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on error', async () => {
    vi.mocked(updateExutoire).mockRejectedValue(new Error('DB fail'))
    const res = await exutoirePut(makePut('http://localhost/api/exutoires/e-1', { name: 'X' }), makeParams('e-1'))
    expect(res.status).toBe(500)
  })
})

// ── DELETE /api/exutoires/[id] ────────────────────────────────────────────────

describe('DELETE /api/exutoires/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('deletes exutoire (200)', async () => {
    vi.mocked(deleteExutoire).mockResolvedValue(true)
    const res  = await exutoireDel(makeDelete('http://localhost/api/exutoires/e-1'), makeParams('e-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 404 when not found', async () => {
    vi.mocked(deleteExutoire).mockResolvedValue(false)
    const res = await exutoireDel(makeDelete('http://localhost/api/exutoires/missing'), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await exutoireDel(makeDelete('http://localhost/api/exutoires/e-1'), makeParams('e-1'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on error', async () => {
    vi.mocked(deleteExutoire).mockRejectedValue(new Error('DB fail'))
    const res = await exutoireDel(makeDelete('http://localhost/api/exutoires/e-1'), makeParams('e-1'))
    expect(res.status).toBe(500)
  })
})

// ── GET /api/features ─────────────────────────────────────────────────────────

describe('GET /api/features', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns feature flags for tenant (200)', async () => {
    const { getFeatureFlags } = await import('@/lib/featureFlags')
    vi.mocked(getFeatureFlags).mockResolvedValue({ gantt: true, recurring: false, incidents: false, webPush: false, pdf: false, apiDocs: false, weather: false, delayScoring: false, anomalyDetect: false, tracking: true, customForms: false, benchmarking: false })
    const res  = await featuresGET(makeGet('http://localhost/api/features'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.flags).toBeDefined()
  })
})

// ── PUT /api/features ─────────────────────────────────────────────────────────

describe('PUT /api/features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('updates feature flags for admin (200)', async () => {
    const { getFeatureFlags } = await import('@/lib/featureFlags')
    vi.mocked(getFeatureFlags).mockResolvedValue({ gantt: true, recurring: false, incidents: false, webPush: false, pdf: false, apiDocs: false, weather: false, delayScoring: false, anomalyDetect: false, tracking: false, customForms: false, benchmarking: false })
    mockPrisma.tenantSettings.upsert.mockResolvedValue({})
    const res  = await featuresPUT(makePut('http://localhost/api/features', { advanced_vrp: false }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.flags).toBeDefined()
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await featuresPUT(makePut('http://localhost/api/features', { advanced_vrp: false }))
    expect(res.status).toBe(403)
  })

  it('returns 422 for non-boolean values in flags', async () => {
    const res = await featuresPUT(makePut('http://localhost/api/features', { flag: 'yes' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/features', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await featuresPUT(req)
    expect(res.status).toBe(400)
  })
})

// ── POST /api/users/[id]/reset-password ──────────────────────────────────────

describe('POST /api/users/[id]/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'admin-1', role: 'admin', requestId: 'req-1', trade: null })
  })

  it('resets password for admin (200)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-1', tenantId: 'tenant-1' })
    mockPrisma.user.update.mockResolvedValue({ id: 'u-1' })
    const res  = await resetPasswordPost(makePost('http://localhost/api/users/u-1/reset-password', { newPassword: 'NewSecurePass1!' }), makeParams('u-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('returns 403 for dispatcher role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({ tenantId: 'tenant-1', userId: 'u-1', role: 'dispatcher', requestId: 'req-1', trade: null })
    const res = await resetPasswordPost(makePost('http://localhost/api/users/u-1/reset-password', { newPassword: 'NewSecurePass1!' }), makeParams('u-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found in tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)
    const res = await resetPasswordPost(makePost('http://localhost/api/users/missing/reset-password', { newPassword: 'NewSecurePass1!' }), makeParams('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 422 when newPassword too short (< 12 chars)', async () => {
    const res = await resetPasswordPost(makePost('http://localhost/api/users/u-1/reset-password', { newPassword: 'short' }), makeParams('u-1'))
    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/users/u-1/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const res = await resetPasswordPost(req, makeParams('u-1'))
    expect(res.status).toBe(400)
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB fail'))
    const res = await resetPasswordPost(makePost('http://localhost/api/users/u-1/reset-password', { newPassword: 'NewSecurePass1!' }), makeParams('u-1'))
    expect(res.status).toBe(500)
  })
})
