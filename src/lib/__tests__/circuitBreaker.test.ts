import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker'

describe('CircuitBreaker', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeBreaker(threshold = 3, recoveryMs = 1_000) {
    return new CircuitBreaker('test', {
      failureThreshold:  threshold,
      recoveryTimeMs:    recoveryMs,
      halfOpenSuccesses: 2,
    })
  }

  it('laisse passer les appels réussis (CLOSED)', async () => {
    const cb     = makeBreaker()
    const result = await cb.execute(async () => 42)
    expect(result).toBe(42)
    expect(cb.getState()).toBe('CLOSED')
  })

  it('passe en OPEN après failureThreshold échecs', async () => {
    const cb = makeBreaker(3)
    const fn = async () => { throw new Error('err') }

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fn)).rejects.toThrow('err')
    }
    expect(cb.getState()).toBe('OPEN')
  })

  it('rejette immédiatement avec CircuitOpenError quand OPEN', async () => {
    const cb = makeBreaker(1)
    await expect(cb.execute(async () => { throw new Error('fail') })).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')
    await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError)
  })

  it('passe en HALF_OPEN après recoveryTimeMs', async () => {
    const cb = makeBreaker(1, 500)
    await expect(cb.execute(async () => { throw new Error() })).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')

    vi.advanceTimersByTime(600)

    await cb.execute(async () => 'probe')
    expect(cb.getState()).toBe('HALF_OPEN')
  })

  it('repasse en CLOSED après halfOpenSuccesses succès', async () => {
    const cb = makeBreaker(1, 500)
    await expect(cb.execute(async () => { throw new Error() })).rejects.toThrow()

    vi.advanceTimersByTime(600)
    await cb.execute(async () => 'ok')
    await cb.execute(async () => 'ok')
    expect(cb.getState()).toBe('CLOSED')
  })

  it('repasse en OPEN si un échec survient en HALF_OPEN', async () => {
    const cb = makeBreaker(1, 500)
    await expect(cb.execute(async () => { throw new Error() })).rejects.toThrow()

    vi.advanceTimersByTime(600)
    await cb.execute(async () => 'ok')

    await expect(
      cb.execute(async () => { throw new Error('fail in half-open') }),
    ).rejects.toThrow()
    expect(cb.getState()).toBe('OPEN')
  })

  it('remet le compteur d\'échecs à 0 après un succès en CLOSED', async () => {
    const cb = makeBreaker(3)
    const fail = async () => { throw new Error() }
    const ok   = async () => 'ok'

    await expect(cb.execute(fail)).rejects.toThrow()
    await expect(cb.execute(fail)).rejects.toThrow()
    await cb.execute(ok)

    await expect(cb.execute(fail)).rejects.toThrow()
    await expect(cb.execute(fail)).rejects.toThrow()
    expect(cb.getState()).toBe('CLOSED')
  })
})
