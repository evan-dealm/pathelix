'use client'

import { useEffect } from 'react'

export function SWProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let reloading = false

    const handleControllerChange = () => {
      if (!reloading) {
        reloading = true
        window.location.reload()
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    let registration: ServiceWorkerRegistration | null = null
    const stateChangeListeners: Array<{ worker: ServiceWorker; handler: () => void }> = []

    const handleUpdateFound = () => {
      const newWorker = registration?.installing
      if (!newWorker) return
      const handleStateChange = () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' })
        }
      }
      newWorker.addEventListener('statechange', handleStateChange)
      stateChangeListeners.push({ worker: newWorker, handler: handleStateChange })
    }

    const handleOnline = async () => {
      try {
        const { flushSyncQueue } = await import('@/lib/syncQueue')
        await flushSyncQueue()
      } catch {  }
    }
    window.addEventListener('online', handleOnline)

    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        registration = reg

        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        reg.addEventListener('updatefound', handleUpdateFound)
      })
      .catch(() => {})

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      window.removeEventListener('online', handleOnline)
      registration?.removeEventListener('updatefound', handleUpdateFound)
      for (const { worker, handler } of stateChangeListeners) {
        worker.removeEventListener('statechange', handler)
      }
    }
  }, [])

  return <>{children}</>
}
