import { createLogger } from '@/lib/logger'
import { getCircuitBreaker, type CircuitBreakerOptions } from '@/lib/circuitBreaker'

const log = createLogger('httpClient')

export interface RetryOptions {

  maxRetries?:  number

  baseDelayMs?: number

  maxDelayMs?:  number

  timeoutMs?:   number

  retryCodes?:  number[]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withJitter(ms: number): number {
  return ms * (0.5 + Math.random() * 0.5)
}

function backoffMs(attempt: number, base: number, max: number): number {
  return Math.min(base * 2 ** attempt, max)
}

export async function fetchWithRetry(
  url:      string,
  options?: RequestInit,
  opts:     RetryOptions = {},
): Promise<Response> {
  const {
    maxRetries  = 3,
    baseDelayMs = 200,
    maxDelayMs  = 5_000,
    timeoutMs   = 8_000,
    retryCodes  = [429, 502, 503, 504],
  } = opts

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!resp.ok && retryCodes.includes(resp.status) && attempt < maxRetries) {
        const delay = withJitter(backoffMs(attempt, baseDelayMs, maxDelayMs))
        log.warn(`Retry ${attempt + 1}/${maxRetries} — HTTP ${resp.status}`, { url, delayMs: Math.round(delay) })
        await sleep(delay)
        continue
      }

      return resp
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        const delay = withJitter(backoffMs(attempt, baseDelayMs, maxDelayMs))
        log.warn(`Retry ${attempt + 1}/${maxRetries} — erreur réseau`, {
          url,
          delayMs: Math.round(delay),
          err:     err instanceof Error ? err.message : String(err),
        })
        await sleep(delay)
      }
    }
  }

  throw lastError ?? new Error(`fetchWithRetry: toutes les tentatives ont échoué pour ${url}`)
}

export async function fetchProtected(
  url:          string,
  options?:     RequestInit,
  retryOpts?:   RetryOptions,
  breakerName?: string,
  breakerOpts?: CircuitBreakerOptions,
): Promise<Response> {
  const breaker = getCircuitBreaker(breakerName ?? url, breakerOpts)
  return breaker.execute(() => fetchWithRetry(url, options, retryOpts))
}
