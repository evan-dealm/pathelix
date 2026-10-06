/**
 * Tests for lib/data/drivers.ts — DB path (USE_MOCK_DATA=false)
 * Uses vi.resetModules to re-import the module after setting env var.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type * as DriversModule from '../data/drivers'

// getTenantDb(tenantId) itself is unit-tested exhaustively in tenantDb.test.ts (it always
// injects tenantId into `where`/`data`) — this file only needs to prove drivers.ts calls it
// with the right tenantId and passes everything else through correctly, so the mock returns
// the same fake client regardless of which tenantId getTenantDb was called with, and tests
// assert on `getTenantDbMock` separately from the Prisma call shape.
const mockPrisma = vi.hoisted(() => ({
  driver: {
    findMany:   vi.fn(),
    findFirst:  vi.fn(),
    create:     vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),
  },
}))
const getTenantDbMock = vi.hoisted(() => vi.fn(() => mockPrisma))

vi.mock('@/lib/tenantDb', () => ({ getTenantDb: getTenantDbMock }))
vi.mock('@/lib/prismaMappers', () => ({
  prismaRowToDriver: vi.fn((row: Record<string, unknown>) => ({
    id: row.id, firstName: row.firstName, lastName: row.lastName,
    sector: 'N', depotName: 'D', depotLat: 45.9, depotLng: 6.1, archived: false,
  })),
}))
vi.mock('@/app/api/drivers/_store', () => ({
  getDriverStore: vi.fn(() => []),
}))

let getAllDrivers: (t: string) => Promise<unknown>
let getDriver: (t: string, id: string) => Promise<unknown>
let createDriver: typeof DriversModule.createDriver
let updateDriver: typeof DriversModule.updateDriver
let deleteDriver: (t: string, id: string) => Promise<boolean>

beforeAll(async () => {
  vi.stubEnv('USE_MOCK_DATA', 'false')
  // Must reset modules AFTER stub so the re-import sees the new env
  vi.resetModules()
  const mod = await import('../data/drivers')
  getAllDrivers  = mod.getAllDrivers
  getDriver      = mod.getDriver
  createDriver   = mod.createDriver
  updateDriver   = mod.updateDriver
  deleteDriver   = mod.deleteDriver
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('getAllDrivers (DB path)', () => {
  it('scopes to the tenant via getTenantDb, filters archived', async () => {
    mockPrisma.driver.findMany.mockResolvedValueOnce([])
    await getAllDrivers('t-1')
    expect(getTenantDbMock).toHaveBeenCalledWith('t-1')
    expect(mockPrisma.driver.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ archived: false }) }),
    )
  })

  it('maps rows through prismaRowToDriver', async () => {
    const row = { id: 'd-1', firstName: 'Alice', lastName: 'B', sector: 'N' }
    mockPrisma.driver.findMany.mockResolvedValueOnce([row])
    const result = await getAllDrivers('t-1') as { id: string }[]
    expect(result[0].id).toBe('d-1')
  })

  it('returns empty array when no drivers', async () => {
    mockPrisma.driver.findMany.mockResolvedValueOnce([])
    const result = await getAllDrivers('t-1') as unknown[]
    expect(result).toHaveLength(0)
  })

  // Regression N7: DRIVER_SELECT joined startingExutoire (never read by prismaRowToDriver — only
  // the scalar startingExutoireId is) and selected every Vehicle column via an unfiltered nested
  // `vehicles: {...}` (no `select`), even though the mapper only reads 7 fields off it. Both were
  // wasted joins/over-fetching on every driver list call.
  it('does not join startingExutoire (unused by the mapper — only startingExutoireId is read)', async () => {
    mockPrisma.driver.findMany.mockResolvedValueOnce([])
    await getAllDrivers('t-1')
    const call = mockPrisma.driver.findMany.mock.calls[0][0]
    expect(call.select.startingExutoire).toBeUndefined()
    expect(call.select.startingExutoireId).toBe(true)
  })

  it('selects only the vehicle fields the mapper reads, not every Vehicle column', async () => {
    mockPrisma.driver.findMany.mockResolvedValueOnce([])
    await getAllDrivers('t-1')
    const call = mockPrisma.driver.findMany.mock.calls[0][0]
    expect(call.select.vehicles.select).toEqual({
      id: true, maxBins: true, weightTon: true, heightM: true, widthM: true,
      lengthM: true, axleCount: true, hazmat: true, tareKg: true, payloadKg: true,
    })
  })
})

describe('getDriver (DB path)', () => {
  it('scopes to the tenant via getTenantDb, filters by id', async () => {
    mockPrisma.driver.findFirst.mockResolvedValueOnce(null)
    await getDriver('t-1', 'd-1')
    expect(getTenantDbMock).toHaveBeenCalledWith('t-1')
    expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'd-1' }) }),
    )
  })

  it('returns null when driver not found', async () => {
    mockPrisma.driver.findFirst.mockResolvedValueOnce(null)
    const result = await getDriver('t-1', 'missing')
    expect(result).toBeNull()
  })

  it('returns mapped driver when found', async () => {
    mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'd-1', firstName: 'Alice' })
    const result = await getDriver('t-1', 'd-1') as { id: string }
    expect(result!.id).toBe('d-1')
  })
})

describe('createDriver (DB path)', () => {
  it('creates via getTenantDb, scoped to the tenant', async () => {
    mockPrisma.driver.create.mockResolvedValueOnce({ id: 'd-new', firstName: 'Bob', lastName: 'C' })
    await createDriver('t-1', { firstName: 'Bob', lastName: 'C', sector: 'N', depotName: 'Depot', depotLat: 45.9, depotLng: 6.1 })
    expect(getTenantDbMock).toHaveBeenCalledWith('t-1')
    expect(mockPrisma.driver.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: 'Bob' }) }),
    )
  })

  it('returns created driver', async () => {
    mockPrisma.driver.create.mockResolvedValueOnce({ id: 'd-new', firstName: 'Bob' })
    const result = await createDriver('t-1', { firstName: 'Bob', lastName: 'C', sector: 'N', depotName: 'Depot', depotLat: 45.9, depotLng: 6.1 }) as { id: string }
    expect(result.id).toBe('d-new')
  })
})

describe('updateDriver (DB path)', () => {
  it('returns null on P2025 (not found)', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' })
    mockPrisma.driver.update.mockRejectedValueOnce(err)
    const result = await updateDriver('t-1', 'missing', { firstName: 'X' })
    expect(result).toBeNull()
  })

  it('rethrows non-P2025 errors', async () => {
    const err = new Error('DB connection lost')
    mockPrisma.driver.update.mockRejectedValueOnce(err)
    await expect(updateDriver('t-1', 'd-1', {})).rejects.toThrow('DB connection lost')
  })

  it('returns updated driver on success', async () => {
    mockPrisma.driver.update.mockResolvedValueOnce({ id: 'd-1', firstName: 'Updated' })
    const result = await updateDriver('t-1', 'd-1', { firstName: 'Updated' }) as { id: string }
    expect(result!.id).toBe('d-1')
  })
})

describe('deleteDriver (DB path)', () => {
  it('returns false when driver not found (count=0)', async () => {
    mockPrisma.driver.updateMany.mockResolvedValueOnce({ count: 0 })
    const result = await deleteDriver('t-1', 'missing')
    expect(result).toBe(false)
  })

  it('returns true when driver archived', async () => {
    mockPrisma.driver.updateMany.mockResolvedValueOnce({ count: 1 })
    const result = await deleteDriver('t-1', 'd-1')
    expect(result).toBe(true)
  })

  it('archives instead of hard-deletes', async () => {
    mockPrisma.driver.updateMany.mockResolvedValueOnce({ count: 1 })
    await deleteDriver('t-1', 'd-1')
    expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ archived: true }) }),
    )
  })
})
