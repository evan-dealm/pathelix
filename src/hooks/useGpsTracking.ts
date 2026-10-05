'use client'

import { useEffect, useRef, useCallback } from 'react'

const GPS_QUEUE_PREFIX = 'gps-q:'
const GPS_LOCK_NAME = 'pathelix-gps-queue'
const MAX_OFFLINE_POSITIONS = 500
const REQUEST_TIMEOUT_MS = 15_000

interface QueuedPosition {
  driverId: string
  latitude: number
  longitude: number
  speedKmh: number
  timestamp: string
}

/** Keys sort chronologically: zero-padded epoch ms. */
function positionKey(): string {
  return `${GPS_QUEUE_PREFIX}${String(Date.now()).padStart(15, '0')}-${Math.random().toString(36).slice(2, 6)}`
}

async function storePositionOffline(pos: QueuedPosition): Promise<void> {
  try {
    const { set, keys, del } = await import('idb-keyval')
    const gpsKeys = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(GPS_QUEUE_PREFIX)).sort()
    // Keep the most recent trail: drop the OLDEST points once the backlog is full.
    for (const old of gpsKeys.slice(0, Math.max(0, gpsKeys.length - MAX_OFFLINE_POSITIONS + 1))) await del(old)
    await set(positionKey(), pos)
  } catch {
    // IndexedDB unavailable — a lost GPS point is acceptable (the next one follows in 30s).
  }
}

function postPosition(pos: QueuedPosition): Promise<Response> {
  return fetch('/api/driver-position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pos),
    credentials: 'same-origin',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

async function doFlush(): Promise<void> {
  const { keys, get, del } = await import('idb-keyval')
  const gpsKeys = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(GPS_QUEUE_PREFIX)).sort()
  for (const key of gpsKeys) {
    const pos = await get<QueuedPosition>(key)
    if (!pos) { await del(key); continue }
    let res: Response
    try { res = await postPosition(pos) } catch { return } // still offline
    if (res.status === 401) return // session expired: keep the backlog for after re-login
    if (res.status >= 500 || res.status === 429) return
    await del(key) // delivered, or rejected for good (4xx): never retried forever
  }
}

/** One flusher at a time across tabs (Web Locks), so two tabs never send the same backlog twice. */
async function flushOfflinePositions(): Promise<void> {
  try {
    if (navigator.locks) {
      await navigator.locks.request(GPS_LOCK_NAME, { ifAvailable: true }, async lock => { if (lock) await doFlush() })
    } else {
      await doFlush()
    }
  } catch { /* retried on the next tick */ }
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
      const res = await postPosition(payload)
      if (res.status >= 500 || res.status === 429) await storePositionOffline(payload)
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
        void sendPosition()
      },
      () => { /* permission denied / unavailable: the app works without live position */ },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    )

    const timer = setInterval(() => {
      void sendPosition()
      if (navigator.onLine) void flushOfflinePositions()
    }, intervalMs)

    const handleOnline = () => { void flushOfflinePositions() }
    window.addEventListener('online', handleOnline)
    if (navigator.onLine) void flushOfflinePositions()

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      clearInterval(timer)
      window.removeEventListener('online', handleOnline)
    }
  }, [enabled, sendPosition, intervalMs])
}
