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
  // Changed on purpose: this used to assert the LEFT-most entry ('1.2.3.4'), which is whatever
  // the client chose to send — rotating it bypassed every IP limiter (login brute force). Our
  // reverse proxy appends the address it saw, so the trustworthy entry is the right-most one.
  it('utilise l\'entrée X-Forwarded-For ajoutée par notre proxy (la plus à droite)', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    expect(getClientIp(h)).toBe('5.6.7.8')
  })

  it('ignore une entrée X-Forwarded-For forgée par le client', () => {
    const a = getClientIp(new Headers({ 'x-forwarded-for': '10.0.0.1, 203.0.113.9' }))
    const b = getClientIp(new Headers({ 'x-forwarded-for': '10.0.0.2, 203.0.113.9' }))
    expect(a).toBe(b)
  })

  it('remonte de TRUSTED_PROXY_COUNT sauts derrière plusieurs proxys', () => {
    process.env.TRUSTED_PROXY_COUNT = '2'
    try {
      expect(getClientIp(new Headers({ 'x-forwarded-for': 'spoof, 198.51.100.4, 10.0.0.5' }))).toBe('198.51.100.4')
    } finally {
      delete process.env.TRUSTED_PROXY_COUNT
    }
  })

  it('utilise X-Real-IP si XFF absent', () => {
    const h = new Headers({ 'x-real-ip': '9.9.9.9' })
    expect(getClientIp(h)).toBe('9.9.9.9')
  })

  it('fallback 127.0.0.1', () => {
    expect(getClientIp(new Headers())).toBe('127.0.0.1')
  })
})
