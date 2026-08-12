import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockFindMany   = vi.hoisted(() => vi.fn())
const mockFindFirst  = vi.hoisted(() => vi.fn())
const mockCreate     = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    missionTemplate: { findMany: mockFindMany },
    mission:         { findFirst: mockFindFirst, create: mockCreate },
  },
}))

vi.mock('@/generated/prisma', () => ({ MissionType: {} }))

// main() (Redis/BullMQ startup) only runs when this file is executed directly (isDirectRun
// guard) — safe to import here without mocking bullmq/redisClient/process.exit.
import { processRecurringMissions } from '../recurringMissionsWorker'
import type { Job } from 'bullmq'

const FAKE_JOB = {} as Job

function makeTemplate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id:                   'tpl-1',
    tenantId:             'tenant-1',
    enabled:              true,
    label:                'Collecte hebdo',
    type:                 'POSER',
    address:              '1 rue Test',
    latitude:             45.0,
    longitude:            5.0,
    clientName:           'Client A',
    estimatedDurationMin: 15,
    maneuverTimeMin:      5,
    wasteTypeLabel:       null,
    binSize:              null,
    binSizeM3:            null,
    accessNotes:          null,
    priority:             null,
    timeWindow:           null,
    linkedExutoireId:     null,
    startDate:            new Date().toISOString(),
    endDate:              null,
    recurrence:           { kind: 'daily', everyN: 1 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processRecurringMissions', () => {
  it('creates missions for templates with no existing occurrence', async () => {
    mockFindMany.mockResolvedValue([makeTemplate()])
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockResolvedValue({})

    const result = await processRecurringMissions(FAKE_JOB)

    expect(result.created).toBeGreaterThan(0)
    expect(result.errors).toBe(0)
    expect(mockCreate).toHaveBeenCalled()
  })

  it('skips occurrences that already have a matching mission', async () => {
    mockFindMany.mockResolvedValue([makeTemplate()])
    mockFindFirst.mockResolvedValue({ id: 'existing-mission' })

    const result = await processRecurringMissions(FAKE_JOB)

    expect(result.skipped).toBeGreaterThan(0)
    expect(result.created).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('skips a template with an invalid recurrence rule without affecting others', async () => {
    mockFindMany.mockResolvedValue([
      makeTemplate({ id: 'tpl-bad', recurrence: { kind: 'weekly', weekDays: [99] } }),
      makeTemplate({ id: 'tpl-good' }),
    ])
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockResolvedValue({})

    const result = await processRecurringMissions(FAKE_JOB)

    // tpl-good still produces missions even though tpl-bad's rule construction failed
    expect(result.created).toBeGreaterThan(0)
  })

  // Regression M4: a single occurrence failing DB write (e.g. FK violation, transient DB error)
  // used to throw out of the whole job, failing generation for every tenant/template in the
  // batch — with no automatic retry configured, that meant up to 24h of silent, platform-wide
  // recurring-mission generation outage caused by one bad template.
  it('isolates a per-occurrence DB failure — other templates still get their missions created', async () => {
    mockFindMany.mockResolvedValue([
      makeTemplate({ id: 'tpl-fails', tenantId: 'tenant-fails' }),
      makeTemplate({ id: 'tpl-ok',    tenantId: 'tenant-ok' }),
    ])
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockImplementation((args: { data: { tenantId: string } }) => {
      if (args.data.tenantId === 'tenant-fails') {
        return Promise.reject(new Error('FK constraint violation'))
      }
      return Promise.resolve({})
    })

    const result = await processRecurringMissions(FAKE_JOB)

    expect(result.errors).toBeGreaterThan(0)
    expect(result.created).toBeGreaterThan(0)
  })

  it('does not throw when a template create fails for every occurrence', async () => {
    mockFindMany.mockResolvedValue([makeTemplate()])
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockRejectedValue(new Error('DB unavailable'))

    await expect(processRecurringMissions(FAKE_JOB)).resolves.toBeDefined()
  })
})
