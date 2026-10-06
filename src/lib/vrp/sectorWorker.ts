import { parentPort, workerData } from 'worker_threads'
import type { Mission, Driver } from '@/lib/types'
import type { ALNSParams, CostContext, VRPSolution } from './types'
import { buildInitialSolution } from './formatSolution'
import { computeSolutionCost } from './routeCost'
import { runMvAlns } from './mvAlns'
import { deserializeMatrix, type SerializedMatrix } from './osrmMatrix'

export interface SectorWorkerInput {
  missions: Mission[]
  drivers: Driver[]
  ctx: CostContext
  params: ALNSParams
  existingPlans?: Record<string, string[]>
  sectorIndex: number
  /** Set (and ctx.osrmMatrix removed) when the task crosses a thread boundary — functions don't clone. */
  serializedMatrix?: SerializedMatrix
}

export interface SectorWorkerOutput {
  sectorIndex: number
  solution: VRPSolution
  error?: string
}

/** Initial construction + MV-ALNS for one sector. Shared by the in-process and worker_threads paths. */
export function solveSector(input: SectorWorkerInput): VRPSolution {
  const { missions, drivers, params, existingPlans } = input
  const ctx: CostContext = input.serializedMatrix
    ? { ...input.ctx, osrmMatrix: deserializeMatrix(input.serializedMatrix) }
    : input.ctx

  const initial = buildInitialSolution(missions, drivers, ctx, existingPlans)
  initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

  return missions.length > 0 && params.timeBudgetMs >= 200
    ? runMvAlns(initial, ctx, drivers, params)
    : initial
}

if (parentPort) {
  const input = workerData as SectorWorkerInput

  try {
    const output: SectorWorkerOutput = {
      sectorIndex: input.sectorIndex,
      solution: solveSector(input),
    }
    parentPort.postMessage(output)
  } catch (err) {
    const output: SectorWorkerOutput = {
      sectorIndex: input.sectorIndex,
      solution: { routes: [], cost: Infinity },
      error: err instanceof Error ? err.message : String(err),
    }
    parentPort.postMessage(output)
  }
}
