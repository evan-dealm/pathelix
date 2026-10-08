import type { Worker } from 'node:worker_threads'
import { createLogger } from '@/lib/logger'
import type { SolverReply, SolverResult, SolverTask } from './solverThread'

const log = createLogger('vrp/solverPool')

/**
 * Runs route searches in solver threads instead of the calling thread.
 *
 * The search is synchronous: inside the web server it froze every other request of every
 * organisation for its whole budget (2 to 60 s on /api/optimize/live, /simulate, /resequence,
 * /api/weekly-plan and the Redis-less fallback of /api/optimize); inside the BullMQ worker it
 * stopped the job lock from being renewed and made VRP_CONCURRENCY > 1 pointless (two jobs shared
 * one core).
 *
 * - At most `size` searches run at once in this process, each on its own core; the others wait
 *   in a bounded queue and are refused (SolverBusyError → 503) rather than piling up.
 * - A thread that exceeds its deadline is terminated and replaced.
 * - If threads cannot start at all (missing bundle, restricted runtime), the search runs inline
 *   as before — the feature degrades to the old behaviour, never to an error.
 */

export class SolverBusyError extends Error {
  constructor() {
    super('Trop de calculs en cours. Réessayez dans quelques secondes.')
    this.name = 'SolverBusyError'
  }
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const v = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
}

interface Pending {
  id: number
  task: SolverTask
  resolve: (_value: unknown) => void
  reject: (_err: Error) => void
  timeoutMs: number
  queuedAt: number
  waitTimer?: ReturnType<typeof setTimeout>
}

interface Slot {
  worker: Worker
  current: Pending | null
  timer: ReturnType<typeof setTimeout> | null
  /** This thread has answered at least one task. */
  proven: boolean
}

const state = {
  size: -1,
  slots: [] as Slot[],
  queue: [] as Pending[],
  nextId: 1,
  /** Threads never managed to run a task here: everything runs inline from now on. */
  broken: false,
  entry: undefined as { path: string; ts: boolean } | null | undefined,
  everSucceeded: false,
}

function poolSize(): number {
  if (state.size >= 0) return state.size
  // Tests run the solver inline unless they ask for threads explicitly.
  const fallback = process.env.NODE_ENV === 'test' ? 0 : 1
  return envInt('VRP_SOLVER_THREADS', fallback, 0, 16)
}

/** Sets the number of solver threads of this process (the VRP worker uses its job concurrency). */
export function configureSolverPool(options: { size: number }): void {
  state.size = Math.max(0, Math.min(16, Math.floor(options.size)))
}

async function resolveEntry(): Promise<{ path: string; ts: boolean } | null> {
  if (state.entry !== undefined) return state.entry
  const { existsSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const bundle = resolve(process.cwd(), 'dist/workers/vrpSolver.mjs')
  const source = resolve(process.cwd(), 'src/lib/vrp/solverThread.ts')
  // In development the source is the truth (a bundle left by an earlier build may be stale).
  const order = process.env.NODE_ENV === 'production' ? [bundle, source] : [source, bundle]
  const candidates = process.env.VRP_SOLVER_PATH ? [resolve(process.env.VRP_SOLVER_PATH)] : order
  const found = candidates.find(p => existsSync(p))
  state.entry = found ? { path: found, ts: found.endsWith('.ts') } : null
  return state.entry
}

async function spawn(): Promise<Slot | null> {
  const entry = await resolveEntry()
  if (!entry) return null
  const { Worker } = await import('node:worker_threads')
  const worker = new Worker(entry.path, {
    env: {
      ...process.env,
      VRP_SOLVER_THREAD: '1',
      // The thread only reads a few tenant rows (routing licence, familiarity, calibration).
      DB_POOL_SIZE: process.env.VRP_SOLVER_DB_POOL ?? '2',
    },
    resourceLimits: { maxOldGenerationSizeMb: envInt('VRP_SOLVER_MAX_HEAP_MB', 1536, 128, 16_384) },
    ...(entry.ts ? { execArgv: ['--import', 'tsx'] } : {}),
  })
  const slot: Slot = { worker, current: null, timer: null, proven: false }

  worker.on('message', (msg: SolverReply | { ready: true }) => {
    if ('ready' in msg) return
    const job = slot.current
    if (!job || job.id !== msg.id) return
    release(slot)
    slot.proven = true
    state.everSucceeded = true
    if (msg.ok) job.resolve(msg.result)
    else job.reject(new Error(msg.error))
    pump()
  })
  const lost = (reason: string) => {
    const i = state.slots.indexOf(slot)
    if (i >= 0) state.slots.splice(i, 1)
    const job = slot.current
    release(slot)
    if (job) failJob(job, reason)
    pump()
  }
  worker.on('error', err => lost(err instanceof Error ? err.message : String(err)))
  worker.on('exit', code => {
    if (state.slots.includes(slot)) lost(`solver thread exited (${code})`)
  })
  // A solver thread never keeps the process alive on its own.
  worker.unref()
  return slot
}

function release(slot: Slot): void {
  if (slot.timer) clearTimeout(slot.timer)
  slot.timer = null
  slot.current = null
}

/**
 * A thread died under a job. If no thread ever completed a task in this process, threads do not
 * work here (bundle missing its dependencies, runtime without worker_threads…): run inline.
 */
function failJob(job: Pending, reason: string): void {
  if (!state.everSucceeded) {
    if (!state.broken)
      log.warn('Solver threads unavailable — searches run in the calling thread', { reason })
    state.broken = true
    runInline(job.task).then(job.resolve, job.reject)
    for (const waiting of state.queue.splice(0)) {
      if (waiting.waitTimer) clearTimeout(waiting.waitTimer)
      runInline(waiting.task).then(waiting.resolve, waiting.reject)
    }
    return
  }
  job.reject(new Error(`Le calcul a été interrompu (${reason}).`))
}

async function runInline(task: SolverTask): Promise<unknown> {
  const { executeSolverTask } = await import('./solverThread')
  return executeSolverTask(task)
}

function start(slot: Slot, job: Pending): void {
  if (job.waitTimer) clearTimeout(job.waitTimer)
  slot.current = job
  slot.timer = setTimeout(() => {
    // Runaway search: free the core. The thread is replaced on the next task.
    const i = state.slots.indexOf(slot)
    if (i >= 0) state.slots.splice(i, 1)
    release(slot)
    void slot.worker.terminate()
    job.reject(new Error('Le calcul a dépassé le temps maximum autorisé et a été arrêté.'))
    pump()
  }, job.timeoutMs)
  try {
    slot.worker.postMessage({ id: job.id, task: job.task })
  } catch (err) {
    // Something in the task cannot be cloned: not a reason to fail the request.
    release(slot)
    log.warn('Solver task not transferable — running inline', {
      err: err instanceof Error ? err.message : String(err),
    })
    runInline(job.task).then(job.resolve, job.reject)
    pump()
  }
}

let _spawning = 0

function pump(): void {
  if (state.broken) return
  while (state.queue.length > 0) {
    const free = state.slots.find(s => !s.current)
    if (free) {
      start(free, state.queue.shift()!)
      continue
    }
    if (state.slots.length + _spawning >= poolSize()) return
    _spawning++
    spawn().then(
      slot => {
        _spawning--
        if (!slot) {
          state.broken = true
          log.warn('Solver thread entry not found — searches run in the calling thread')
          for (const job of state.queue.splice(0)) {
            if (job.waitTimer) clearTimeout(job.waitTimer)
            runInline(job.task).then(job.resolve, job.reject)
          }
          return
        }
        state.slots.push(slot)
        pump()
      },
      err => {
        _spawning--
        const job = state.queue.shift()
        if (job) failJob(job, err instanceof Error ? err.message : String(err))
      },
    )
    return
  }
}

/** Longest a search may hold a thread: its budget, the matrix, the final steps, and a margin. */
function defaultTimeoutMs(task: SolverTask): number {
  const budget =
    task.op === 'vrp' ? (task.options?.timeBudgetMs ?? 30_000) : task.params.timeBudgetMs
  return (
    Math.round(budget * 2.5) + envInt('VALHALLA_MATRIX_BUDGET_MS', 20_000, 500, 600_000) + 30_000
  )
}

/**
 * Runs a solver task off the calling thread and resolves with its result.
 * Throws SolverBusyError when the queue is full or the task waited too long for a free thread.
 */
export function solveOffThread<T extends SolverTask>(
  task: T,
  options?: { timeoutMs?: number; maxWaitMs?: number },
): Promise<SolverResult<T>> {
  if (poolSize() === 0 || state.broken) return runInline(task) as Promise<SolverResult<T>>

  const maxQueue = envInt('VRP_SOLVER_QUEUE_MAX', 8, 0, 1000)
  if (state.queue.length >= maxQueue) return Promise.reject(new SolverBusyError())

  return new Promise<SolverResult<T>>((resolve, reject) => {
    const job: Pending = {
      id: state.nextId++,
      task,
      resolve: resolve as (_v: unknown) => void,
      reject,
      timeoutMs: options?.timeoutMs ?? defaultTimeoutMs(task),
      queuedAt: Date.now(),
    }
    job.waitTimer = setTimeout(
      () => {
        const i = state.queue.indexOf(job)
        if (i < 0) return
        state.queue.splice(i, 1)
        reject(new SolverBusyError())
      },
      options?.maxWaitMs ?? envInt('VRP_SOLVER_MAX_WAIT_MS', 45_000, 100, 600_000),
    )
    state.queue.push(job)
    pump()
  })
}

/** Same contract as runVRP, off the calling thread. */
export function runVRPOffThread(
  ...[missions, drivers, exutoires, date, options]: Parameters<typeof import('./index').runVRP>
): Promise<import('@/lib/types').OptimizationResult> {
  return solveOffThread({ op: 'vrp', missions, drivers, exutoires, date, options })
}

export function solverPoolStatus(): {
  threads: number
  busy: number
  queued: number
  inline: boolean
} {
  return {
    threads: state.slots.length,
    busy: state.slots.filter(s => s.current).length,
    queued: state.queue.length,
    inline: state.broken || poolSize() === 0,
  }
}

/** Stops every solver thread (graceful shutdown, tests). Running searches are rejected. */
export async function closeSolverPool(): Promise<void> {
  const slots = state.slots.splice(0)
  for (const job of state.queue.splice(0)) {
    if (job.waitTimer) clearTimeout(job.waitTimer)
    job.reject(new Error('Arrêt du serveur de calcul'))
  }
  await Promise.all(
    slots.map(async slot => {
      const job = slot.current
      release(slot)
      if (job) job.reject(new Error('Arrêt du serveur de calcul'))
      await slot.worker.terminate().catch(() => {})
    }),
  )
  state.broken = false
  state.everSucceeded = false
  state.entry = undefined
  state.size = -1
}
