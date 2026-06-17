import type { CostContext } from './types'
import { cachedDist } from './distanceCache'

const _weekdayTraffic = new Float32Array(1440)
const _saturdayTraffic = new Float32Array(1440)
;(() => {
  for (let m = 0; m < 1440; m++) {
    _weekdayTraffic[m] = _computeTrafficFactor(m)
    _saturdayTraffic[m] = 0.85
  }
})()

function _computeTrafficFactor(m: number): number {

  if (m >= 1320 || m < 300) return 0.90
  if (m >= 300 && m < 420)  return 0.90 + ((m - 300) / 120) * 0.05
  if (m >= 420 && m < 480)  return 0.95 + ((m - 420) / 60)  * 0.10
  if (m >= 480 && m < 510)  return 1.05 + ((m - 480) / 30)  * 0.05
  if (m >= 510 && m < 600)  return 1.10 - ((m - 510) / 90)  * 0.10
  if (m >= 600 && m < 720)  return 1.00
  if (m >= 720 && m < 810)  return 1.00 + Math.sin(((m - 720) / 90) * Math.PI) * 0.03
  if (m >= 810 && m < 960)  return 1.00
  if (m >= 960 && m < 1050) return 1.00 + ((m - 960)  / 90)  * 0.08
  if (m >= 1050 && m < 1110) return 1.08
  if (m >= 1110 && m < 1200) return 1.08 - ((m - 1110) / 90) * 0.08
  if (m >= 1200 && m < 1320) return 1.00 - ((m - 1200) / 120) * 0.10
  return 1.00
}

function getTrafficFactor(minuteOfDay: number, dow: number): number {
  const clamped = Math.max(0, Math.min(1439, Math.floor(minuteOfDay)))
  if (dow === 0) return 0.75
  if (dow === 6) return _saturdayTraffic[clamped]
  return _weekdayTraffic[clamped]
}

let _cachedDateStr = ''
let _cachedDow = 1

function getDow(dateStr: string): number {
  if (dateStr === _cachedDateStr) return _cachedDow
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    _cachedDow = 1
  } else {
    _cachedDow = new Date(parts[0], parts[1] - 1, parts[2]).getDay()
  }
  _cachedDateStr = dateStr
  return _cachedDow
}

export function realDistanceKm(
  ctx: CostContext,
  fromId: string | undefined,
  fromLat: number,
  fromLng: number,
  toId: string | undefined,
  toLat: number,
  toLng: number,
): number {
  if (fromLat === toLat && fromLng === toLng) return 0

  if (ctx.osrmMatrix && fromId && toId) {
    const i = ctx.osrmMatrix.indexOf(fromId)
    const j = ctx.osrmMatrix.indexOf(toId)
    if (i >= 0 && j >= 0) {
      const d = ctx.osrmMatrix.distance(i, j)
      if (d > 0) return d
    }
  }

  return cachedDist(fromLat, fromLng, toLat, toLng)
}

export function realDurationMin(
  ctx: CostContext,
  fromId: string | undefined,
  fromLat: number,
  fromLng: number,
  toId: string | undefined,
  toLat: number,
  toLng: number,
  departureMin: number,
): number {
  if (fromLat === toLat && fromLng === toLng) return 0

  const traffic = getTrafficFactor(departureMin, getDow(ctx.date))

  if (ctx.osrmMatrix && fromId && toId) {
    const i = ctx.osrmMatrix.indexOf(fromId)
    const j = ctx.osrmMatrix.indexOf(toId)
    if (i >= 0 && j >= 0) {
      const durMin = ctx.osrmMatrix.duration(i, j)
      if (durMin > 0) {

        const vf = ctx.valhallaFactor ?? 1.0
        return Math.round(durMin * traffic * vf * 10) / 10
      }
    }
  }

  const distKm = cachedDist(fromLat, fromLng, toLat, toLng)
  const safeSpeed = Math.max(10, ctx.speedKmh)
  const baseMin = (distKm / safeSpeed) * 60
  return Math.round(baseMin * traffic * 10) / 10
}
