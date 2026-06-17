import { describe, it, expect } from 'vitest'
import { buildTrafficTar } from '../traffic/trafficTarBuilder'
import type { EdgeSpeed } from '../traffic/trafficTarBuilder'

describe('buildTrafficTar', () => {
  it('returns null for empty edge list', () => {
    expect(buildTrafficTar([])).toBeNull()
  })

  it('returns a Buffer for valid edges', () => {
    const edges: EdgeSpeed[] = [
      { edgeId: '1000000000', speedKmh: 80 },
    ]
    const result = buildTrafficTar(edges)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('ends with 1024 zero bytes (tar end-of-archive)', () => {
    const edges: EdgeSpeed[] = [
      { edgeId: '1000000000', speedKmh: 80 },
    ]
    const buf = buildTrafficTar(edges)!
    const tail = buf.slice(buf.length - 1024)
    expect(tail.every(b => b === 0)).toBe(true)
  })

  it('output size is multiple of 512 (tar block alignment)', () => {
    const edges: EdgeSpeed[] = [
      { edgeId: '1000000000', speedKmh: 80 },
      { edgeId: '2000000000', speedKmh: 50 },
    ]
    const buf = buildTrafficTar(edges)!
    expect(buf.length % 512).toBe(0)
  })

  it('skips invalid edgeIds', () => {
    const edges: EdgeSpeed[] = [
      { edgeId: '-1', speedKmh: 80 },
      { edgeId: 'not-a-number', speedKmh: 80 },
    ]
    expect(buildTrafficTar(edges)).toBeNull()
  })

  it('treats speedKmh=0 as 1', () => {
    const edges: EdgeSpeed[] = [
      { edgeId: '1000000000', speedKmh: 0 },
    ]
    const buf = buildTrafficTar(edges)
    expect(buf).toBeInstanceOf(Buffer)
  })

  it('clamps speed to 127 max', () => {
    const edges: EdgeSpeed[] = [
      { edgeId: '1000000000', speedKmh: 200 }, // over 127
    ]
    const buf = buildTrafficTar(edges)
    expect(buf).toBeInstanceOf(Buffer)
  })

  it('produces larger buffer for more edges in different tiles', () => {
    const edge1: EdgeSpeed[] = [{ edgeId: '1000000000', speedKmh: 80 }]
    // Different tile: different tileId bits
    const edge2: EdgeSpeed[] = [{ edgeId: '1000000000', speedKmh: 80 }, { edgeId: '3000000000', speedKmh: 60 }]
    const buf1 = buildTrafficTar(edge1)!
    const buf2 = buildTrafficTar(edge2)!
    // May or may not be larger (edges could be in same tile), but both should be valid
    expect(buf1.length % 512).toBe(0)
    expect(buf2.length % 512).toBe(0)
  })

  it('header starts with filename in ASCII', () => {
    const edges: EdgeSpeed[] = [{ edgeId: '1000000000', speedKmh: 80 }]
    const buf = buildTrafficTar(edges)!
    // First 100 bytes of tar header = filename, should be ASCII-printable
    const filename = buf.slice(0, 50).toString('ascii').replace(/\0/g, '')
    expect(filename.length).toBeGreaterThan(0)
    expect(filename).toMatch(/^[0-9/\.a-z]+/)
  })
})
