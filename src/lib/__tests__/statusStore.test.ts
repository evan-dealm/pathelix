import { describe, it, expect, beforeEach } from 'vitest'
import { _statusStore, pruneOldStatusEntries } from '@/lib/statusStore'

beforeEach(() => {
  _statusStore.clear()
})

describe('pruneOldStatusEntries', () => {
  it('removes entries with a date older than daysToKeep', () => {
    _statusStore.set('tenant-1|driver-1|2020-01-01', { status: 'done' })
    pruneOldStatusEntries(7)
    expect(_statusStore.has('tenant-1|driver-1|2020-01-01')).toBe(false)
  })

  it('keeps recent entries', () => {
    const recentDate = new Date().toISOString().slice(0, 10)
    _statusStore.set(`tenant-1|driver-1|${recentDate}`, { status: 'active' })
    pruneOldStatusEntries(7)
    expect(_statusStore.has(`tenant-1|driver-1|${recentDate}`)).toBe(true)
  })

  it('removes only old entries, keeps recent ones', () => {
    const recentDate = new Date().toISOString().slice(0, 10)
    _statusStore.set('tenant-1|driver-1|2019-05-01', { status: 'old' })
    _statusStore.set(`tenant-1|driver-2|${recentDate}`, { status: 'new' })

    pruneOldStatusEntries(7)

    expect(_statusStore.has('tenant-1|driver-1|2019-05-01')).toBe(false)
    expect(_statusStore.has(`tenant-1|driver-2|${recentDate}`)).toBe(true)
  })

  it('skips keys with fewer than 3 parts', () => {
    _statusStore.set('malformed|key', { status: 'broken' })
    expect(() => pruneOldStatusEntries(7)).not.toThrow()
    expect(_statusStore.has('malformed|key')).toBe(true)
  })

  it('handles empty store without error', () => {
    expect(() => pruneOldStatusEntries(7)).not.toThrow()
  })

  it('respects custom daysToKeep=0 (prunes entries before today)', () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
    const today     = new Date().toISOString().slice(0, 10)
    _statusStore.set(`t|d|${yesterday}`, { status: 'old' })
    _statusStore.set(`t|d|${today}`,     { status: 'new' })
    pruneOldStatusEntries(0)
    expect(_statusStore.has(`t|d|${yesterday}`)).toBe(false)
    expect(_statusStore.has(`t|d|${today}`)).toBe(true)
  })
})
