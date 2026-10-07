import { describe, it, expect } from 'vitest'
import { runVRP } from '../index'
import { simulateRouteTrace } from '../routeCost'
import type { CostContext } from '../types'
import type { Driver, Exutoire, Mission } from '@/lib/types'

/**
 * Generated days. Nobody wrote these cases by hand: each seed builds a different fleet and a
 * different day (urgent missions, time windows, bin sizes, skills, weights, dependencies), the
 * optimiser plans it, and the plan must satisfy what must always be true — whatever the day.
 */

const DATE = '2026-10-06' // a Tuesday
const DEPOT = { lat: 45.23, lng: 5.68 }

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

function generateDay(seed: number): {
  missions: Mission[]
  drivers: Driver[]
  exutoires: Exutoire[]
} {
  const r = rng(seed)
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
  const nDrivers = 2 + Math.floor(r() * 4)
  const drivers: Driver[] = Array.from({ length: nDrivers }, (_, i) => ({
    id: `d${i}`,
    firstName: 'D',
    lastName: String(i),
    sector: 'S',
    depotName: 'Dépôt',
    depotLat: DEPOT.lat,
    depotLng: DEPOT.lng,
    vehicleCapacity: 1,
    maxBinSizeM3: pick([15, 30, 30]),
    skills: r() < 0.3 ? ['ADR'] : [],
    payload: { maxPayloadKg: pick([9_200, 13_500]) },
  }))
  const exutoires: Exutoire[] = [0, 1].map(
    i =>
      ({
        id: `ex${i}`,
        name: `Exutoire ${i}`,
        address: 'x',
        lat: DEPOT.lat + (i ? 0.05 : -0.04),
        lng: DEPOT.lng + (i ? 0.08 : -0.06),
        openingHoursOpen: 7 * 60,
        openingHoursClose: 17 * 60,
        closedDays: [0],
        acceptedWasteTypes: [],
        serviceTimeMin: 15,
      }) as unknown as Exutoire,
  )
  const n = 8 + Math.floor(r() * 22)
  const missions: Mission[] = []
  for (let i = 0; i < n; i++) {
    const type = pick(['POSER', 'RETIRER', 'ECHANGER', 'DEPLACER', 'RETIRER'] as const)
    const m: Mission = {
      id: `s${seed}m${i}`,
      type,
      date: DATE,
      address: `adresse ${i}`,
      clientName: `Client ${i % 7}`,
      latitude: DEPOT.lat + (r() - 0.5) * 0.35,
      longitude: DEPOT.lng + (r() - 0.5) * 0.5,
      estimatedDurationMin: 10 + Math.floor(r() * 25),
      maneuverTimeMin: 5,
      binSizeM3: pick([8, 15, 20, 30]),
    }
    if (r() < 0.15) m.priority = 1
    if (r() < 0.25) {
      const open = 7 * 60 + Math.floor(r() * 8) * 60
      m.timeWindow = { openMin: open, closeMin: open + 120 }
    }
    if (r() < 0.08) m.requiredSkills = ['ADR']
    if (r() < 0.3) m.weightKg = 500 + Math.floor(r() * 16_000)
    if (i > 0 && r() < 0.12) m.dependsOnId = missions[Math.floor(r() * i)].id
    missions.push(m)
  }
  return { missions, drivers, exutoires }
}

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 37)

describe('optimiser invariants on generated days', () => {
  it.each(SEEDS)(
    'seed %i: every mission is planned once or explained, and no hard rule is broken',
    async seed => {
      const { missions, drivers, exutoires } = generateDay(seed)
      const res = await runVRP(missions, drivers, exutoires, DATE, {
        timeBudgetMs: 400,
        seed,
        defaultStartTime: '06:30',
      })

      // 1. Conservation: each input mission exactly once — planned, or unassigned.
      const planned = Object.values(res.assignments)
        .flat()
        .filter(s => !s.isSynthetic)
        .map(s => s.id)
      const unassigned = res.unassignedMissions.map(m => m.id)
      const all = [...planned, ...unassigned]
      expect(new Set(all).size, 'a mission appears twice').toBe(all.length)
      expect([...all].sort()).toEqual(missions.map(m => m.id).sort())
      expect(res.stats.assignedMissions).toBe(planned.length)

      // 2. Nothing is left out silently.
      for (const id of unassigned)
        expect(res.unassignedReasons?.[id]?.message, `no reason for ${id}`).toBeTruthy()

      // 3. Only known drivers, and per route: the truck can take the bin, the driver has the skill,
      //    and no bin heavier than the truck's payload is planned.
      const driverById = new Map(drivers.map(d => [d.id, d]))
      const byId = new Map(missions.map(m => [m.id, m]))
      const startOf = new Map<string, number>()
      const ctx: CostContext = {
        depotLat: DEPOT.lat,
        depotLng: DEPOT.lng,
        startTimeMin: 390,
        speedKmh: 50,
        exutoires,
        date: DATE,
      }
      for (const [driverId, steps] of Object.entries(res.assignments)) {
        const d = driverById.get(driverId)
        expect(d, `unknown driver ${driverId}`).toBeDefined()
        const real = steps.filter(s => !s.isSynthetic)
        for (const s of real) {
          const m = byId.get(s.id)!
          if (m.type !== 'DEPLACER' && m.binSizeM3 && d!.maxBinSizeM3)
            expect(m.binSizeM3, `${m.id}: bin too large for ${driverId}`).toBeLessThanOrEqual(
              d!.maxBinSizeM3,
            )
          for (const skill of m.requiredSkills ?? [])
            expect(d!.skills ?? [], `${m.id}: ${driverId} lacks ${skill}`).toContain(skill)
        }
        const trace = simulateRouteTrace(
          { driverId, missions: real.map(s => byId.get(s.id)!) },
          ctx,
          drivers,
        )!
        const hard = trace.violations.filter(v => v.hard).map(v => `${v.code}:${v.missionId ?? ''}`)
        expect(hard, `hard violations on ${driverId}`).toEqual([])
        for (const e of trace.events)
          if (e.kind === 'mission' && !startOf.has(e.mission.id))
            startOf.set(e.mission.id, e.startMin)
      }

      // 4. A mission never starts before the one it depends on — on the same truck or another.
      for (const id of planned) {
        const dep = byId.get(id)!.dependsOnId
        if (!dep) continue
        expect(planned, `${id} is planned but its prerequisite ${dep} is not`).toContain(dep)
        expect(
          startOf.get(id)!,
          `${id} starts before its prerequisite ${dep}`,
        ).toBeGreaterThanOrEqual(startOf.get(dep)!)
      }
    },
    30_000,
  )
})
