import { describe, it, expect } from 'vitest'
import { realDurationMin } from '@/lib/vrp/realDistance'
import type { CostContext } from '@/lib/vrp/types'
import type { OsrmMatrix } from '@/lib/vrp/osrmMatrix'

function makeMatrix(durationMin: number, source: OsrmMatrix['source'] = 'valhalla'): OsrmMatrix {
  return {
    source,
    size: 2,
    indexOf: (id: string) => (id === 'A' ? 0 : id === 'B' ? 1 : -1),
    duration: () => durationMin,
    distance: () => 10,
  }
}

function makeCtx(overrides: Partial<CostContext> = {}): CostContext {
  return {
    depotLat: 0,
    depotLng: 0,
    startTimeMin: 600,
    speedKmh: 50,
    exutoires: [],
    date: '2026-01-05',
    ...overrides,
  }
}

describe('realDurationMin — valhallaFactor', () => {

  it('applique valhallaFactor=1.28 à la durée matrice', () => {

    const ctx = makeCtx({ osrmMatrix: makeMatrix(60), valhallaFactor: 1.28 })
    const result = realDurationMin(ctx, 'A', 0, 0, 'B', 1, 0, 600)
    expect(result).toBeCloseTo(76.8, 1)
  })

  it('sans valhallaFactor (undefined) applique le facteur 1.0 — aucune correction', () => {

    const ctx = makeCtx({ osrmMatrix: makeMatrix(60) })
    const result = realDurationMin(ctx, 'A', 0, 0, 'B', 1, 0, 600)
    expect(result).toBeCloseTo(60, 1)
  })

  it('valhallaFactor=1.0 est neutre', () => {
    const ctxNone = makeCtx({ osrmMatrix: makeMatrix(60) })
    const ctxOne  = makeCtx({ osrmMatrix: makeMatrix(60), valhallaFactor: 1.0 })
    expect(realDurationMin(ctxNone, 'A', 0, 0, 'B', 1, 0, 600))
      .toBe(realDurationMin(ctxOne, 'A', 0, 0, 'B', 1, 0, 600))
  })

  it('combine valhallaFactor avec le facteur de trafic (rush 8h15)', () => {

    const ctxWith    = makeCtx({ osrmMatrix: makeMatrix(60), valhallaFactor: 1.28 })
    const ctxWithout = makeCtx({ osrmMatrix: makeMatrix(60), valhallaFactor: 1.0  })
    const with128  = realDurationMin(ctxWith, 'A', 0, 0, 'B', 1, 0, 495)
    const without  = realDurationMin(ctxWithout, 'A', 0, 0, 'B', 1, 0, 495)
    expect(with128).toBeGreaterThan(without)
    expect(with128 / without).toBeCloseTo(1.28, 1)
  })

  it('NE modifie PAS le fallback haversine (valhallaFactor ignoré sans matrice)', () => {

    const ctxNoFactor   = makeCtx({ speedKmh: 50 })
    const ctxWithFactor = makeCtx({ speedKmh: 50, valhallaFactor: 1.28 })
    const noFactor   = realDurationMin(ctxNoFactor,   'A', 45.0, 5.0, 'B', 45.1, 5.1, 600)
    const withFactor = realDurationMin(ctxWithFactor, 'A', 45.0, 5.0, 'B', 45.1, 5.1, 600)
    expect(noFactor).toBe(withFactor)
  })

  it('retourne 0 pour des points identiques quel que soit le facteur', () => {
    const ctx = makeCtx({ osrmMatrix: makeMatrix(10), valhallaFactor: 1.28 })
    expect(realDurationMin(ctx, 'A', 5, 5, 'A', 5, 5, 600)).toBe(0)
  })

  it('retourne 0 pour des points identiques en fallback haversine', () => {
    const ctx = makeCtx({ valhallaFactor: 1.28, speedKmh: 50 })
    expect(realDurationMin(ctx, 'A', 5, 5, 'A', 5, 5, 600)).toBe(0)
  })

  it('fonctionne avec source osrm (pas seulement valhalla)', () => {

    const ctx = makeCtx({ osrmMatrix: makeMatrix(60, 'osrm'), valhallaFactor: 1.28 })
    const result = realDurationMin(ctx, 'A', 0, 0, 'B', 1, 0, 600)
    expect(result).toBeCloseTo(76.8, 1)
  })

  it('repli haversine quand les points ne sont pas dans la matrice', () => {

    const ctx = makeCtx({ osrmMatrix: makeMatrix(60), valhallaFactor: 1.28, speedKmh: 50 })
    const withMatrix  = realDurationMin(ctx, 'A', 0, 0, 'B', 1, 0, 600)
    const withFallback = realDurationMin(ctx, 'C', 0, 0, 'D', 1, 0, 600)

    expect(withMatrix).not.toBe(withFallback)
    expect(withMatrix).toBeCloseTo(76.8, 1)
  })
})
