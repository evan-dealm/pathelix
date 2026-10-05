'use client'

import { useEffect } from 'react'

/**
 * Registers the Service Worker (public/sw.js). A new worker activates immediately
 * (skipWaiting + clients.claim) but the page is NOT reloaded: assets are content-hashed, so the
 * running page keeps working and picks up the new version on its next navigation — a forced
 * reload used to wipe a driver's photo or signature in progress.
 */
export function SWProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handleOnline = async () => {
      try {
        const { flushSyncQueue } = await import('@/lib/syncQueue')
        await flushSyncQueue()
      } catch { /* the driver page retries on its own schedule */ }
    }
    window.addEventListener('online', handleOnline)

    navigator.serviceWorker.register('/sw.js').catch(() => { /* unsupported / blocked */ })

    return () => window.removeEventListener('online', handleOnline)
  }, [])

  return <>{children}</>
}
