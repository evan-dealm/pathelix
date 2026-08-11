// ─── Service Worker — Pathélix PWA ─────────────────────────────────────────
// Offline-first pour chauffeurs en zone sans réseau.
//
// Stratégies :
//   Pages HTML     → Network-first, cache en fallback
//   Assets /_next/ → Cache-first (versionnés, immutables)
//   API            → Jamais caché (données toujours fraîches quand online)

const CACHE_NAME = 'pathelix-shell-v1'
const SHELL_URLS = ['/', '/driver']

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS))
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: network-first for API/pages, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never cache API calls
  if (url.pathname.startsWith('/api/')) return

  // Static assets: cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        return res
      }))
    )
    return
  }

  // Navigation: network-first, cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match('/')))
    )
  }
})

// Background sync: flush offline queue
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-offline-queue') {
    event.waitUntil(flushQueue())
  }
})

// Message from app: force sync
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FORCE_SYNC') {
    flushQueue()
  }
})

async function flushQueue() {
  // We need to use the raw IndexedDB API here since we can't import modules in SW
  const db = await openDB()
  const keys = await getAllKeys(db)
  const queueKeys = keys.filter(k => typeof k === 'string' && k.startsWith('sync-q:'))

  for (const key of queueKeys.sort()) {
    const action = await getItem(db, key)
    if (!action) continue
    if ((action.retryCount || 0) >= 5) {
      await deleteItem(db, key)
      continue
    }
    try {
      const res = await fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.body),
        credentials: 'same-origin',
      })
      if (res.ok || res.status === 422) {
        await deleteItem(db, key)
      } else if (res.status >= 500) {
        await putItem(db, key, { ...action, retryCount: (action.retryCount || 0) + 1 })
        break
      } else {
        // 4xx: rejet serveur — compter la tentative pour ne pas rejouer indéfiniment
        await putItem(db, key, { ...action, retryCount: (action.retryCount || 0) + 1 })
      }
    } catch {
      break // Still offline
    }
  }
}

// Raw IndexedDB helpers (can't use idb-keyval in SW)
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('keyval')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAllKeys(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', 'readonly')
    const req = tx.objectStore('keyval').getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getItem(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', 'readonly')
    const req = tx.objectStore('keyval').get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function putItem(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', 'readwrite')
    const req = tx.objectStore('keyval').put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function deleteItem(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', 'readwrite')
    const req = tx.objectStore('keyval').delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
