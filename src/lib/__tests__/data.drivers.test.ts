/**
 * Tests for lib/data/drivers.ts — DB path (USE_MOCK_DATA=false)
 * Uses vi.resetModules to re-import the module after setting env var.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type * as DriversModule from '../data/drivers'

const mockPrisma = vi.hoisted(() => ({
  driver: {
    findMany:   vi.fn(),
    findFirst:  vi.fn(),
    create:     vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
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
  it('calls prisma.driver.findMany with tenantId filter', async () => {
    mockPrisma.driver.findMany.mockResolvedValueOnce([])
    await getAllDrivers('t-1')
    expect(mockPrisma.driver.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't-1', archived: false }) }),
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
})

describe('getDriver (DB path)', () => {
  it('calls prisma.driver.findFirst with id and tenantId', async () => {
    mockPrisma.driver.findFirst.mockResolvedValueOnce(null)
    await getDriver('t-1', 'd-1')
    expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'd-1', tenantId: 't-1' }) }),
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
  it('calls prisma.driver.create with tenantId', async () => {
    mockPrisma.driver.create.mockResolvedValueOnce({ id: 'd-new', firstName: 'Bob', lastName: 'C' })
    await createDriver('t-1', { firstName: 'Bob', lastName: 'C', sector: 'N', depotName: 'Depot', depotLat: 45.9, depotLng: 6.1 })
    expect(mockPrisma.driver.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 't-1' }) }),
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
