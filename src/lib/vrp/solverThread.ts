import { parentPort } from 'node:worker_threads'
import type { Driver, Exutoire, Mission, OptimizationResult } from '@/lib/types'
import type { ALNSParams, CostContext, VRPSolution } from './types'

/**
 * Entry point of a solver thread (see solverPool.ts): the search is synchronous JavaScript and
 * holds its thread for the whole time budget. Run here, it holds this thread instead of the event
 * loop of the web server or of the BullMQ worker.
 *
 * Everything that crosses the thread boundary is plain data (structured clone): no matrix
 * closure, no database handle. The thread builds its own.
 */

/** Options of runVRP, as plain data. */
export type RunVrpOptions = NonNullable<Parameters<typeof import('./index').runVRP>[4]>

export type SolverTask =
  | {
      op: 'vrp'
      missions: Mission[]
      drivers: Driver[]
      exutoires: Exutoire[]
      date: string
      options?: RunVrpOptions
    }
  /** One driver's route re-sequenced from scratch (no matrix in ctx: it could not be cloned). */
  | { op: 'route'; missions: Mission[]; driver: Driver; ctx: CostContext; params: ALNSParams }

export type SolverResult<T extends SolverTask> = T extends { op: 'vrp' }
  ? OptimizationResult
  : VRPSolution

export async function executeSolverTask<T extends SolverTask>(task: T): Promise<SolverResult<T>> {
  if (task.op === 'vrp') {
    const { runVRP } = await import('./index')
    return (await runVRP(
      task.missions,
      task.drivers,
      task.exutoires,
      task.date,
      task.options,
    )) as SolverResult<T>
  }
  const { buildInitialSolution } = await import('./formatSolution')
  const { computeSolutionCost } = await import('./routeCost')
  const { runMvAlns } = await import('./mvAlns')
  const initial = buildInitialSolution(task.missions, [task.driver], task.ctx)
  initial.cost = computeSolutionCost(initial.routes, task.ctx, [task.driver])
  const solved =
    task.missions.length > 1 ? runMvAlns(initial, task.ctx, [task.driver], task.params) : initial
  return solved as SolverResult<T>
}

export interface SolverRequest {
  id: number
  task: SolverTask
}
export type SolverReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

if (parentPort && process.env.VRP_SOLVER_THREAD === '1') {
  const port = parentPort
  port.on('message', (msg: SolverRequest) => {
    executeSolverTask(msg.task).then(
      result => port.postMessage({ id: msg.id, ok: true, result } satisfies SolverReply),
      err =>
        port.postMessage({
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies SolverReply),
    )
  })
  port.postMessage({ ready: true })
}
