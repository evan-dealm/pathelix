import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

const solveMock = vi.hoisted(() => vi.fn())
vi.mock('../sectorWorker', () => ({ solveSector: solveMock }))

import { runSectorsInParallel } from '../threadPool'
import { serializeSubMatrix, deserializeMatrix, type OsrmMatrix } from '../osrmMatrix'
import type { SectorWorkerInput } from '../sectorWorker'
import type { Mission, Driver } from '@/lib/types'

const mission = (id: string): Mission => ({
  id, type: 'POSER', date: '2026-10-06', address: id, latitude: 45.75, longitude: 4.85, estimatedDurationMin: 10, maneuverTimeMin: 5,
})
const driver = (id: string): Driver => ({ id, firstName: 'D', lastName: id, sector: 'S', depotName: 'Dépôt', depotLat: 45.75, depotLng: 4.85 })

function task(i: number, missions: Mission[], drivers: Driver[]): SectorWorkerInput {
  return {
    missions, drivers, sectorIndex: i,
    ctx: { depotLat: 45.75, depotLng: 4.85, startTimeMin: 420, speedKmh: 50, exutoires: [], date: '2026-10-06' },
    params: { timeBudgetMs: 0, seed: 1, iterations: 1, destroyRatio: 0.3, saT0Ratio: 0.05, saTMinRatio: 0.0002, rhoForget: 0.85 },
  }
}

describe('runSectorsInParallel — a failing sector is never dropped', () => {
  beforeEach(() => { solveMock.mockReset() })

  it('returns one solution per task, in order', async () => {
    solveMock.mockImplementation((t: SectorWorkerInput) => ({ routes: t.drivers.map(d => ({ driverId: d.id, missions: t.missions })), cost: 1 }))
    const out = await runSectorsInParallel([task(0, [mission('a')], [driver('d1')]), task(1, [mission('b')], [driver('d2')])])
    expect(out.map(s => s.routes[0].driverId)).toEqual(['d1', 'd2'])
  })

  it('falls back to the initial construction when the search throws — missions and drivers kept', async () => {
    solveMock.mockImplementation(() => { throw new Error('boom') })
    const out = await runSectorsInParallel([task(0, [mission('a'), mission('b')], [driver('d1')])])
    expect(out).toHaveLength(1)
    expect(out[0].routes.map(r => r.driverId)).toEqual(['d1'])
    expect(out[0].routes.flatMap(r => r.missions.map(m => m.id)).sort()).toEqual(['a', 'b'])
  })
})

describe('matrix serialisation for worker threads', () => {
  it('round-trips the requested sub-matrix and ignores unknown ids', () => {
    const ids = ['a', 'b', 'c']
    const full: OsrmMatrix = {
      distance: (i, j) => i * 10 + j,
      duration: (i, j) => (i * 10 + j) * 2,
      size: 3,
      indexOf: id => ids.indexOf(id),
      source: 'valhalla',
    }
    const ser = serializeSubMatrix(full, ['c', 'a', 'zzz'])
    expect(() => structuredClone(ser)).not.toThrow()
    const m = deserializeMatrix(structuredClone(ser))
    expect(m.size).toBe(2)
    expect(m.indexOf('zzz')).toBe(-1)
    expect(m.distance(m.indexOf('c'), m.indexOf('a'))).toBe(20)
    expect(m.duration(m.indexOf('a'), m.indexOf('c'))).toBe(4)
    expect(m.distance(m.indexOf('a'), m.indexOf('a'))).toBe(0)
    expect(m.source).toBe('valhalla')
  })
})
