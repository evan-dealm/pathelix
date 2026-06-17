import { describe, it, expect, beforeEach } from 'vitest'
import { loadShedder } from '../loadShedder'

beforeEach(() => { loadShedder.reset() })

describe('acquire', () => {
  it('retourne "ok" sous le seuil normal', () => {
    expect(loadShedder.acquire()).toBe('ok')
    loadShedder.release()
  })

  it('retourne "throttle" entre normal et max', () => {

    const normal = 50
    for (let i = 0; i < normal; i++) loadShedder.acquire()
    const result = loadShedder.acquire()
    expect(result).toBe('throttle')

    for (let i = 0; i <= normal; i++) loadShedder.release()
  })

  it('retourne "shed" au-dessus du max', () => {
    const max = 200
    for (let i = 0; i < max; i++) loadShedder.acquire()
    expect(loadShedder.acquire()).toBe('shed')
    for (let i = 0; i < max; i++) loadShedder.release()
  })
})

describe('concurrent counter', () => {
  it('incrémente à acquire', () => {
    expect(loadShedder.concurrent).toBe(0)
    loadShedder.acquire()
    expect(loadShedder.concurrent).toBe(1)
    loadShedder.acquire()
    expect(loadShedder.concurrent).toBe(2)
    loadShedder.release()
    loadShedder.release()
    expect(loadShedder.concurrent).toBe(0)
  })

  it('ne descend pas sous 0', () => {
    loadShedder.release()
    expect(loadShedder.concurrent).toBe(0)
  })
})

describe('wrap', () => {
  it('exécute la fonction et libère le slot', async () => {
    const result = await loadShedder.wrap(async () => 42)
    expect(result).toBe(42)
    expect(loadShedder.concurrent).toBe(0)
  })

  it('libère le slot même si la fonction throw', async () => {
    await expect(
      loadShedder.wrap(async () => { throw new Error('fail') }),
    ).rejects.toThrow('fail')
    expect(loadShedder.concurrent).toBe(0)
  })
})
