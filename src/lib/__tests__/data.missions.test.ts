/**
 * Tests for lib/data/missions.ts — DB path (USE_MOCK_DATA=false)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type * as MissionsModule from '../data/missions'

const mockPrisma = vi.hoisted(() => ({
  mission: {
    findMany:   vi.fn(),
    findFirst:  vi.fn(),
    create:     vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/prismaMappers', () => ({
  prismaRowToMission: vi.fn((row: Record<string, unknown>) => ({
    id: row.id, type: row.type ?? 'POSER', date: row.date ?? '2025-06-15',
    address: 'test', latitude: 45.9, longitude: 6.1,
    estimatedDurationMin: 20, maneuverTimeMin: 5,
  })),
}))
vi.mock('@/app/api/missions/_store', () => ({
  getMissionStore: vi.fn(() => []),
}))

let getAllMissions: typeof MissionsModule.getAllMissions
let getMissionsByDate: typeof MissionsModule.getMissionsByDate
let getMission: typeof MissionsModule.getMission
let createMission: typeof MissionsModule.createMission
let updateMission: typeof MissionsModule.updateMission
let deleteMission: typeof MissionsModule.deleteMission

beforeAll(async () => {
  vi.stubEnv('USE_MOCK_DATA', 'false')
  vi.resetModules()
  const mod = await import('../data/missions')
  getAllMissions   = mod.getAllMissions
  getMissionsByDate = mod.getMissionsByDate
  getMission       = mod.getMission
  createMission    = mod.createMission
  updateMission    = mod.updateMission
  deleteMission    = mod.deleteMission
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('getAllMissions (DB path)', () => {
  it('queries prisma with tenantId', async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([])
    await getAllMissions('t-1')
    expect(mockPrisma.mission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't-1' }) }),
    )
  })

  it('applies date filter when provided', async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([])
    await getAllMissions('t-1', { date: '2025-06-15' })
    expect(mockPrisma.mission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ date: '2025-06-15' }) }),
    )
  })

  it('caps take at MAX_PAGE_SIZE', async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([])
    await getAllMissions('t-1', { take: 999_999 })
    expect(mockPrisma.mission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10_000 }),
    )
  })

  it('maps rows through prismaRowToMission', async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([{ id: 'm-1', type: 'POSER', date: '2025-06-15' }])
    const result = await getAllMissions('t-1') as { id: string }[]
    expect(result[0].id).toBe('m-1')
  })
})

describe('getMissionsByDate (DB path)', () => {
  it('filters by date and tenantId', async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([])
    await getMissionsByDate('t-1', '2025-06-15')
    expect(mockPrisma.mission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't-1', date: '2025-06-15' }) }),
    )
  })

  it('returns mapped missions', async () => {
    mockPrisma.mission.findMany.mockResolvedValueOnce([
      { id: 'm-1' }, { id: 'm-2' },
    ])
    const result = await getMissionsByDate('t-1', '2025-06-15') as unknown[]
    expect(result).toHaveLength(2)
  })
})

describe('getMission (DB path)', () => {
  it('returns null when not found', async () => {
    mockPrisma.mission.findFirst.mockResolvedValueOnce(null)
    const result = await getMission('t-1', 'missing')
    expect(result).toBeNull()
  })

  it('queries with id and tenantId', async () => {
    mockPrisma.mission.findFirst.mockResolvedValueOnce(null)
    await getMission('t-1', 'm-1')
    expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'm-1', tenantId: 't-1' }) }),
    )
  })
})

describe('createMission (DB path)', () => {
  it('flattens timeWindow before creating', async () => {
    mockPrisma.mission.create.mockResolvedValueOnce({ id: 'm-new', type: 'POSER', date: '2025-06-15' })
    await createMission('t-1', {
      type: 'POSER', date: '2025-06-15', address: 'x',
      latitude: 45.9, longitude: 6.1, estimatedDurationMin: 20, maneuverTimeMin: 0,
      timeWindow: { openMin: 480, closeMin: 600 },
    })
    const callArg = mockPrisma.mission.create.mock.calls[0][0]
    // timeWindow should be flattened to timeWindowOpenMin / timeWindowCloseMin
    expect(callArg.data.timeWindowOpenMin).toBe(480)
    expect(callArg.data.timeWindowCloseMin).toBe(600)
    expect(callArg.data.timeWindow).toBeUndefined()
  })
})

describe('updateMission (DB path)', () => {
  it('returns null on P2025', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' })
    mockPrisma.mission.update.mockRejectedValueOnce(err)
    const result = await updateMission('t-1', 'missing', {})
    expect(result).toBeNull()
  })

  it('rethrows other errors', async () => {
    mockPrisma.mission.update.mockRejectedValueOnce(new Error('Unexpected'))
    await expect(updateMission('t-1', 'm-1', {})).rejects.toThrow('Unexpected')
  })
})

describe('deleteMission (DB path)', () => {
  it('returns false when count=0', async () => {
    mockPrisma.mission.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await deleteMission('t-1', 'missing')).toBe(false)
  })

  it('returns true and archives mission', async () => {
    mockPrisma.mission.updateMany.mockResolvedValueOnce({ count: 1 })
    expect(await deleteMission('t-1', 'm-1')).toBe(true)
    expect(mockPrisma.mission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ archived: true }) }),
    )
  })
})
