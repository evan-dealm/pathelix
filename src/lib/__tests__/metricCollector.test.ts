import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  mission:            { findFirst: vi.fn() },
  plan:               { findFirst: vi.fn() },
  interventionMetric: { create: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/integrationEvents', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { collectInterventionMetric } from '@/lib/metricCollector'

const TENANT    = 't-mc'
const DRIVER    = 'd-mc'
const MISSION   = 'm-mc'
const DATE      = '2026-05-10'

const baseMission = {
  type:                 'POSER',
  estimatedDurationMin: 30,
  maneuverTimeMin:      5,
  siteId:               's-1',
  clientId:             'c-1',
  latitude:             45.75,
  longitude:            4.83,
}

function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function normalInput(overrides: Record<string, string> = {}) {
  return {
    tenantId:  TENANT,
    driverId:  DRIVER,
    missionId: MISSION,
    date:      DATE,
    statuses: {
      [MISSION]: {
        status:    'done',
        en_routeAt: overrides.en_routeAt ?? msAgo(90 * 60_000),
        arrivedAt:  overrides.arrivedAt  ?? msAgo(80 * 60_000),
        startedAt:  overrides.startedAt  ?? msAgo(70 * 60_000),
        doneAt:     overrides.doneAt     ?? msAgo(50 * 60_000),
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.mission.findFirst.mockResolvedValue(baseMission)
  mockPrisma.plan.findFirst.mockResolvedValue(null)
  mockPrisma.interventionMetric.create.mockResolvedValue({ id: 'metric-1' })
})

describe('collectInterventionMetric — early returns', () => {
  it('does nothing when entry status is not "done"', async () => {
    const input = normalInput()
    input.statuses[MISSION].status = 'in_progress'
    await collectInterventionMetric(input)
    expect(mockPrisma.mission.findFirst).not.toHaveBeenCalled()
  })

  it('does nothing when missionId not in statuses', async () => {
    await collectInterventionMetric({
      tenantId: TENANT, driverId: DRIVER, missionId: 'other-id', date: DATE,
      statuses: { [MISSION]: { status: 'done', doneAt: msAgo(1000) } },
    })
    expect(mockPrisma.mission.findFirst).not.toHaveBeenCalled()
  })

  it('does nothing when mission not found in DB', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null)
    await collectInterventionMetric(normalInput())
    expect(mockPrisma.interventionMetric.create).not.toHaveBeenCalled()
  })

  it('does nothing when doneAt is missing', async () => {
    const input = normalInput() as any
    delete input.statuses[MISSION].doneAt
    await collectInterventionMetric(input)
    expect(mockPrisma.interventionMetric.create).not.toHaveBeenCalled()
  })

  it('does nothing when startedAt is missing (actualDurationMin becomes null)', async () => {
    const input = normalInput() as any
    delete input.statuses[MISSION].startedAt
    await collectInterventionMetric(input)
    expect(mockPrisma.interventionMetric.create).not.toHaveBeenCalled()
  })
})

describe('collectInterventionMetric — reliable metric', () => {
  it('creates an interventionMetric with correct fields', async () => {
    await collectInterventionMetric(normalInput())

    expect(mockPrisma.interventionMetric.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId:    TENANT,
          driverId:    DRIVER,
          missionId:   MISSION,
          missionType: 'POSER',
          isReliable:  true,
          rejectReason: null,
        }),
      }),
    )
  })

  it('confidenceScore = 1.0 when all timestamps and GPS coords are present', async () => {
    const input = normalInput() as any
    input.statuses[MISSION].lat = baseMission.latitude
    input.statuses[MISSION].lng = baseMission.longitude
    await collectInterventionMetric(input)
    const { data } = mockPrisma.interventionMetric.create.mock.calls[0][0]
    expect(data.confidenceScore).toBe(1)
  })

  it('confidenceScore is 0.9 when GPS coords absent from status entry', async () => {
    await collectInterventionMetric(normalInput())
    const { data } = mockPrisma.interventionMetric.create.mock.calls[0][0]
    expect(data.confidenceScore).toBeCloseTo(0.9)
  })

  it('uses precomputedTravelMin from plan when found', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue({
      missions: [{ id: MISSION, precomputedTravelMin: 18 }],
      estimatedDistanceKm: 8,
    })
    await collectInterventionMetric(normalInput())
    const { data } = mockPrisma.interventionMetric.create.mock.calls[0][0]
    expect(data.estimatedTravelMin).toBe(18)
  })
})

describe('collectInterventionMetric — reliability rejection', () => {
  it('detects burst_click when en_route→arrived < 10 s', async () => {
    const now = Date.now()
    const input = normalInput({
      en_routeAt: new Date(now - 20_000).toISOString(),
      arrivedAt:  new Date(now -  5_000).toISOString(), // 15 s → but arrived - enroute = 15s
      startedAt:  new Date(now -  3_000).toISOString(), // arrived→started = 2s < 10s
      doneAt:     new Date(now -  1_000).toISOString(),
    })
    await collectInterventionMetric(input)
    const { data } = mockPrisma.interventionMetric.create.mock.calls[0][0]
    expect(data.isReliable).toBe(false)
    expect(data.rejectReason).toMatch(/burst_click/)
  })

  it('detects duration_outlier when actual > 4x expected (POSER: > 120 min)', async () => {
    const now = Date.now()
    const input = normalInput({
      en_routeAt: new Date(now - 200 * 60_000).toISOString(),
      arrivedAt:  new Date(now - 160 * 60_000).toISOString(),
      startedAt:  new Date(now - 150 * 60_000).toISOString(),
      doneAt:     new Date(now).toISOString(),              // 150 min actual
    })
    await collectInterventionMetric(input)
    const { data } = mockPrisma.interventionMetric.create.mock.calls[0][0]
    expect(data.isReliable).toBe(false)
    expect(data.rejectReason).toMatch(/duration_outlier/)
  })

  it('sets confidenceScore = 0.0 for unreliable metric', async () => {
    const now = Date.now()
    const input = normalInput({
      en_routeAt: new Date(now - 20_000).toISOString(),
      arrivedAt:  new Date(now -  5_000).toISOString(),
      startedAt:  new Date(now -  3_000).toISOString(),
      doneAt:     new Date(now -  1_000).toISOString(),
    })
    await collectInterventionMetric(input)
    const { data } = mockPrisma.interventionMetric.create.mock.calls[0][0]
    expect(data.confidenceScore).toBe(0.0)
  })

  it('emits anomaly.detected for unreliable metrics', async () => {
    const { emitEvent } = await import('@/lib/integrationEvents')
    const now = Date.now()
    const input = normalInput({
      en_routeAt: new Date(now - 20_000).toISOString(),
      arrivedAt:  new Date(now -  5_000).toISOString(),
      startedAt:  new Date(now -  3_000).toISOString(),
      doneAt:     new Date(now -  1_000).toISOString(),
    })
    await collectInterventionMetric(input)
    expect(emitEvent).toHaveBeenCalledWith(
      TENANT, 'anomaly.detected',
      expect.objectContaining({ missionId: MISSION }),
    )
  })
})

describe('collectInterventionMetric — error handling', () => {
  it('does not throw when interventionMetric.create fails', async () => {
    mockPrisma.interventionMetric.create.mockRejectedValue(new Error('DB fail'))
    await expect(collectInterventionMetric(normalInput())).resolves.not.toThrow()
  })

  it('does not throw when mission.findFirst fails', async () => {
    mockPrisma.mission.findFirst.mockRejectedValue(new Error('DB fail'))
    await expect(collectInterventionMetric(normalInput())).resolves.not.toThrow()
  })
})
