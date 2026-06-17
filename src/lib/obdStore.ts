export interface OBDReading {
  driverId:  string
  timestamp: number
  lat:       number
  lng:       number
  speedKmh:  number
  ignition:  boolean
}

export interface SpeedPoint {
  minuteOfDay: number
  speedKmh:    number
}

export interface DriverPosition {
  driverId:   string
  lat:        number
  lng:        number
  speedKmh:   number
  ignition:   boolean
  updatedAt:  number
}

const _positions = new Map<string, DriverPosition>()

const _speedHistory = new Map<string, SpeedPoint[]>()

const _minuteIndex = new Map<string, Map<number, number>>()

export function recordOBDReading(reading: OBDReading): void {
  const { driverId, timestamp, lat, lng, speedKmh, ignition } = reading

  _positions.set(driverId, { driverId, lat, lng, speedKmh, ignition, updatedAt: timestamp })

  const date = new Date(timestamp).toISOString().slice(0, 10)
  const key  = `${driverId}|${date}`

  const d      = new Date(timestamp)
  const minute = d.getHours() * 60 + d.getMinutes()

  const history = _speedHistory.get(key) ?? []
  let idxMap = _minuteIndex.get(key)
  if (!idxMap) {
    idxMap = new Map<number, number>()
    _minuteIndex.set(key, idxMap)
  }

  const existing = idxMap.get(minute)
  if (existing !== undefined) {
    history[existing] = { minuteOfDay: minute, speedKmh }
  } else {
    const newIdx = history.length
    history.push({ minuteOfDay: minute, speedKmh })
    idxMap.set(minute, newIdx)
  }
  _speedHistory.set(key, history)
}

export function getAllCurrentPositions(): DriverPosition[] {
  return Array.from(_positions.values())
}

export function getSpeedHistoryForDate(
  driverId: string,
  date: string,
): SpeedPoint[] {
  return (_speedHistory.get(`${driverId}|${date}`) ?? [])
    .slice()
    .sort((a, b) => a.minuteOfDay - b.minuteOfDay)
}

export function getAllSpeedHistories(date: string): Record<string, SpeedPoint[]> {
  const result: Record<string, SpeedPoint[]> = {}
  for (const [key, points] of _speedHistory.entries()) {
    const [kDriver, kDate] = key.split('|')
    if (kDate === date && kDriver) {
      result[kDriver] = [...points].sort((a, b) => a.minuteOfDay - b.minuteOfDay)
    }
  }
  return result
}

export function pruneOldOBDData(daysToKeep = 7): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysToKeep)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  for (const key of _speedHistory.keys()) {
    const date = key.split('|')[1]
    if (date && date < cutoffStr) {
      _speedHistory.delete(key)
      _minuteIndex.delete(key)
    }
  }

  const cutoffMs = cutoff.getTime()
  for (const [driverId, pos] of _positions.entries()) {
    if (pos.updatedAt < cutoffMs) _positions.delete(driverId)
  }
}
