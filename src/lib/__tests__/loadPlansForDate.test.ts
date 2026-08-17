import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMergePlansFromDB = vi.hoisted(() => vi.fn())
vi.mock('@/stores/planningStore', () => ({
  usePlanningStore: { getState: () => ({ mergePlansFromDB: mockMergePlansFromDB }) },
}))

import { loadPlansForDate } from '../loadPlansForDate'

describe('loadPlansForDate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  // Regression: ToursTab reads plans purely from the planning store, which DataProvider only
  // ever populates for *today*. Navigating to any other date via Jour precedent/suivant showed
  // "Aucune tournée planifiée" even when the tenant had real plans on that date, because nothing
  // ever fetched them. This asserts a date's plans get fetched and merged into the store.
  it('fetches plans for the given date and merges them into the store', async () => {
    const plans = [{ driverId: 'd1', date: '2026-08-16', missions: [] }]
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => plans,
    })

    await loadPlansForDate('2026-08-16')

    expect(global.fetch).toHaveBeenCalledWith('/api/plans?date=2026-08-16', { cache: 'no-store' })
    expect(mockMergePlansFromDB).toHaveBeenCalledWith(plans)
  })

  it('handles a {data: [...]} response shape', async () => {
    const plans = [{ driverId: 'd1', date: '2026-08-16', missions: [] }]
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => ({ data: plans }),
    })

    await loadPlansForDate('2026-08-16')

    expect(mockMergePlansFromDB).toHaveBeenCalledWith(plans)
  })

  it('does not call mergePlansFromDB for an empty result', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => [] })

    await loadPlansForDate('2026-08-16')

    expect(mockMergePlansFromDB).not.toHaveBeenCalled()
  })

  it('does not throw when the request fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'))

    await expect(loadPlansForDate('2026-08-16')).resolves.toBeUndefined()
    expect(mockMergePlansFromDB).not.toHaveBeenCalled()
  })

  it('does not throw on a non-ok response', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false })

    await expect(loadPlansForDate('2026-08-16')).resolves.toBeUndefined()
    expect(mockMergePlansFromDB).not.toHaveBeenCalled()
  })
})
