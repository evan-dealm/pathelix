'use client'

import { useEffect, useRef, useCallback } from 'react'

const GPS_QUEUE_PREFIX = 'gps-q:'

interface QueuedPosition {
  driverId: string
  latitude: number
  longitude: number
  speedKmh: number
  timestamp: string
}

const MAX_OFFLINE_POSITIONS = 500

async function storePositionOffline(pos: QueuedPosition): Promise<void> {
  try {
    const { set, keys } = await import('idb-keyval')
    const allKeys = await keys()
    const gpsKeys = allKeys.filter(k => typeof k === 'string' && (k as string).startsWith(GPS_QUEUE_PREFIX))
    if (gpsKeys.length >= MAX_OFFLINE_POSITIONS) return
    const id = `${GPS_QUEUE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await set(id, pos)
  } catch {

  }
}

async function flushOfflinePositions(): Promise<number> {
  try {
    const { keys, get, del } = await import('idb-keyval')
    const allKeys = await keys()
    const gpsKeys = (allKeys.filter(k => typeof k === 'string' && k.startsWith(GPS_QUEUE_PREFIX)) as string[]).sort()

    let sent = 0
    for (const key of gpsKeys) {
      const pos = await get<QueuedPosition>(key)
      if (!pos) { await del(key); continue }

      try {
        const res = await fetch('/api/driver-position', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pos),
          credentials: 'same-origin',
        })
        if (res.ok || res.status === 422) {
          await del(key)
          sent++
        }
        if (res.status >= 500) break
      } catch {
        break
      }
    }
    return sent
  } catch {
    return 0
  }
}

interface GpsTrackingOptions {

  driverId: string

  intervalMs?: number

  enabled?: boolean
}

export function useGpsTracking({ driverId, intervalMs = 30_000, enabled = true }: GpsTrackingOptions) {
  const lastSentRef = useRef(0)
  const positionRef = useRef<{ lat: number; lng: number; speed: number } | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const sendPosition = useCallback(async () => {
    const pos = positionRef.current
    if (!pos || !driverId) return

    const now = Date.now()
    if (now - lastSentRef.current < intervalMs) return
    lastSentRef.current = now

    const payload: QueuedPosition = {
      driverId,
      latitude: pos.lat,
      longitude: pos.lng,
      speedKmh: Math.max(0, Math.round((pos.speed || 0) * 3.6)),
      timestamp: new Date().toISOString(),
    }

    if (!navigator.onLine) {

      await storePositionOffline(payload)
      return
    }

    try {
      const res = await fetch('/api/driver-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      })
      if (!res.ok && res.status >= 500) {

        await storePositionOffline(payload)
      }
    } catch {

      await storePositionOffline(payload)
    }
  }, [driverId, intervalMs])

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('geolocation' in navigator)) return

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        positionRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed ?? 0,
        }
        sendPosition()
      },
      () => {

      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      },
    )

    const timer = setInterval(sendPosition, intervalMs)

    const handleOnline = () => {
      flushOfflinePositions()
    }
    window.addEventListener('online', handleOnline)

    if (navigator.onLine) {
      flushOfflinePositions()
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      clearInterval(timer)
      window.removeEventListener('online', handleOnline)
    }
  }, [enabled, sendPosition, intervalMs])
}
