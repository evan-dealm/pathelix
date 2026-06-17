import type { VRPSolution, CostContext } from './types'
import type { Driver } from '@/lib/types'
import { cachedDist } from './distanceCache'

export interface ParetoObjectives {

  totalDistanceKm: number

  totalLatenessMin: number

  workloadCV: number
}

export interface ParetoSolution {
  solution: VRPSolution
  objectives: ParetoObjectives

  label: string
}

export function computeObjectives(
  solution: VRPSolution,
  ctx: CostContext,
  drivers: Driver[],
): ParetoObjectives {
  const driverMap = new Map(drivers.map(d => [d.id, d]))
  let totalDistanceKm = 0
  let totalLatenessMin = 0
  const workMins: number[] = []

  for (const route of solution.routes) {
    const driver = driverMap.get(route.driverId)
    if (!driver || route.missions.length === 0) { workMins.push(0); continue }

    let lat = driver.depotLat, lng = driver.depotLng
    let workEst = 0
    let currentMin = ctx.startTimeMin

    for (const m of route.missions) {
      const dist = cachedDist(lat, lng, m.latitude, m.longitude)
      totalDistanceKm += dist
      const travelMin = (dist / Math.max(10, ctx.speedKmh)) * 60
      currentMin += travelMin
      workEst += travelMin

      if (m.timeWindow && currentMin > m.timeWindow.closeMin) {
        totalLatenessMin += currentMin - m.timeWindow.closeMin
      }

      const onSite = (m.estimatedDurationMin ?? 0) + (m.maneuverTimeMin ?? 0)
      currentMin += onSite
      workEst += onSite
      lat = m.latitude; lng = m.longitude
    }

    totalDistanceKm += cachedDist(lat, lng, driver.depotLat, driver.depotLng)
    workMins.push(workEst)
  }

  const activeWork = workMins.filter(w => w > 0)
  let workloadCV = 0
  if (activeWork.length >= 2) {
    const mean = activeWork.reduce((a, b) => a + b, 0) / activeWork.length
    if (mean > 0.001) {
      const variance = Math.max(0, activeWork.reduce((s, v) => s + (v - mean) ** 2, 0) / activeWork.length)
      workloadCV = Math.sqrt(variance) / mean
    }
  }

  return {
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    totalLatenessMin: Math.round(totalLatenessMin),
    workloadCV: Math.round(workloadCV * 100) / 100,
  }
}

function dominates(a: ParetoObjectives, b: ParetoObjectives): boolean {
  const aVals = [a.totalDistanceKm, a.totalLatenessMin, a.workloadCV]
  const bVals = [b.totalDistanceKm, b.totalLatenessMin, b.workloadCV]
  let strictlyBetter = false
  for (let i = 0; i < 3; i++) {
    if (aVals[i] > bVals[i]) return false
    if (aVals[i] < bVals[i]) strictlyBetter = true
  }
  return strictlyBetter
}

export function filterParetoFront(solutions: ParetoSolution[]): ParetoSolution[] {
  const front: ParetoSolution[] = []
  for (const candidate of solutions) {

    const remaining = front.filter(e => !dominates(candidate.objectives, e.objectives))

    const isDominated = remaining.some(e => dominates(e.objectives, candidate.objectives))
    if (!isDominated) {
      remaining.push(candidate)
    }
    front.length = 0
    front.push(...remaining)
  }
  return front
}

export function labelParetoSolutions(solutions: ParetoSolution[]): void {
  if (solutions.length === 0) return

  const bestDist = solutions.reduce((b, s) => s.objectives.totalDistanceKm < b.objectives.totalDistanceKm ? s : b)
  const bestLate = solutions.reduce((b, s) => s.objectives.totalLatenessMin < b.objectives.totalLatenessMin ? s : b)
  const bestBal = solutions.reduce((b, s) => s.objectives.workloadCV < b.objectives.workloadCV ? s : b)

  for (const s of solutions) {
    if (s === bestDist) s.label = 'Km minimal'
    else if (s === bestLate) s.label = 'Zero retard'
    else if (s === bestBal) s.label = 'Charge equilibree'
    else s.label = 'Compromis'
  }
}
