import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PARETO_WEIGHTS } from '@/components/admin/ParetoSelector'

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PARETO_WEIGHTS mapping', () => {
  it('Km minimal maximises distance weight', () => {
    const w = PARETO_WEIGHTS['Km minimal']
    expect(w).toBeDefined()
    expect(w.distance).toBeGreaterThan(w.punctuality)
    expect(w.distance).toBeGreaterThan(w.balance)
  })

  it('Zero retard maximises punctuality weight', () => {
    const w = PARETO_WEIGHTS['Zero retard']
    expect(w).toBeDefined()
    expect(w.punctuality).toBeGreaterThan(w.distance)
    expect(w.punctuality).toBeGreaterThan(w.balance)
  })

  it('Charge equilibree maximises balance weight', () => {
    const w = PARETO_WEIGHTS['Charge equilibree']
    expect(w).toBeDefined()
    expect(w.balance).toBeGreaterThan(w.distance)
    expect(w.balance).toBeGreaterThan(w.punctuality)
  })

  it('Compromis has equal weights', () => {
    const w = PARETO_WEIGHTS['Compromis']
    expect(w).toBeDefined()
    expect(w.distance).toBe(w.punctuality)
    expect(w.punctuality).toBe(w.balance)
  })

  it('all weights are positive numbers', () => {
    for (const label of Object.keys(PARETO_WEIGHTS)) {
      const w = PARETO_WEIGHTS[label]
      expect(w.distance).toBeGreaterThan(0)
      expect(w.punctuality).toBeGreaterThan(0)
      expect(w.balance).toBeGreaterThan(0)
    }
  })
})

describe('optimizationStore usePareto flag', () => {
  it('passes usePareto=true in fetch body when set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'completed',
        result: {
          assignments: {},
          unassignedMissions: [],
          stats: { assignedMissions: 0, totalMissions: 0, score: 0, timeTakenMs: 10, paretoFront: [] },
          warnings: [],
        },
      }),
    })

    const { useOptimizationStore } = await import('@/stores/optimizationStore')
    const store = useOptimizationStore.getState()
    store.reset()

    await new Promise<void>((resolve) => {
      store.startOptimization('2026-01-01', {}, { distance: 1, punctuality: 1, balance: 1 }, () => resolve(), true)
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.options.usePareto).toBe(true)
  })

  it('passes usePareto=false when not set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'completed',
        result: {
          assignments: {},
          unassignedMissions: [],
          stats: { assignedMissions: 0, totalMissions: 0, score: 0, timeTakenMs: 10 },
          warnings: [],
        },
      }),
    })

    const { useOptimizationStore } = await import('@/stores/optimizationStore')
    const store = useOptimizationStore.getState()
    store.reset()

    await new Promise<void>((resolve) => {
      store.startOptimization('2026-01-01', {}, { distance: 1, punctuality: 1, balance: 1 }, () => resolve())
    })

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.options.usePareto).toBeUndefined()
  })
})
