import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { initTelemetry, withSpan, spanVrpStep, spanDbQuery } from '@/lib/telemetry'

beforeEach(() => {
  delete process.env.OTEL_ENABLED
})

describe('initTelemetry', () => {
  it('returns without error when OTEL_ENABLED is not set', async () => {
    await expect(initTelemetry()).resolves.not.toThrow()
  })

  it('returns without error when OTEL_ENABLED is "false"', async () => {
    process.env.OTEL_ENABLED = 'false'
    await expect(initTelemetry()).resolves.not.toThrow()
  })
})

describe('withSpan — not initialized', () => {
  it('calls fn directly and returns its result', async () => {
    const fn = vi.fn().mockResolvedValue(42)
    const result = await withSpan('test.span', { key: 'value' }, fn)
    expect(result).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from fn', async () => {
    await expect(
      withSpan('test.span', {}, async () => { throw new Error('fn error') }),
    ).rejects.toThrow('fn error')
  })

  it('works with no attributes', async () => {
    const result = await withSpan('empty.attrs', {}, async () => 'done')
    expect(result).toBe('done')
  })

  it('passes numeric and boolean attributes without error', async () => {
    const result = await withSpan('typed.attrs', { count: 5, enabled: true }, async () => 'ok')
    expect(result).toBe('ok')
  })
})

describe('spanVrpStep', () => {
  it('calls fn and returns result', async () => {
    const result = await spanVrpStep('optimize', 'tenant-1', async () => 'vrp-done')
    expect(result).toBe('vrp-done')
  })
})

describe('spanDbQuery', () => {
  it('calls fn and returns result', async () => {
    const result = await spanDbQuery('driver', 'findMany', async () => [1, 2, 3])
    expect(result).toEqual([1, 2, 3])
  })
})
