import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLogger, timer, withRequestId, getRequestId } from '../logger'

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('émet un log info sur console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createLogger('/test')
    log.info('hello world')
    expect(spy).toHaveBeenCalledOnce()
    const msg = spy.mock.calls[0][0] as string
    expect(msg).toContain('INFO')
    expect(msg).toContain('/test')
    expect(msg).toContain('hello world')
  })

  it('émet un log warn sur console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = createLogger('/test')
    log.warn('attention')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('émet un log error sur console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('/test')
    log.error('crash', { code: 500 })
    expect(spy).toHaveBeenCalledOnce()
    const msg = spy.mock.calls[0][0] as string
    expect(msg).toContain('ERROR')
    expect(msg).toContain('{"code":500}')
  })

  it('inclut le requestId courant dans les logs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const log = createLogger('/test')

    withRequestId('test-request-id-1234', () => {
      log.info('message avec context')
    })

    const msg = spy.mock.calls[0][0] as string
    expect(msg).toContain('test-req')
  })
})

describe('timer()', () => {
  it('retourne une durée en ms positive', async () => {
    const elapsed = timer()
    await new Promise(r => setTimeout(r, 10))
    const ms = elapsed()
    expect(ms).toBeGreaterThanOrEqual(5)
    expect(typeof ms).toBe('number')
  })

  it('peut être appelé plusieurs fois', () => {
    const elapsed = timer()
    const t1 = elapsed()
    const t2 = elapsed()

    expect(t2).toBeGreaterThanOrEqual(t1)
  })
})

describe('withRequestId / getRequestId', () => {
  it('retourne le requestId dans le contexte', () => {
    withRequestId('my-id', () => {
      expect(getRequestId()).toBe('my-id')
    })
  })

  it('retourne undefined hors contexte', () => {
    expect(getRequestId()).toBeUndefined()
  })

  it('isole les contextes imbriqués', () => {
    withRequestId('outer', () => {
      withRequestId('inner', () => {
        expect(getRequestId()).toBe('inner')
      })
      expect(getRequestId()).toBe('outer')
    })
  })
})
