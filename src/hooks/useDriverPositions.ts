'use client'

import { useState, useEffect, useCallback } from 'react'

export interface DriverPosition {
  driverId:  string
  lat:       number
  lng:       number
  speedKmh:  number
  ignition:  boolean
  updatedAt: number
}

export function useDriverPositions(date: string, intervalMs: number = 15_000) {
  const [positions, setPositions] = useState<DriverPosition[]>([])

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch(`/api/driver-position?date=${date}`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.positions)) {
        setPositions(data.positions)
      }
    } catch {

    }
  }, [date])

  useEffect(() => {
    fetchPositions()
    const timer = setInterval(fetchPositions, intervalMs)
    return () => clearInterval(timer)
  }, [fetchPositions, intervalMs])

  return positions
}
