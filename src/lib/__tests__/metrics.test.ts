import { describe, it, expect, beforeEach } from 'vitest'
import { metrics } from '../metrics'

beforeEach(() => { metrics.reset() })

describe('counters', () => {
  it('starts at 0', () => {
    expect(metrics.getCounter('foo')).toBe(0)
  })

  it('increments', () => {
    metrics.increment('hits')
    metrics.increment('hits')
    expect(metrics.getCounter('hits')).toBe(2)
  })

  it('increments by custom amount', () => {
    metrics.increment('bytes', {}, 1024)
    expect(metrics.getCounter('bytes')).toBe(1024)
  })

  it('isolates by labels', () => {
    metrics.increment('req', { method: 'GET' })
    metrics.increment('req', { method: 'POST' })
    metrics.increment('req', { method: 'GET' })
    expect(metrics.getCounter('req', { method: 'GET' })).toBe(2)
    expect(metrics.getCounter('req', { method: 'POST' })).toBe(1)
  })
})

describe('histograms', () => {
  it('records count and sum', () => {
    metrics.histogram('latency', 100)
    metrics.histogram('latency', 200)
    const snap = metrics.snapshot()
    const h = snap.histograms['latency']
    expect(h.count).toBe(2)
    expect(h.sum).toBe(300)
    expect(h.avg).toBe(150)
  })

  it('tracks min/max', () => {
    metrics.histogram('d', 10)
    metrics.histogram('d', 50)
    metrics.histogram('d', 5)
    const snap = metrics.snapshot()
    expect(snap.histograms['d'].min).toBe(5)
    expect(snap.histograms['d'].max).toBe(50)
  })

  it('ignores non-finite values', () => {
    metrics.histogram('x', NaN)
    metrics.histogram('x', Infinity)
    const snap = metrics.snapshot()
    expect(snap.histograms['x']).toBeUndefined()
  })

  it('computes percentiles with sufficient data', () => {
    for (let i = 1; i <= 100; i++) metrics.histogram('p', i)
    const snap = metrics.snapshot()
    const h = snap.histograms['p']
    expect(h.p50).toBeGreaterThanOrEqual(45)
    expect(h.p50).toBeLessThanOrEqual(55)
    expect(h.p95).toBeGreaterThanOrEqual(90)
    expect(h.p99).toBeGreaterThanOrEqual(95)
  })
})

describe('snapshot', () => {
  it('includes timestamp', () => {
    const snap = metrics.snapshot()
    expect(snap.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns empty maps when reset', () => {
    metrics.increment('x')
    metrics.reset()
    const snap = metrics.snapshot()
    expect(Object.keys(snap.counters)).toHaveLength(0)
    expect(Object.keys(snap.histograms)).toHaveLength(0)
  })
})

describe('countersFor', () => {
  it('filters by prefix', () => {
    metrics.increment('api.get')
    metrics.increment('api.post')
    metrics.increment('vrp.job')
    const apiCounters = metrics.countersFor('api.')
    expect(Object.keys(apiCounters)).toHaveLength(2)
    expect(apiCounters['api.get']).toBe(1)
    expect(apiCounters['api.post']).toBe(1)
  })
})
