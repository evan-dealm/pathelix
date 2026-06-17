import type { Mission } from '@/lib/types'
import type { VRPSolution, CostContext } from './types'
import type { Driver } from '@/lib/types'
import { computeRouteCost } from './routeCost'

export interface Scenario {

  durationFactor: number

  travelFactor: number

  label: string
}

export function generateScenarios(n: number = 5, seed: number = 42): Scenario[] {
  const scenarios: Scenario[] = [
    { durationFactor: 1.0,  travelFactor: 1.0,  label: 'Nominal' },
    { durationFactor: 0.85, travelFactor: 0.85, label: 'Optimiste' },
    { durationFactor: 1.15, travelFactor: 1.20, label: 'Pessimiste leger' },
    { durationFactor: 1.25, travelFactor: 1.35, label: 'Pessimiste fort' },
    { durationFactor: 1.40, travelFactor: 1.50, label: 'Worst case' },
  ]

  let s = seed >>> 0
  for (let i = scenarios.length; i < n; i++) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    const r1 = (s >>> 0) / 0x100000000
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    const r2 = (s >>> 0) / 0x100000000
    scenarios.push({
      durationFactor: 0.8 + r1 * 0.6,
      travelFactor: 0.8 + r2 * 0.7,
      label: `Scenario ${i + 1}`,
    })
  }

  return scenarios.slice(0, n)
}

export function applyScenario(missions: Mission[], scenario: Scenario): Mission[] {
  if (scenario.durationFactor === 1.0) return missions
  return missions.map(m => ({
    ...m,
    estimatedDurationMin: Math.round(m.estimatedDurationMin * scenario.durationFactor),
    maneuverTimeMin: Math.round((m.maneuverTimeMin ?? 0) * scenario.durationFactor),
  }))
}

export function evaluateCVaR(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
  scenarios: Scenario[],
  alpha: number = 0.3,
): {

  meanCost: number

  cvarCost: number

  scenarioCosts: Array<{ label: string; cost: number }>
} {
  const costs: Array<{ label: string; cost: number }> = []

  for (const scenario of scenarios) {

    const perturbedCtx: CostContext = {
      ...ctx,
      speedKmh: ctx.speedKmh / scenario.travelFactor,
    }

    let totalCost = 0
    for (const route of solution.routes) {

      const perturbedRoute = {
        ...route,
        missions: route.missions.map(m => ({
          ...m,
          estimatedDurationMin: Math.round(m.estimatedDurationMin * scenario.durationFactor),
          maneuverTimeMin: Math.round((m.maneuverTimeMin ?? 0) * scenario.durationFactor),
        })),
      }
      totalCost += computeRouteCost(perturbedRoute, perturbedCtx, drivers)
    }

    costs.push({ label: scenario.label, cost: totalCost })
  }

  costs.sort((a, b) => b.cost - a.cost)

  const meanCost = costs.reduce((s, c) => s + c.cost, 0) / costs.length
  const worstCount = Math.max(1, Math.ceil(costs.length * alpha))
  const cvarCost = costs.slice(0, worstCount).reduce((s, c) => s + c.cost, 0) / worstCount

  return { meanCost, cvarCost, scenarioCosts: costs }
}
