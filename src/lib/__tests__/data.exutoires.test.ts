import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type * as ExutoiresModule from '../data/exutoires'

const mockPrisma = vi.hoisted(() => ({
  exutoire: {
    findMany:  vi.fn(),
    findFirst: vi.fn(),
    create:    vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
  },
  siteProduct: { updateMany: vi.fn() },
  mission:     { updateMany: vi.fn() },
  $transaction: vi.fn(),
}))

const getTenantDbMock = vi.hoisted(() => vi.fn(() => mockPrisma))
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: getTenantDbMock }))
vi.mock('@/lib/prismaMappers', () => ({
  prismaRowToExutoire: vi.fn((row: Record<string, unknown>) => ({
    id: row.id, name: row.name ?? 'Centre',
    lat: row.lat ?? 45.9, lng: row.lng ?? 6.1,
    openingHoursOpen: 420, openingHoursClose: 1080,
    closedDays: [], acceptedWasteTypes: [],
    serviceTimeMin: 20, archived: false,
  })),
}))
vi.mock('@/app/api/exutoires/_store', () => ({
  getExutoireStore: vi.fn(() => []),
  findExutoire:     vi.fn(() => null),
  addExutoire:      vi.fn(),
  updateExutoire:   vi.fn(() => null),
  deleteExutoire:   vi.fn(() => false),
}))

let getAllExutoires: typeof ExutoiresModule.getAllExutoires
let getExutoire: typeof ExutoiresModule.getExutoire
let createExutoire: typeof ExutoiresModule.createExutoire
let updateExutoire: typeof ExutoiresModule.updateExutoire
let deleteExutoire: (t: string, id: string) => Promise<boolean>

beforeAll(async () => {
  vi.stubEnv('USE_MOCK_DATA', 'false')
  vi.resetModules()
  const mod = await import('../data/exutoires')
  getAllExutoires = mod.getAllExutoires
  getExutoire    = mod.getExutoire
  createExutoire = mod.createExutoire
  updateExutoire = mod.updateExutoire
  deleteExutoire = mod.deleteExutoire
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('getAllExutoires (DB path)', () => {
  it('scopes to the tenant via getTenantDb', async () => {
    mockPrisma.exutoire.findMany.mockResolvedValueOnce([])
    await getAllExutoires('t-1')
    expect(getTenantDbMock).toHaveBeenCalledWith('t-1')
  })

  it('orders by name ascending', async () => {
    mockPrisma.exutoire.findMany.mockResolvedValueOnce([])
    await getAllExutoires('t-1')
    expect(mockPrisma.exutoire.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } }),
    )
  })

  it('maps rows through prismaRowToExutoire', async () => {
    mockPrisma.exutoire.findMany.mockResolvedValueOnce([{ id: 'e-1', name: 'Centre' }])
    const result = await getAllExutoires('t-1')
    expect(result[0].id).toBe('e-1')
  })

  it('returns empty array when no exutoires', async () => {
    mockPrisma.exutoire.findMany.mockResolvedValueOnce([])
    expect(await getAllExutoires('t-1')).toHaveLength(0)
  })

  it('select contient tous les champs exigés par prismaRowToExutoire — regression: address omis → 500', async () => {
    mockPrisma.exutoire.findMany.mockResolvedValueOnce([])
    await getAllExutoires('t-1')
    const call = mockPrisma.exutoire.findMany.mock.calls.at(-1)![0] as { select: Record<string, boolean> }
    const requiredByMapper = [
      'id', 'name', 'address', 'lat', 'lng',
      'openingHoursOpen', 'openingHoursClose',
      'closedDays', 'acceptedWasteTypes', 'serviceTimeMin',
    ]
    for (const field of requiredByMapper) {
      expect(call.select, `champ manquant dans EXUTOIRE_LIST_SELECT: ${field}`).toHaveProperty(field, true)
    }
  })
})

describe('getExutoire (DB path)', () => {
  it('scopes to the tenant via getTenantDb, filters by id', async () => {
    mockPrisma.exutoire.findFirst.mockResolvedValueOnce(null)
    await getExutoire('t-1', 'e-1')
    expect(getTenantDbMock).toHaveBeenCalledWith('t-1')
    expect(mockPrisma.exutoire.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'e-1' }) }),
    )
  })

  it('returns null when not found', async () => {
    mockPrisma.exutoire.findFirst.mockResolvedValueOnce(null)
    expect(await getExutoire('t-1', 'missing')).toBeNull()
  })

  it('returns mapped exutoire when found', async () => {
    mockPrisma.exutoire.findFirst.mockResolvedValueOnce({ id: 'e-1', name: 'Centre' })
    const result = await getExutoire('t-1', 'e-1')
    expect(result!.id).toBe('e-1')
  })
})

describe('createExutoire (DB path)', () => {
  it('creates via getTenantDb, scoped to the tenant', async () => {
    mockPrisma.exutoire.create.mockResolvedValueOnce({ id: 'e-new', name: 'Nouveau' })
    await createExutoire('t-1', { name: 'Nouveau', address: 'Rue de test', lat: 45.9, lng: 6.1, openingHoursOpen: 480, openingHoursClose: 1080, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 20 })
    expect(getTenantDbMock).toHaveBeenCalledWith('t-1')
    expect(mockPrisma.exutoire.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Nouveau' }) }),
    )
  })

  it('returns mapped exutoire', async () => {
    mockPrisma.exutoire.create.mockResolvedValueOnce({ id: 'e-new', name: 'Nouveau' })
    const result = await createExutoire('t-1', { name: 'Nouveau', address: 'Rue de test', lat: 45.9, lng: 6.1, openingHoursOpen: 480, openingHoursClose: 1080, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 20 })
    expect(result.id).toBe('e-new')
  })
})

describe('updateExutoire (DB path)', () => {
  it('returns null on P2025', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' })
    mockPrisma.exutoire.update.mockRejectedValueOnce(err)
    expect(await updateExutoire('t-1', 'missing', { name: 'X' })).toBeNull()
  })

  it('rethrows non-P2025 errors', async () => {
    mockPrisma.exutoire.update.mockRejectedValueOnce(new Error('DB error'))
    await expect(updateExutoire('t-1', 'e-1', {})).rejects.toThrow('DB error')
  })

  it('returns updated exutoire on success', async () => {
    mockPrisma.exutoire.update.mockResolvedValueOnce({ id: 'e-1', name: 'Updated' })
    const result = await updateExutoire('t-1', 'e-1', { name: 'Updated' })
    expect(result!.id).toBe('e-1')
  })
})

describe('deleteExutoire (DB path)', () => {
  it('returns false when exutoire not found in transaction', async () => {
    mockPrisma.$transaction.mockImplementationOnce(
      async (fn) => fn({
        exutoire:    { findFirst: vi.fn().mockResolvedValueOnce(null), delete: vi.fn() },
        siteProduct: { updateMany: vi.fn() },
        mission:     { updateMany: vi.fn() },
      }),
    )
    expect(await deleteExutoire('t-1', 'missing')).toBe(false)
  })

  it('returns true, nullifies references, and deletes when found', async () => {
    const txDelete   = vi.fn().mockResolvedValueOnce({})
    const txSpUpdate = vi.fn().mockResolvedValueOnce({ count: 0 })
    const txMsUpdate = vi.fn().mockResolvedValueOnce({ count: 0 })
    mockPrisma.$transaction.mockImplementationOnce(
      async (fn) => fn({
        exutoire:    { findFirst: vi.fn().mockResolvedValueOnce({ id: 'e-1' }), delete: txDelete },
        siteProduct: { updateMany: txSpUpdate },
        mission:     { updateMany: txMsUpdate },
      }),
    )
    expect(await deleteExutoire('t-1', 'e-1')).toBe(true)
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 'e-1' } })
    expect(txSpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultExutoireId: null } }),
    )
    expect(txMsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { linkedExutoireId: null } }),
    )
  })

  it('returns false on P2025 transaction error', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' })
    mockPrisma.$transaction.mockRejectedValueOnce(err)
    expect(await deleteExutoire('t-1', 'e-1')).toBe(false)
  })

  it('rethrows non-P2025 transaction errors', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('TX failed'))
    await expect(deleteExutoire('t-1', 'e-1')).rejects.toThrow('TX failed')
  })
})
