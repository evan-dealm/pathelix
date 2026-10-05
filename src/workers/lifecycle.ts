import type { createLogger } from '@/lib/logger'

type Logger = ReturnType<typeof createLogger>

const SHUTDOWN_TIMEOUT_MS = 25_000

/**
 * Process-level wiring shared by every BullMQ worker:
 * - SIGTERM/SIGINT close the given resources (finish the active job, release Redis/Postgres)
 *   within a bound, then exit — an orchestrator kills the container ~30 s after SIGTERM;
 * - an unhandled rejection is logged (never silent); an uncaught exception exits with code 1
 *   so the supervisor restarts a process whose state can no longer be trusted.
 */
export function installWorkerLifecycle(log: Logger, closers: Array<() => Promise<unknown>>): void {
  let stopping = false

  async function shutdown(signal: string): Promise<void> {
    if (stopping) return
    stopping = true
    log.info('Worker shutting down', { signal })
    const timer = setTimeout(() => {
      log.error('Shutdown timed out — forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    timer.unref()
    for (const close of closers) {
      try { await close() } catch (err) {
        log.warn('Error while closing a resource', { err: err instanceof Error ? err.message : String(err) })
      }
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('unhandledRejection', reason => {
    log.error('Unhandled promise rejection', { err: reason instanceof Error ? reason.message : String(reason) })
  })
  process.on('uncaughtException', err => {
    log.error('Uncaught exception — exiting', { err: err.message, stack: err.stack })
    process.exit(1)
  })
}
