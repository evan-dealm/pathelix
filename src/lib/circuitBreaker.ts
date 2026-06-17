import { createLogger } from '@/lib/logger'

const log = createLogger('CircuitBreaker')

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {

  failureThreshold?:  number

  recoveryTimeMs?:    number

  halfOpenSuccesses?: number
}

export class CircuitOpenError extends Error {
  constructor(public readonly circuitName: string) {
    super(`Circuit "${circuitName}" est OPEN — service temporairement indisponible`)
    this.name = 'CircuitOpenError'
  }
}

export class CircuitBreaker {
  private state:            CircuitState = 'CLOSED'
  private failures:         number       = 0
  private halfOpenWins:     number       = 0
  private lastFailureTime:  number       = 0

  private readonly failureThreshold:  number
  private readonly recoveryTimeMs:    number
  private readonly halfOpenSuccesses: number

  constructor(
    private readonly name: string, // eslint-disable-line no-unused-vars
    opts: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold  = opts.failureThreshold  ?? 5
    this.recoveryTimeMs    = opts.recoveryTimeMs    ?? 30_000
    this.halfOpenSuccesses = opts.halfOpenSuccesses ?? 2
  }

  getState(): CircuitState { return this.state }
  getName():  string       { return this.name  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.tryRecover()

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name)
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure(err)
      throw err
    }
  }

  private tryRecover(): void {
    if (
      this.state === 'OPEN' &&
      Date.now() - this.lastFailureTime >= this.recoveryTimeMs
    ) {
      this.state        = 'HALF_OPEN'
      this.halfOpenWins = 0
      log.info(`${this.name} OPEN → HALF_OPEN (tentative de récupération)`)
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenWins++
      if (this.halfOpenWins >= this.halfOpenSuccesses) {
        this.state    = 'CLOSED'
        this.failures = 0
        log.info(`${this.name} HALF_OPEN → CLOSED (récupéré)`)
      }
    } else {

      this.failures = 0
    }
  }

  private onFailure(err: unknown): void {
    this.failures++
    this.lastFailureTime = Date.now()

    const errMsg = err instanceof Error ? err.message : String(err)

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN'
      log.warn(`${this.name} HALF_OPEN → OPEN (échec pendant sonde)`, { err: errMsg })
    } else if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN'
      log.warn(`${this.name} CLOSED → OPEN (${this.failures} échecs)`, { err: errMsg })
    }
  }
}

const _registry = new Map<string, CircuitBreaker>()

export function getCircuitBreaker(
  name: string,
  opts?: CircuitBreakerOptions,
): CircuitBreaker {
  if (!_registry.has(name)) {
    _registry.set(name, new CircuitBreaker(name, opts))
  }
  return _registry.get(name)!
}

export function getAllCircuitStates(): Record<string, CircuitState> {
  const result: Record<string, CircuitState> = {}
  for (const [name, breaker] of _registry.entries()) {
    result[name] = breaker.getState()
  }
  return result
}
