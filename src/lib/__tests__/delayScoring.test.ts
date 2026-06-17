import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  mission:            { findMany: vi.fn() },
  interventionMetric: { findMany: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { computeDelayScores, getDelayScoresForDate } from '@/lib/delayScoring'

const DATE = '2026-05-10'
const TENANT = 't-1'

const baseMission = {
  id: 'm-1', address: '10 rue Test', clientName: 'Acme',
  estimatedDurationMin: 60, latitude: 45.76, longitude: 4.83, type: 'POSER',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeDelayScores', () => {
  it('returns empty array when no P1 missions', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([])

    const result = await computeDelayScores(TENANT, DATE)
    expect(result).toEqual([])
  })

  it('returns low risk when avgRatio ≤ 1.0 (no delay)', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([
      { estimatedDurationMin: 60, actualDurationMin: 55, missionType: 'POSER' },
      { estimatedDurationMin: 60, actualDurationMin: 60, missionType: 'POSER' },
    ])

    const [score] = await computeDelayScores(TENANT, DATE)
    expect(score.riskLevel).toBe('low')
    expect(score.predictedDelay).toBe(0)
    expect(score.delayProbability).toBe(0)
  })

  it('returns medium risk when avgRatio is between 1.15 and 1.3', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([
      { estimatedDurationMin: 60, actualDurationMin: 73, missionType: 'POSER' },
    ])

    const [score] = await computeDelayScores(TENANT, DATE)
    expect(score.riskLevel).toBe('medium')
  })

  it('returns high risk when avgRatio > 1.3', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([
      { estimatedDurationMin: 60, actualDurationMin: 90, missionType: 'POSER' },
    ])

    const [score] = await computeDelayScores(TENANT, DATE)
    expect(score.riskLevel).toBe('high')
  })

  it('uses avgRatio=1.0 when no matching metrics for mission type', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([
      { estimatedDurationMin: 60, actualDurationMin: 90, missionType: 'RETIRER' },
    ])

    const [score] = await computeDelayScores(TENANT, DATE)
    expect(score.riskLevel).toBe('low')
    expect(score.predictedDelay).toBe(0)
  })

  it('returns correct score shape', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([])

    const [score] = await computeDelayScores(TENANT, DATE)
    expect(score).toMatchObject({
      missionDate:          DATE,
      tenantId:             TENANT,
      address:              baseMission.address,
      clientName:           baseMission.clientName,
      estimatedDurationMin: baseMission.estimatedDurationMin,
    })
    expect(typeof score.predictedDelay).toBe('number')
    expect(typeof score.delayProbability).toBe('number')
    expect(['low', 'medium', 'high']).toContain(score.riskLevel)
  })

  it('handles multiple missions with different types', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([
      { ...baseMission, id: 'm-1', type: 'POSER' },
      { ...baseMission, id: 'm-2', type: 'RETIRER', estimatedDurationMin: 30 },
    ])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([
      { estimatedDurationMin: 60, actualDurationMin: 78, missionType: 'POSER' },
    ])

    const scores = await computeDelayScores(TENANT, DATE)
    expect(scores).toHaveLength(2)
    const retirer = scores.find(s => s.address === baseMission.address && s.estimatedDurationMin === 30)
    expect(retirer?.riskLevel).toBe('low')
  })
})

describe('getDelayScoresForDate', () => {
  it('returns scores on success', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission])
    mockPrisma.interventionMetric.findMany.mockResolvedValue([])

    const scores = await getDelayScoresForDate(TENANT, DATE)
    expect(Array.isArray(scores)).toBe(true)
  })

  it('returns empty array on error (non-fatal)', async () => {
    mockPrisma.mission.findMany.mockRejectedValue(new Error('DB fail'))

    const scores = await getDelayScoresForDate(TENANT, DATE)
    expect(scores).toEqual([])
  })
})
