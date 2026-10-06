import type { SectorWorkerInput } from './sectorWorker'
import { serializeSubMatrix } from './osrmMatrix'
import type { VRPSolution } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('vrp/threadPool')

const USE_THREADS = process.env.VRP_USE_THREADS !== 'false'
  && typeof process.env.VRP_USE_THREADS !== 'undefined'
  ? process.env.VRP_USE_THREADS === 'true'
  : false

/**
 * Solves every sector and returns one solution per task, in task order. A sector never comes
 * back empty-handed: a failed thread is re-run in-process, a failed search falls back to the
 * sector's initial construction, and as a last resort its drivers get empty routes (their
 * missions are then reported unassigned by runVRP's conservation check, not lost).
 */
export async function runSectorsInParallel(
  tasks: SectorWorkerInput[],
): Promise<VRPSolution[]> {
  if (tasks.length === 0) return []

  let results: Array<VRPSolution | null> = tasks.map(() => null)
  if (USE_THREADS && tasks.length > 1) {
    try {
      results = await runSectorsWithThreads(tasks)
    } catch (err) {
      log.warn('worker_threads failed, falling back to sequential', { err: err instanceof Error ? err.message : String(err) })
    }
  }

  const { resetExutoireCongestion } = await import('./exutoireSearch')
  const out: VRPSolution[] = []
  for (let i = 0; i < tasks.length; i++) {
    const done = results[i]
    if (done) { out.push(done); continue }
    resetExutoireCongestion()
    out.push(await solveSectorSafely(tasks[i]))
    if (tasks.length > 10 && (i + 1) % 10 === 0) {
      log.info('VRP sectors progress', { completed: i + 1, total: tasks.length })
    }
  }
  return out
}

async function solveSectorSafely(task: SectorWorkerInput): Promise<VRPSolution> {
  const { solveSector } = await import('./sectorWorker')
  try {
    return solveSector(task)
  } catch (err) {
    log.error('VRP sector search failed — keeping its initial construction', { sector: task.sectorIndex, err: err instanceof Error ? err.message : String(err) })
  }
  try {
    const { buildInitialSolution } = await import('./formatSolution')
    const { computeSolutionCost } = await import('./routeCost')
    const initial = buildInitialSolution(task.missions, task.drivers, task.ctx, task.existingPlans)
    initial.cost = computeSolutionCost(initial.routes, task.ctx, task.drivers)
    return initial
  } catch (err) {
    log.error('VRP sector construction failed — its missions stay unassigned', { sector: task.sectorIndex, err: err instanceof Error ? err.message : String(err) })
    return { routes: task.drivers.map(d => ({ driverId: d.id, missions: [] })), cost: 0 }
  }
}

/** Replaces the (non-cloneable) matrix closure with a plain sub-matrix restricted to the sector. */
function toCloneable(task: SectorWorkerInput): SectorWorkerInput {
  const matrix = task.ctx.osrmMatrix
  if (!matrix) return task
  const ids = [
    ...task.missions.map(m => m.id),
    ...task.drivers.map(d => `depot:${d.id}`),
    ...task.ctx.exutoires.map(e => `exu:${e.id}`),
  ]
  const { osrmMatrix: _omit, ...ctx } = task.ctx
  return { ...task, ctx, serializedMatrix: serializeSubMatrix(matrix, ids) }
}

async function runSectorsWithThreads(
  tasks: SectorWorkerInput[],
): Promise<Array<VRPSolution | null>> {

  const { Worker } = await import('worker_threads')
  const { availableParallelism } = await import('os')
  const { resolve } = await import('path')
  const { existsSync } = await import('fs')

  const maxConcurrency = Math.max(1, Math.min(
    parseInt(process.env.VRP_THREAD_CONCURRENCY || '0', 10) || availableParallelism() - 1,
    16,
  ))
  const threadTimeoutMs = parseInt(process.env.VRP_THREAD_TIMEOUT_MS || '120000', 10)

  const jsPath = resolve(__dirname, 'sectorWorker.js')
  const tsPath = resolve(__dirname, 'sectorWorker.ts')
  const workerPath = existsSync(jsPath) ? jsPath : tsPath

  if (!existsSync(workerPath)) {
    throw new Error(`Worker file not found: ${jsPath} nor ${tsPath}`)
  }

  // null = this sector failed in its thread; the caller re-runs it in-process.
  const results: Array<VRPSolution | null> = tasks.map(() => null)

  return new Promise((resolveAll, _rejectAll) => {
    let completedCount = 0
    let activeCount = 0
    let taskIdx = 0
    const errors: string[] = []

    function onComplete() {
      completedCount++
      if (completedCount === tasks.length) {
        if (errors.length > 0) {
          log.warn('VRP sectors failed', { count: errors.length, sample: errors.slice(0, 3) })
        }
        resolveAll(results)
      }
      processNext()
    }

    function processNext() {
      while (activeCount < maxConcurrency && taskIdx < tasks.length) {
        const task = tasks[taskIdx]
        const idx = taskIdx
        taskIdx++
        activeCount++

        let settled = false
        let worker: InstanceType<typeof Worker>

        try {
          worker = new Worker(workerPath, {
            workerData: toCloneable(task),
            resourceLimits: { maxOldGenerationSizeMb: 512 },
            ...(workerPath.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : {}),
          })
        } catch (err) {

          errors.push(`Sector ${idx}: construct failed: ${err}`)
          activeCount--
          onComplete()
          continue
        }

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          worker.terminate()
          errors.push(`Sector ${idx}: timeout`)
          activeCount--
          onComplete()
        }, threadTimeoutMs)

        worker.on('message', (output: { sectorIndex: number; solution: VRPSolution; error?: string }) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (output.error) errors.push(`Sector ${idx}: ${output.error}`)
          if (!output.error && output.solution?.routes) results[idx] = output.solution
          activeCount--
          worker.terminate().catch(() => {})
          onComplete()
        })

        worker.on('error', (err: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          errors.push(`Sector ${idx}: ${err.message}`)
          activeCount--
          worker.terminate().catch(() => {})
          onComplete()
        })

        worker.on('exit', (code: number) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (code !== 0) errors.push(`Sector ${idx}: exit ${code}`)
          activeCount--
          onComplete()
        })
      }
    }

    processNext()
  })
}

export function getThreadPoolSize(): number {
  return USE_THREADS ? parseInt(process.env.VRP_THREAD_CONCURRENCY || '4', 10) : 1
}
