import type { Driver, Mission } from '@/lib/types'
import { cachedDist } from './distanceCache'

export interface Sector {

  index: number

  drivers: Driver[]

  missions: Mission[]
}

export function clusterDriversGeographically(
  drivers: Driver[],
  targetSectorSize = 15,
): number[] {
  if (drivers.length === 0) return []

  const N = drivers.length
  const K = Math.max(1, Math.ceil(N / targetSectorSize))

  if (K === 1) return new Array(N).fill(0)

  const points = drivers.map(d => [d.depotLat, d.depotLng] as [number, number])

  const meanLat = points.reduce((s, p) => s + p[0], 0) / N
  const lngScale = Math.cos(meanLat * Math.PI / 180)

  const centroids: [number, number][] = []
  const distToClosest = new Float64Array(N).fill(Infinity)

  centroids.push([...points[0]])

  for (let c = 1; c < K; c++) {

    for (let i = 0; i < N; i++) {
      const dlat = points[i][0] - centroids[c - 1][0]
      const dlng = (points[i][1] - centroids[c - 1][1]) * lngScale
      const d = dlat * dlat + dlng * dlng
      if (d < distToClosest[i]) distToClosest[i] = d
    }

    let maxDist = -1, maxIdx = 0
    for (let i = 0; i < N; i++) {
      if (distToClosest[i] > maxDist) { maxDist = distToClosest[i]; maxIdx = i }
    }
    centroids.push([...points[maxIdx]])
  }

  const assignments = new Int32Array(N)
  const MAX_ITER = 50

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false

    for (let i = 0; i < N; i++) {
      let bestK = 0, bestD = Infinity
      for (let k = 0; k < K; k++) {
        const dlat = points[i][0] - centroids[k][0]
        const dlng = (points[i][1] - centroids[k][1]) * lngScale
        const d = dlat * dlat + dlng * dlng
        if (d < bestD) { bestD = d; bestK = k }
      }
      if (assignments[i] !== bestK) { assignments[i] = bestK; changed = true }
    }

    if (!changed) break

    const sums = Array.from({ length: K }, () => [0, 0, 0] as [number, number, number])
    for (let i = 0; i < N; i++) {
      sums[assignments[i]][0] += points[i][0]
      sums[assignments[i]][1] += points[i][1]
      sums[assignments[i]][2]++
    }
    for (let k = 0; k < K; k++) {
      if (sums[k][2] > 0) {
        centroids[k][0] = sums[k][0] / sums[k][2]
        centroids[k][1] = sums[k][1] / sums[k][2]
      }
    }
  }

  return Array.from(assignments)
}

export function clusterDriversDBSCAN(
  drivers: Driver[],
  targetSectorSize: number,
): number[] {
  const N = drivers.length
  if (N === 0) return []
  if (N <= targetSectorSize) return new Array(N).fill(0)

  const points = drivers.map(d => [d.depotLat, d.depotLng] as [number, number])
  const meanLat = points.reduce((s, p) => s + p[0], 0) / N
  const lngScale = Math.cos(meanLat * Math.PI / 180)

  const nnDists: number[] = []
  for (let i = 0; i < N; i++) {
    let minD = Infinity
    for (let j = 0; j < N; j++) {
      if (i === j) continue
      const dlat = points[i][0] - points[j][0]
      const dlng = (points[i][1] - points[j][1]) * lngScale
      const d = Math.sqrt(dlat * dlat + dlng * dlng)
      if (d < minD) minD = d
    }
    nnDists.push(minD)
  }
  nnDists.sort((a, b) => a - b)

  const eps = nnDists[Math.floor(N * 0.75)] * 2.5
  const minPts = Math.max(2, Math.floor(targetSectorSize * 0.3))

  const labels = new Int32Array(N).fill(-1)
  const NOISE = -2
  let clusterId = 0

  function regionQuery(idx: number): number[] {
    const neighbors: number[] = []
    for (let j = 0; j < N; j++) {
      if (j === idx) continue
      const dlat = points[idx][0] - points[j][0]
      const dlng = (points[idx][1] - points[j][1]) * lngScale
      if (Math.sqrt(dlat * dlat + dlng * dlng) <= eps) neighbors.push(j)
    }
    return neighbors
  }

  for (let i = 0; i < N; i++) {
    if (labels[i] !== -1) continue
    const neighbors = regionQuery(i)
    if (neighbors.length < minPts) {
      labels[i] = NOISE
      continue
    }
    labels[i] = clusterId
    const seed = [...neighbors]
    for (let si = 0; si < seed.length; si++) {
      const q = seed[si]
      if (labels[q] === NOISE) labels[q] = clusterId
      if (labels[q] !== -1) continue
      labels[q] = clusterId
      const qNeighbors = regionQuery(q)
      if (qNeighbors.length >= minPts) {
        for (const n of qNeighbors) { if (!seed.includes(n)) seed.push(n) }
      }
    }
    clusterId++
  }

  for (let i = 0; i < N; i++) {
    if (labels[i] >= 0) continue
    let bestK = 0, bestD = Infinity
    for (let j = 0; j < N; j++) {
      if (labels[j] < 0 || j === i) continue
      const dlat = points[i][0] - points[j][0]
      const dlng = (points[i][1] - points[j][1]) * lngScale
      const d = dlat * dlat + dlng * dlng
      if (d < bestD) { bestD = d; bestK = labels[j] }
    }
    labels[i] = bestK
  }

  const clusterSizes = new Map<number, number>()
  for (const l of labels) clusterSizes.set(l, (clusterSizes.get(l) ?? 0) + 1)

  for (const [cid, size] of clusterSizes) {
    if (size > targetSectorSize * 2) {

      const subIndices = Array.from(labels).map((l, i) => l === cid ? i : -1).filter(i => i >= 0)
      const subDrivers = subIndices.map(i => drivers[i])
      const subLabels = clusterDriversGeographically(subDrivers, targetSectorSize)
      const maxExisting = Math.max(...Array.from(labels)) + 1
      for (let si = 0; si < subIndices.length; si++) {
        labels[subIndices[si]] = maxExisting + subLabels[si]
      }
    }
  }

  const uniqueLabels = [...new Set(Array.from(labels))].sort((a, b) => a - b)
  const remap = new Map(uniqueLabels.map((l, i) => [l, i]))
  return Array.from(labels).map(l => remap.get(l) ?? 0)
}

const WEIGHT_GEO       = 1.0
const WEIGHT_TEMPORAL  = 0.3
const WEIGHT_EQUIPMENT = 0.2

const TEMPORAL_SCALE = 1.0 / 1440

const VOLUME_SCALE = 1.0 / 40

function missionTimeCenter(m: Mission): number {
  if (!m.timeWindow) return -1
  return (m.timeWindow.openMin + m.timeWindow.closeMin) / 2
}

export function assignMissionsToSectors(
  missions: Mission[],
  sectors: Sector[],
): void {
  if (sectors.length === 0 || missions.length === 0) return

  const centroids = sectors.map(s => {
    const n   = Math.max(1, s.drivers.length)
    const lat = s.drivers.reduce((sum, d) => sum + d.depotLat, 0) / n
    const lng = s.drivers.reduce((sum, d) => sum + d.depotLng, 0) / n

    return { lat, lng, timeCenter: -1 as number, avgVolume: -1 as number }
  })

  for (const s of sectors) s.missions = []

  for (const mission of missions) {
    let bestSector = 0
    let bestDist   = Infinity

    const mTime = missionTimeCenter(mission)
    const mVol  = mission.binSizeM3 ?? -1

    for (let si = 0; si < sectors.length; si++) {
      const c = centroids[si]

      const dlat = mission.latitude  - c.lat
      const dlng = mission.longitude - c.lng
      let dist = (dlat * dlat + dlng * dlng) * WEIGHT_GEO

      if (mTime >= 0 && c.timeCenter >= 0) {
        const dt = (mTime - c.timeCenter) * TEMPORAL_SCALE
        dist += dt * dt * WEIGHT_TEMPORAL
      }

      if (mVol >= 0 && c.avgVolume >= 0) {
        const dv = (mVol - c.avgVolume) * VOLUME_SCALE
        dist += dv * dv * WEIGHT_EQUIPMENT
      }

      if (dist < bestDist) {
        bestDist   = dist
        bestSector = si
      }
    }
    sectors[bestSector].missions.push(mission)
  }

  for (let si = 0; si < sectors.length; si++) {
    const sm = sectors[si].missions
    if (sm.length === 0) continue

    const withTW = sm.filter(m => m.timeWindow)
    if (withTW.length > 0) {
      centroids[si].timeCenter = withTW.reduce((s, m) => s + missionTimeCenter(m), 0) / withTW.length
    }

    const withVol = sm.filter(m => m.binSizeM3)
    if (withVol.length > 0) {
      centroids[si].avgVolume = withVol.reduce((s, m) => s + (m.binSizeM3 ?? 0), 0) / withVol.length
    }
  }
}

export function validateSectorTemporalFeasibility(
  sectors: Sector[],
  maxSpanHours: number = 6,
): Sector[] {
  const result: Sector[] = []

  for (const sector of sectors) {

    const tightMissions = sector.missions.filter(
      m => m.timeWindow && (m.timeWindow.closeMin - m.timeWindow.openMin) < 120
    )

    if (tightMissions.length < 5) {
      result.push(sector)
      continue
    }

    const minOpen = Math.min(...tightMissions.map(m => m.timeWindow!.openMin))
    const maxClose = Math.max(...tightMissions.map(m => m.timeWindow!.closeMin))
    const spanMin = maxClose - minOpen

    const tightPerDriver = tightMissions.length / Math.max(1, sector.drivers.length)

    if (spanMin > maxSpanHours * 60 && tightPerDriver > 8) {

      const midpoint = minOpen + spanMin / 2

      const halfDrivers = Math.ceil(sector.drivers.length / 2)
      const morningDrivers = sector.drivers.slice(0, halfDrivers)
      const afternoonDrivers = sector.drivers.slice(halfDrivers)

      if (morningDrivers.length === 0 || afternoonDrivers.length === 0) {
        result.push(sector)
        continue
      }

      const morningSector: Sector = {
        index: result.length,
        drivers: morningDrivers,
        missions: sector.missions.filter(m => {
          if (!m.timeWindow) return true
          return (m.timeWindow.openMin + m.timeWindow.closeMin) / 2 <= midpoint
        }),
      }

      const afternoonSector: Sector = {
        index: result.length + 1,
        drivers: afternoonDrivers,
        missions: sector.missions.filter(m => {
          if (!m.timeWindow) return false
          return (m.timeWindow.openMin + m.timeWindow.closeMin) / 2 > midpoint
        }),
      }

      result.push(morningSector, afternoonSector)
    } else {
      result.push(sector)
    }
  }

  result.forEach((s, i) => { s.index = i })
  return result
}

export function rebalanceSectors(sectors: Sector[], maxPasses = 10): void {
  if (sectors.length <= 1) return

  function sectorWorkload(s: Sector): number {
    const totalMin = s.missions.reduce((acc, m) =>
      acc + (m.estimatedDurationMin || 30) + (m.maneuverTimeMin || 0), 0)
    return totalMin / Math.max(1, s.drivers.length)
  }

  for (let pass = 0; pass < maxPasses; pass++) {

    const loads = sectors.map(sectorWorkload)
    const meanLoad = loads.reduce((a, b) => a + b, 0) / loads.length

    let rebalanced = false

    const centroids = sectors.map(s => ({
      lat: s.drivers.reduce((sum, d) => sum + d.depotLat, 0) / Math.max(1, s.drivers.length),
      lng: s.drivers.reduce((sum, d) => sum + d.depotLng, 0) / Math.max(1, s.drivers.length),
    }))

    for (let si = 0; si < sectors.length; si++) {
      if (loads[si] <= meanLoad * 1.15) continue

      const neighbors = sectors
        .map((_, sj) => ({
          sj,
          dist: cachedDist(centroids[si].lat, centroids[si].lng, centroids[sj].lat, centroids[sj].lng),
        }))
        .filter(({ sj }) => sj !== si && loads[sj] < meanLoad * 0.85)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)

      if (neighbors.length === 0) continue

      for (const { sj } of neighbors) {
        const target = sectors[sj]
        const source = sectors[si]

        const sourceDrivers = Math.max(1, source.drivers.length)
        const targetDrivers = Math.max(1, target.drivers.length)
        const targetTransfer = Math.floor(
          (loads[si] - meanLoad) * sourceDrivers / 2,
        )
        if (targetTransfer <= 0) continue

        const byProximity = [...source.missions]
          .map(m => ({
            m,
            dist: cachedDist(m.latitude, m.longitude, centroids[sj].lat, centroids[sj].lng),
          }))
          .sort((a, b) => a.dist - b.dist)

        let transferred = 0

        const toTransfer: Set<string> = new Set()
        const toTransferMissions: typeof byProximity = []
        const sourceTotalMin = source.missions.reduce((a, m) => a + (m.estimatedDurationMin || 30) + (m.maneuverTimeMin || 0), 0)
        const targetTotalMin = target.missions.reduce((a, m) => a + (m.estimatedDurationMin || 30) + (m.maneuverTimeMin || 0), 0)
        for (const { m } of byProximity) {
          if (transferred >= targetTransfer) break
          const mMin = (m.estimatedDurationMin || 30) + (m.maneuverTimeMin || 0)

          const newLoadSi = (sourceTotalMin - transferred * 30 - mMin) / sourceDrivers
          const newLoadSj = (targetTotalMin + transferred * 30 + mMin) / targetDrivers
          if (Math.abs(newLoadSi - meanLoad) + Math.abs(newLoadSj - meanLoad)
              < Math.abs(loads[si] - meanLoad) + Math.abs(loads[sj] - meanLoad)) {
            toTransfer.add(m.id)
            toTransferMissions.push({ m, dist: 0 })
            transferred++
            rebalanced = true
          }
        }
        if (toTransfer.size > 0) {

          source.missions = source.missions.filter(x => !toTransfer.has(x.id))
          for (const { m } of toTransferMissions) target.missions.push(m)
          loads[si] = source.missions.length / sourceDrivers
          loads[sj] = target.missions.length / targetDrivers
        }
      }
    }

    if (!rebalanced) break
  }
}

export function buildSectors(
  drivers: Driver[],
  missions: Mission[],
  targetSectorSize = 15,
): Sector[] {

  const sectorIds = drivers.length > 30
    ? clusterDriversDBSCAN(drivers, targetSectorSize)
    : clusterDriversGeographically(drivers, targetSectorSize)

  const nSectors  = Math.max(1, sectorIds.reduce((a, b) => Math.max(a, b), 0)) + 1

  const sectors: Sector[] = Array.from({ length: nSectors }, (_, i) => ({
    index:    i,
    drivers:  [],
    missions: [],
  }))

  for (let i = 0; i < drivers.length; i++) {
    sectors[sectorIds[i]].drivers.push(drivers[i])
  }

  const nonEmpty = sectors.filter(s => s.drivers.length > 0)

  nonEmpty.forEach((s, i) => { s.index = i })

  assignMissionsToSectors(missions, nonEmpty)
  const validated = validateSectorTemporalFeasibility(nonEmpty)

  return validated
}
