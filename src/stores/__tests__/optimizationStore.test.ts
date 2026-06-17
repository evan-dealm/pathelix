/**
 * Tests for optimizationStore — cancel, reset, error paths, and polling.
 * No fake timers: the poll interval is 500ms so polling tests complete in <2s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useOptimizationStore } from '@/stores/optimizationStore'

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

function state() { return useOptimizationStore.getState() }

/** Subscribe to store and resolve when predicate is satisfied. */
function waitForState(pred: (s: ReturnType<typeof state>) => boolean, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error(`waitForState timeout after ${timeoutMs}ms`)) }, timeoutMs)
    const unsub = useOptimizationStore.subscribe(s => {
      if (pred(s)) { clearTimeout(timer); unsub(); resolve() }
    })
  })
}

const WEIGHTS = { distance: 1, punctuality: 1, balance: 1 }
const baseResult = {
  assignments: {},
  unassignedMissions: [],
  stats: { assignedMissions: 3, totalMissions: 5, score: 85, timeTakenMs: 500 },
  warnings: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  state().reset()
})
afterEach(() => {
  state().reset()
})

describe('reset', () => {
  it('clears all state', () => {
    state().cancel()
    state().reset()
    expect(state().isOptimizing).toBe(false)
    expect(state().progress).toBe(0)
    expect(state().error).toBeNull()
    expect(state().stats).toBeNull()
    expect(state().date).toBeNull()
  })
})

describe('cancel', () => {
  it('sets error containing "annul" and isOptimizing=false', () => {
    state().cancel()
    expect(state().isOptimizing).toBe(false)
    expect(state().error).toMatch(/annul/i)
  })
})

describe('startOptimization — immediate completion', () => {
  it('calls onComplete and sets stats when server returns completed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'completed', result: baseResult }),
    })

    const onComplete = vi.fn()
    const done = waitForState(s => !s.isOptimizing && s.progress === 100)
    state().startOptimization('2026-06-15', {}, WEIGHTS, result => { onComplete(result) })
    await done

    expect(onComplete).toHaveBeenCalledWith(baseResult)
    expect(state().stats?.assigned).toBe(3)
    expect(state().stats?.total).toBe(5)
    expect(state().stats?.score).toBe(85)
  })

  it('sets date on the store', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'completed', result: baseResult }),
    })
    const done = waitForState(s => !s.isOptimizing)
    state().startOptimization('2026-06-15', {}, WEIGHTS, vi.fn())
    await done
    expect(state().date).toBe('2026-06-15')
  })
})

describe('startOptimization — error paths', () => {
  it('sets error when fetch throws (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'))

    const done = waitForState(s => !s.isOptimizing && !!s.error)
    state().startOptimization('2026-06-15', {}, WEIGHTS, vi.fn())
    await done

    expect(state().error).toMatch(/ECONNRESET/i)
  })

  it('sets error from server when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Quota dépassé' }),
    })

    const done = waitForState(s => !s.isOptimizing && !!s.error)
    state().startOptimization('2026-06-15', {}, WEIGHTS, vi.fn())
    await done

    expect(state().error).toContain('Quota dépassé')
  })

  it('sets "Job ID manquant" when status is not completed and no jobId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'queued' }),
    })

    const done = waitForState(s => !s.isOptimizing && !!s.error)
    state().startOptimization('2026-06-15', {}, WEIGHTS, vi.fn())
    await done

    expect(state().error).toMatch(/Job ID manquant/i)
  })
})

describe('startOptimization — polling', () => {
  it('completes via poll and calls onComplete', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'pending', jobId: 'job-poll-1' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'completed', result: baseResult }),
      })

    const onComplete = vi.fn()
    const done = waitForState(s => !s.isOptimizing && s.progress === 100, 5000)
    state().startOptimization('2026-06-15', {}, WEIGHTS, onComplete)
    await done

    expect(onComplete).toHaveBeenCalled()
    expect(state().stats?.assigned).toBe(3)
  }, 10000)

  it('sets error when poll returns failed', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'pending', jobId: 'job-fail' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'failed', error: 'memory limit' }),
      })

    const done = waitForState(s => !s.isOptimizing && !!s.error, 5000)
    state().startOptimization('2026-06-15', {}, WEIGHTS, vi.fn())
    await done

    expect(state().error).toContain('memory limit')
  }, 10000)

  it('sets error when poll returns unknown status', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'pending', jobId: 'job-unknown' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'unknown' }),
      })

    const done = waitForState(s => !s.isOptimizing && !!s.error, 5000)
    state().startOptimization('2026-06-15', {}, WEIGHTS, vi.fn())
    await done

    expect(state().error).toMatch(/introuvable|expiré/i)
  }, 10000)
})
