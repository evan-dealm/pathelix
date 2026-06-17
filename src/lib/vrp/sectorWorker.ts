import { parentPort, workerData } from 'worker_threads'
import type { Mission, Driver } from '@/lib/types'
import type { ALNSParams, CostContext, VRPSolution } from './types'
import { buildInitialSolution } from './formatSolution'
import { computeSolutionCost } from './routeCost'
import { runMvAlns } from './mvAlns'

export interface SectorWorkerInput {
  missions: Mission[]
  drivers: Driver[]
  ctx: CostContext
  params: ALNSParams
  existingPlans?: Record<string, string[]>
  sectorIndex: number
}

export interface SectorWorkerOutput {
  sectorIndex: number
  solution: VRPSolution
  error?: string
}

if (parentPort) {
  const input = workerData as SectorWorkerInput

  try {

    const { missions, drivers, ctx, params, existingPlans } = input

    const initial = buildInitialSolution(missions, drivers, ctx, existingPlans)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = missions.length > 0 && params.timeBudgetMs >= 200
      ? runMvAlns(initial, ctx, drivers, params)
      : initial

    const output: SectorWorkerOutput = {
      sectorIndex: input.sectorIndex,
      solution: optimized,
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
