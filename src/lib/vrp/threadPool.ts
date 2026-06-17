import type { SectorWorkerInput } from './sectorWorker'
import type { VRPSolution } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('vrp/threadPool')

const USE_THREADS = process.env.VRP_USE_THREADS !== 'false'
  && typeof process.env.VRP_USE_THREADS !== 'undefined'
  ? process.env.VRP_USE_THREADS === 'true'
  : false

export async function runSectorsInParallel(
  tasks: SectorWorkerInput[],
): Promise<VRPSolution[]> {
  if (tasks.length === 0) return []

  if (USE_THREADS && tasks.length > 1) {
    try {
      return await runSectorsWithThreads(tasks)
    } catch (err) {
      log.warn('worker_threads failed, falling back to sequential', { err: err instanceof Error ? err.message : String(err) })
    }
  }

  return runSectorsSequential(tasks)
}

async function runSectorsSequential(
  tasks: SectorWorkerInput[],
): Promise<VRPSolution[]> {
  const { buildInitialSolution } = await import('./formatSolution')
  const { computeSolutionCost } = await import('./routeCost')
  const { runMvAlns } = await import('./mvAlns')
  const { resetExutoireCongestion } = await import('./exutoireSearch')

  const results: VRPSolution[] = []

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    resetExutoireCongestion()
    const { missions, drivers, ctx, params, existingPlans } = task

    const initial = buildInitialSolution(missions, drivers, ctx, existingPlans)
    initial.cost = computeSolutionCost(initial.routes, ctx, drivers)

    const optimized = missions.length > 0 && params.timeBudgetMs >= 200
      ? runMvAlns(initial, ctx, drivers, params)
      : initial

    results.push(optimized)

    if (tasks.length > 10 && (i + 1) % 10 === 0) {
      log.info('VRP sectors progress', { completed: i + 1, total: tasks.length })
    }
  }

  return results
}

async function runSectorsWithThreads(
  tasks: SectorWorkerInput[],
): Promise<VRPSolution[]> {

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

  const EMPTY_SOL: VRPSolution = { routes: [], cost: Infinity }
  const results: VRPSolution[] = tasks.map(() => EMPTY_SOL)

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
            workerData: task,
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
          if (output.solution?.routes) results[idx] = output.solution
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
