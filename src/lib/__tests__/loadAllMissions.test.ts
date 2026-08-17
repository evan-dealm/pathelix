import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAddMissionsBulk = vi.hoisted(() => vi.fn())
vi.mock('@/stores/planningStore', () => ({
  usePlanningStore: { getState: () => ({ addMissionsBulk: mockAddMissionsBulk }) },
}))

import { loadAllMissionsIntoStore } from '../loadAllMissions'

function page(data: unknown[], page: number, totalPages: number) {
  return { ok: true, json: async () => ({ data, page, totalPages }) } as Response
}

describe('loadAllMissionsIntoStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  // Regression: MissionsTab shares the planning store's `missions` array with the operational
  // dashboard, which DataProvider only ever populates for *today*. Opening the Missions tab on
  // a date with 0 missions showed "Aucune mission" even though the tenant had 140 missions on
  // other dates — the date-range filter inputs in the tab were operating on data that could
  // never contain anything but today. This asserts the full history actually gets paginated in.
  it('fetches every page and merges each into the store', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([{ id: 'm1' }], 1, 2))
      .mockResolvedValueOnce(page([{ id: 'm2' }], 2, 2))

    await loadAllMissionsIntoStore({ cancelled: false })

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/missions?page=1&limit=100', { cache: 'no-store' })
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/missions?page=2&limit=100', { cache: 'no-store' })
    expect(mockAddMissionsBulk).toHaveBeenCalledWith([{ id: 'm1' }])
    expect(mockAddMissionsBulk).toHaveBeenCalledWith([{ id: 'm2' }])
  })

  it('stops after the last page instead of looping to MAX_PAGES', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(page([{ id: 'm1' }], 1, 1))

    await loadAllMissionsIntoStore({ cancelled: false })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('stops fetching once the caller cancels', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([{ id: 'm1' }], 1, 5))
      .mockResolvedValueOnce(page([{ id: 'm2' }], 2, 5))

    const controller = { cancelled: false }
    const promise = loadAllMissionsIntoStore(controller)
    controller.cancelled = true
    await promise

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not throw when a page request fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'))

    await expect(loadAllMissionsIntoStore({ cancelled: false })).resolves.toBeUndefined()
    expect(mockAddMissionsBulk).not.toHaveBeenCalled()
  })

  it('does not call addMissionsBulk for an empty page', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(page([], 1, 1))

    await loadAllMissionsIntoStore({ cancelled: false })

    expect(mockAddMissionsBulk).not.toHaveBeenCalled()
  })
})
