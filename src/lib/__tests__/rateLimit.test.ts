import { describe, it, expect } from 'vitest'
import { createRateLimiter, getClientIp } from '../rateLimit'

describe('in-memory rate limiter', () => {
  it('autorise jusqu\'à max requêtes', () => {
    const rl = createRateLimiter(3, 60_000)
    expect(rl.check('key')).toBe(true)
    expect(rl.check('key')).toBe(true)
    expect(rl.check('key')).toBe(true)
    expect(rl.check('key')).toBe(false)
  })

  it('réinitialise après la fenêtre', async () => {
    const rl  = createRateLimiter(2, 50)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false)
    await new Promise(r => setTimeout(r, 60))
    expect(rl.check('k')).toBe(true)
  })

  it('isole les clés différentes', () => {
    const rl = createRateLimiter(1, 60_000)
    expect(rl.check('a')).toBe(true)
    expect(rl.check('a')).toBe(false)
    expect(rl.check('b')).toBe(true)
    expect(rl.check('b')).toBe(false)
  })

  it('retourne les headers corrects', () => {
    const rl = createRateLimiter(5, 60_000)
    rl.check('h')
    rl.check('h')
    const h = rl.headers('h')
    expect(h['X-RateLimit-Limit']).toBe('5')
    expect(h['X-RateLimit-Remaining']).toBe('3')
  })

  it('gère le bucketCap sans fuite mémoire', () => {
    const rl = createRateLimiter(100, 60_000, { bucketCap: 3 })

    rl.check('x1'); rl.check('x2'); rl.check('x3')

    expect(() => rl.check('x4')).not.toThrow()
  })
})

describe('getClientIp', () => {
  it('préfère X-Forwarded-For', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    expect(getClientIp(h)).toBe('1.2.3.4')
  })

  it('utilise X-Real-IP si XFF absent', () => {
    const h = new Headers({ 'x-real-ip': '9.9.9.9' })
    expect(getClientIp(h)).toBe('9.9.9.9')
  })

  it('fallback 127.0.0.1', () => {
    expect(getClientIp(new Headers())).toBe('127.0.0.1')
  })
})
