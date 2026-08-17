import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetState = vi.hoisted(() => vi.fn())
vi.mock('@/stores/planningStore', () => ({
  usePlanningStore: { getState: () => mockGetState() },
}))

const mockLoadAllMissions = vi.hoisted(() => vi.fn())
vi.mock('@/lib/loadAllMissions', () => ({
  loadAllMissionsIntoStore: (...args: unknown[]) => mockLoadAllMissions(...args),
}))

const mockLoadPlansForDate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/loadPlansForDate', () => ({
  loadPlansForDate: (...args: unknown[]) => mockLoadPlansForDate(...args),
}))

import { buildBackupExport } from '../exportBackup'

const STATE = {
  drivers: [{ id: 'd1' }],
  missions: [{ id: 'm1', date: '2026-07-27' }, { id: 'm2', date: '2026-08-16' }, { id: 'm3', date: '2026-08-16' }],
  plans: { 'd1|2026-08-16': [] },
  startTimes: {},
  speeds: {},
  unavailable: {},
  lockedPlans: {},
}

describe('buildBackupExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetState.mockReturnValue(STATE)
    mockLoadAllMissions.mockResolvedValue(undefined)
    mockLoadPlansForDate.mockResolvedValue(undefined)
  })

  // Regression: found via manual QA — the "Exporter JSON" backup button read directly from
  // the planning store, which DataProvider only ever populates for *today*. A user exporting
  // a "backup" would silently get a file missing most historical/future missions and plans,
  // with no indication it was incomplete. This asserts the full mission history is loaded,
  // and plans are fetched for every distinct date that has a mission, before the export is
  // built.
  it('loads the full mission history before building the export', async () => {
    await buildBackupExport()
    expect(mockLoadAllMissions).toHaveBeenCalledTimes(1)
  })

  it('fetches plans for every distinct mission date, not just today', async () => {
    await buildBackupExport()
    expect(mockLoadPlansForDate).toHaveBeenCalledWith('2026-07-27')
    expect(mockLoadPlansForDate).toHaveBeenCalledWith('2026-08-16')
    expect(mockLoadPlansForDate).toHaveBeenCalledTimes(2) // deduped, not once per mission
  })

  it('reads fresh state after loading, not a stale snapshot', async () => {
    const result = await buildBackupExport()
    expect(result.drivers).toEqual(STATE.drivers)
    expect(result.missions).toEqual(STATE.missions)
    expect(result.plans).toEqual(STATE.plans)
  })

  it('stamps a version and exportedAt timestamp', async () => {
    const result = await buildBackupExport()
    expect(result.version).toBe('1.0')
    expect(new Date(result.exportedAt).toString()).not.toBe('Invalid Date')
  })
})
