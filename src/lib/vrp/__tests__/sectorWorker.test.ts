import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { SectorWorkerOutput } from '@/lib/vrp/sectorWorker'

// Shared mutable state read by the worker_threads mock getter at import time.
const workerState = vi.hoisted(() => ({
  enabled:      false,
  postMessage:  vi.fn(),
  sectorIndex:  0,
  missions:     [] as unknown[],
  timeBudgetMs: 1000,
}))

// Top-level mock — hoisted before any import so sectorWorker picks it up.
vi.mock('worker_threads', () => ({
  // getter fires once per sectorWorker import (after resetModules)
  get parentPort() {
    return workerState.enabled ? { postMessage: workerState.postMessage } : null
  },
  get workerData() {
    return {
      sectorIndex: workerState.sectorIndex,
      missions:    workerState.missions,
      drivers:     [],
      existingPlans: undefined,
      ctx: {
        depotLat: 48.85, depotLng: 2.35,
        startTimeMin: 480, speedKmh: 50,
        exutoires: [], date: '2026-06-15',
      },
      params: {
        timeBudgetMs: workerState.timeBudgetMs,
        seed: 42, iterations: 100,
        destroyRatio: 0.3, saT0Ratio: 0.1, saTMinRatio: 0.01, rhoForget: 0.1,
      },
    }
  },
}))

// Top-level VRP mocks — reconfigured per describe block via mockImplementation.
const mockBuildInitial = vi.hoisted(() => vi.fn())
const mockComputeCost  = vi.hoisted(() => vi.fn())
const mockRunAlns      = vi.hoisted(() => vi.fn())

vi.mock('@/lib/vrp/formatSolution', () => ({ buildInitialSolution: mockBuildInitial }))
vi.mock('@/lib/vrp/routeCost',      () => ({ computeSolutionCost:  mockComputeCost  }))
vi.mock('@/lib/vrp/mvAlns',         () => ({ runMvAlns:            mockRunAlns      }))

// ── Block 1: ALNS path (missions > 0, timeBudgetMs >= 200) ───────────────────

describe('sectorWorker — ALNS optimisation path', () => {
  beforeAll(async () => {
    mockBuildInitial.mockClear()
    mockComputeCost.mockClear()
    mockRunAlns.mockClear()

    workerState.enabled      = true
    workerState.postMessage  = vi.fn()
    workerState.sectorIndex  = 1
    workerState.missions     = [{ id: 'm1', type: 'POSER' }]
    workerState.timeBudgetMs = 1000

    mockBuildInitial.mockImplementation(() => ({ routes: [], cost: 0 }))
    mockComputeCost.mockImplementation(() => 42)
    mockRunAlns.mockImplementation(() => ({ routes: [{ driverId: 'd1', missions: [] }], cost: 99 }))

    vi.resetModules()
    await import('@/lib/vrp/sectorWorker')
  })

  afterAll(() => { vi.resetModules() })

  it('calls postMessage once', () => {
    expect(workerState.postMessage).toHaveBeenCalledOnce()
  })

  it('output has correct sectorIndex', () => {
    const out = workerState.postMessage.mock.calls[0][0] as SectorWorkerOutput
    expect(out.sectorIndex).toBe(1)
  })

  it('output contains ALNS-optimised solution', () => {
    const out = workerState.postMessage.mock.calls[0][0] as SectorWorkerOutput
    expect(out.solution.cost).toBe(99)
    expect(out.error).toBeUndefined()
  })

  it('runMvAlns was called', () => {
    expect(mockRunAlns).toHaveBeenCalledOnce()
  })
})

// ── Block 2: short-circuit path (empty missions → skip ALNS) ─────────────────

describe('sectorWorker — short-circuit (no missions)', () => {
  beforeAll(async () => {
    mockBuildInitial.mockClear()
    mockComputeCost.mockClear()
    mockRunAlns.mockClear()

    workerState.enabled      = true
    workerState.postMessage  = vi.fn()
    workerState.sectorIndex  = 2
    workerState.missions     = []
    workerState.timeBudgetMs = 1000

    mockBuildInitial.mockImplementation(() => ({ routes: [], cost: 0 }))
    mockComputeCost.mockImplementation(() => 17)
    mockRunAlns.mockImplementation(() => ({ routes: [], cost: 999 }))

    vi.resetModules()
    await import('@/lib/vrp/sectorWorker')
  })

  afterAll(() => { vi.resetModules() })

  it('calls postMessage once', () => {
    expect(workerState.postMessage).toHaveBeenCalledOnce()
  })

  it('returns initial solution without calling runMvAlns', () => {
    const out = workerState.postMessage.mock.calls[0][0] as SectorWorkerOutput
    expect(out.sectorIndex).toBe(2)
    expect(out.solution.cost).toBe(17)   // from computeSolutionCost, NOT runMvAlns
    expect(out.error).toBeUndefined()
    expect(mockRunAlns).not.toHaveBeenCalled()
  })
})

// ── Block 3: error path (buildInitialSolution throws) ────────────────────────

describe('sectorWorker — error path', () => {
  beforeAll(async () => {
    mockBuildInitial.mockClear()
    mockComputeCost.mockClear()
    mockRunAlns.mockClear()

    workerState.enabled      = true
    workerState.postMessage  = vi.fn()
    workerState.sectorIndex  = 3
    workerState.missions     = [{ id: 'm2' }]
    workerState.timeBudgetMs = 500

    mockBuildInitial.mockImplementation(() => { throw new Error('VRP init failure') })
    mockComputeCost.mockImplementation(() => 0)
    mockRunAlns.mockImplementation(() => ({ routes: [], cost: 0 }))

    vi.resetModules()
    await import('@/lib/vrp/sectorWorker')
  })

  afterAll(() => { vi.resetModules() })

  it('calls postMessage once with error output', () => {
    expect(workerState.postMessage).toHaveBeenCalledOnce()
    const out = workerState.postMessage.mock.calls[0][0] as SectorWorkerOutput
    expect(out.sectorIndex).toBe(3)
    expect(out.error).toBe('VRP init failure')
    expect(out.solution.routes).toEqual([])
    expect(out.solution.cost).toBe(Infinity)
  })
})

// ── Block 4: parentPort null → no execution ──────────────────────────────────

describe('sectorWorker — parentPort null (not a worker context)', () => {
  beforeAll(async () => {
    mockBuildInitial.mockClear()
    mockComputeCost.mockClear()
    mockRunAlns.mockClear()

    workerState.enabled     = false
    workerState.postMessage = vi.fn()
    workerState.sectorIndex = 4
    workerState.missions    = []

    mockBuildInitial.mockImplementation(() => { throw new Error('should not be called') })

    vi.resetModules()
    await import('@/lib/vrp/sectorWorker')
  })

  afterAll(() => { vi.resetModules() })

  it('postMessage never called when parentPort is null', () => {
    expect(workerState.postMessage).not.toHaveBeenCalled()
  })

  it('buildInitialSolution never called', () => {
    expect(mockBuildInitial).not.toHaveBeenCalled()
  })
})
