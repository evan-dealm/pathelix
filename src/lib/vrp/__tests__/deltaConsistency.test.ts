import { describe, it, expect } from 'vitest'
import { computeRouteCost, computePrefixStates, computeInsertionDelta, computeRemovalDelta } from '../routeCost'
import type { CostContext } from '../types'
import type { OsrmMatrix } from '../osrmMatrix'
import type { Mission, Driver, Exutoire } from '@/lib/types'

// The ALNS ranks every insertion/removal by its delta and only checks full costs on acceptance.
// A delta that disagrees with the full cost silently steers the search wrong (it used to, on
// ~99 % of moves: exutoire trips, weights, skills, lunch, ALLER_RETOUR were all missing). These
// tests pin delta == cost(after) − cost(before) on randomised routes covering every cost term.

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff } }

const TYPES: Mission['type'][] = ['POSER', 'RETIRER', 'ECHANGER', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'ALLER_RETOUR']
const EXUTOIRES: Exutoire[] = [
  { id: 'e1', name: 'E1', address: '', lat: 45.8, lng: 4.9, openingHoursOpen: 420, openingHoursClose: 1080, closedDays: [], acceptedWasteTypes: [], serviceTimeMin: 15 },
  { id: 'e2', name: 'E2', address: '', lat: 45.6, lng: 4.7, openingHoursOpen: 480, openingHoursClose: 960, closedDays: [2], acceptedWasteTypes: ['gravats'], serviceTimeMin: 20 },
]
const DRIVERS: Driver[] = [{ id: 'd1', firstName: 'a', lastName: 'b', sector: 'S', depotName: 'x', depotLat: 45.75, depotLng: 4.85, skills: ['grue'], vehicleCapacity: 2 } as Driver]

function makeMission(r: () => number, id: string, ids: string[]): Mission {
  const m: Mission = {
    id, type: TYPES[Math.floor(r() * TYPES.length)], date: '2026-10-06', address: '',
    latitude: 45.55 + r() * 0.4, longitude: 4.6 + r() * 0.5,
    estimatedDurationMin: 5 + Math.round(r() * 30), maneuverTimeMin: 5,
  }
  if (r() < 0.4) { const o = 420 + Math.round(r() * 400); m.timeWindow = { openMin: o, closeMin: o + 30 + Math.round(r() * 200) } }
  if (r() < 0.2) m.priority = 1
  if (r() < 0.2) m.wasteTypeLabel = 'gravats'
  if (r() < 0.15) m.requiredSkills = [r() < 0.5 ? 'grue' : 'adr']
  if (r() < 0.15 && ids.length > 0) m.dependsOnId = ids[Math.floor(r() * ids.length)]
  if (r() < 0.3) m.siteId = `s${Math.floor(r() * 3)}`
  return m
}

/** A tiny fake routing matrix so the matrix lookup path (by id) is exercised too. */
function fakeMatrix(): OsrmMatrix {
  const idx = new Map<string, number>()
  return {
    distance: (i, j) => (i === j ? 0 : 1 + ((i * 31 + j * 17) % 40)),
    duration: (i, j) => (i === j ? 0 : 2 + ((i * 13 + j * 7) % 50)),
    size: 1_000_000,
    indexOf: id => { let i = idx.get(id); if (i === undefined) { i = idx.size; idx.set(id, i) } return i },
    source: 'valhalla',
  }
}

const VARIANTS: Array<[string, Partial<CostContext>]> = [
  ['defaults', {}],
  ['weights + familiarity', {
    weights: { distance: 0.9, punctuality: 0.9, balance: 0.6, stability: 0.5 },
    familiarity: new Map([['d1:s0', 3], ['d1:s1', 1]]),
  }],
  ['tenant cost config', { costConfig: { lunchBreakStartMin: 690, lunchBreakEndMin: 840, lunchBreakDurationMin: 45, lunchBreakPenalty: 200, overtimePenalty: 900, overtimePerMin: 9, fixedRouteCost: 100 } }],
  ['mid-day start override', { driverStartOverrides: new Map([['d1', { lat: 45.7, lng: 4.8, timeMin: 690 }]]) }],
  ['routing matrix', { osrmMatrix: fakeMatrix(), valhallaFactor: 1.4 }],
]

describe('insertion/removal deltas equal the full-cost difference', () => {
  for (const [name, extra] of VARIANTS) {
    it(name, () => {
      const r = rng(name.length * 977)
      const ctx: CostContext = { depotLat: 45.75, depotLng: 4.85, startTimeMin: 420, speedKmh: 50, exutoires: EXUTOIRES, date: '2026-10-06', ...extra }
      let checked = 0
      for (let trial = 0; trial < 120; trial++) {
        const len = Math.floor(r() * 12)
        const ids: string[] = []
        const missions: Mission[] = []
        for (let i = 0; i < len; i++) { const id = `t${trial}m${i}`; missions.push(makeMission(r, id, [...ids, `t${trial}x`])); ids.push(id) }
        const route = { driverId: 'd1', missions }
        const ins = makeMission(r, `t${trial}x`, ids)
        const base = computeRouteCost(route, ctx, DRIVERS)
        const ps = computePrefixStates(route, ctx, DRIVERS)

        for (let pos = 0; pos <= len; pos++) {
          const after = computeRouteCost({ driverId: 'd1', missions: [...missions.slice(0, pos), ins, ...missions.slice(pos)] }, ctx, DRIVERS)
          expect(computeInsertionDelta(route, ins, pos, ps, base, ctx, DRIVERS)).toBeCloseTo(after - base, 6)
          checked++
        }
        for (let pos = 0; pos < len; pos++) {
          const after = computeRouteCost({ driverId: 'd1', missions: missions.filter((_, i) => i !== pos) }, ctx, DRIVERS)
          expect(computeRemovalDelta(route, pos, ps, base, ctx, DRIVERS)).toBeCloseTo(after - base, 6)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(1000)
    })
  }
})
