import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TtlCache } from '../cache'

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stocke et retourne une valeur', () => {
    const cache = new TtlCache<string, number>(1_000)
    cache.set('a', 42)
    expect(cache.get('a')).toBe(42)
  })

  it('retourne undefined pour une clé absente', () => {
    const cache = new TtlCache<string, number>(1_000)
    expect(cache.get('absent')).toBeUndefined()
  })

  it('expire les entrées après le TTL', () => {
    const cache = new TtlCache<string, string>(500)
    cache.set('key', 'value')

    vi.advanceTimersByTime(499)
    expect(cache.get('key')).toBe('value')

    vi.advanceTimersByTime(2)
    expect(cache.get('key')).toBeUndefined()
  })

  it('respecte un TTL personnalisé par entrée', () => {
    const cache = new TtlCache<string, string>(10_000)
    cache.set('short', 'v', 100)
    cache.set('long',  'v', 5_000)

    vi.advanceTimersByTime(200)
    expect(cache.get('short')).toBeUndefined()
    expect(cache.get('long')).toBe('v')
  })

  it('delete() supprime une entrée', () => {
    const cache = new TtlCache<string, number>(1_000)
    cache.set('x', 1)
    expect(cache.delete('x')).toBe(true)
    expect(cache.get('x')).toBeUndefined()
    expect(cache.delete('x')).toBe(false)
  })

  it('clear() vide le cache', () => {
    const cache = new TtlCache<string, number>(1_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  it('size() compte uniquement les entrées non expirées', () => {
    const cache = new TtlCache<string, number>(1_000)
    cache.set('a', 1, 100)
    cache.set('b', 2, 2_000)
    expect(cache.size()).toBe(2)

    vi.advanceTimersByTime(200)
    expect(cache.size()).toBe(1)
  })

  it('invalidate() supprime les entrées correspondant au prédicat', () => {
    const cache = new TtlCache<string, number>(1_000)
    cache.set('driver:1', 1)
    cache.set('driver:2', 2)
    cache.set('mission:1', 3)

    cache.invalidate(k => k.startsWith('driver:'))
    expect(cache.get('driver:1')).toBeUndefined()
    expect(cache.get('driver:2')).toBeUndefined()
    expect(cache.get('mission:1')).toBe(3)
  })

  it('purge() supprime les entrées expirées', () => {
    const cache = new TtlCache<string, number>(1_000)
    cache.set('a', 1, 100)
    cache.set('b', 2, 100)
    cache.set('c', 3, 2_000)

    vi.advanceTimersByTime(200)
    const removed = cache.purge()
    expect(removed).toBe(2)
    expect(cache.size()).toBe(1)
  })

  it('getOrSet() retourne le cache si disponible', async () => {
    const cache   = new TtlCache<string, number>(1_000)
    const factory = vi.fn(async () => 99)

    await cache.getOrSet('k', factory)
    await cache.getOrSet('k', factory)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(cache.get('k')).toBe(99)
  })

  it('getOrSet() rappelle la factory après expiration', async () => {
    const cache   = new TtlCache<string, number>(100)
    const factory = vi.fn(async () => 42)

    await cache.getOrSet('k', factory)
    vi.advanceTimersByTime(200)
    await cache.getOrSet('k', factory)

    expect(factory).toHaveBeenCalledTimes(2)
  })
})
