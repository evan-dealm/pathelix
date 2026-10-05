// ─── Service Worker — Pathélix PWA ─────────────────────────────────────────
// Offline-first for drivers working without network.
//
//   Driver pages (/driver/*) → network-first, last good copy served offline
//   Static assets /_next/    → cache-first (content-hashed, immutable)
//   API                      → never cached (always fresh data, nothing user-specific stored)
//
// The background flush below MIRRORS src/lib/syncQueue.ts (same IndexedDB store, same lock,
// same retry/backoff/failed semantics). Any change to one must be made to the other.

const CACHE_NAME = 'pathelix-shell-v2'
const SYNC_LOCK_NAME = 'pathelix-offline-sync-queue'
const QUEUE_PREFIX = 'sync-q:'
const REQUEST_TIMEOUT_MS = 20000
const BACKOFF_BASE_MS = 5000
const BACKOFF_MAX_MS = 10 * 60000

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
        }
        return res
      })),
    )
    return
  }

  // Only the driver app works offline: its HTML shell carries no data (the tour is fetched
  // from the API and kept in IndexedDB), so caching it is safe. A redirect (e.g. to /login when
  // the session expired) is never stored as the page.
  if (request.mode === 'navigate' && url.pathname.startsWith('/driver/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok && !res.redirected) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request).then(r => r || offlineResponse())),
    )
  }
})

function offlineResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>Hors ligne</title><body style="font-family:system-ui;background:#09090b;color:#e4e4e7;' +
    'display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1>Hors ligne</h1>' +
    '<p>Ouvrez la tournée une première fois avec du réseau pour pouvoir l\'utiliser hors connexion.</p></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-offline-queue') {
    // Rejecting tells the browser to retry the sync later — only resolve once nothing is left
    // that could still be delivered (failed/paused actions wait for the driver).
    event.waitUntil(flushQueue().then(result => {
      if (result.retryLater) throw new Error('Offline queue not fully delivered')
    }))
  }
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'FORCE_SYNC') {
    event.waitUntil(flushQueue())
  } else if (type === 'CLEAR_CACHES') {
    event.waitUntil(caches.delete(CACHE_NAME))
  }
})

function flushQueue() {
  const run = () => doFlush().then(async result => {
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) client.postMessage({ type: 'SYNC_COMPLETE', synced: result.synced, authRequired: result.authRequired })
    return result
  })
  if (self.navigator && self.navigator.locks) {
    return self.navigator.locks.request(SYNC_LOCK_NAME, run)
  }
  return run()
}

function backoffDelay(retryCount) {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, Math.max(0, retryCount - 1)), BACKOFF_MAX_MS)
}

function deliver(action) {
  const method = action.method || 'POST'
  const url = method === 'DELETE'
    ? action.url + '?' + new URLSearchParams(action.body).toString()
    : action.url
  const headers = { 'Idempotency-Key': action.id }
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body: method === 'POST' ? JSON.stringify(action.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

async function errorMessage(res) {
  try {
    const body = await res.json()
    if (body && typeof body.error === 'string') return body.error
  } catch (_) { /* not JSON */ }
  return 'Refusé par le serveur (' + res.status + ')'
}

async function doFlush() {
  const db = await openDB()
  const keys = (await getAllKeys(db)).filter(k => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const actions = []
  for (const key of keys) {
    const action = await getItem(db, key)
    if (action) actions.push(Object.assign({ id: key }, action))
  }
  actions.sort((a, b) => a.timestamp - b.timestamp)

  const now = Date.now()
  let synced = 0
  let retryLater = false
  let authRequired = false

  for (const action of actions) {
    if (action.state === 'failed') continue
    if (action.nextAttemptAt && action.nextAttemptAt > now) { retryLater = true; break }

    let res
    try {
      res = await deliver(action)
    } catch (_) {
      await putItem(db, action.id, Object.assign({}, action, { retryCount: (action.retryCount || 0) + 1, nextAttemptAt: Date.now() + backoffDelay((action.retryCount || 0) + 1) }))
      retryLater = true
      break
    }

    if (res.ok) {
      await deleteItem(db, action.id)
      synced++
      continue
    }
    if (res.status === 401) { authRequired = true; break }
    if (res.status === 409 || res.status === 429 || res.status >= 500) {
      await putItem(db, action.id, Object.assign({}, action, { retryCount: (action.retryCount || 0) + 1, nextAttemptAt: Date.now() + backoffDelay((action.retryCount || 0) + 1), lastStatus: res.status }))
      retryLater = true
      break
    }
    await putItem(db, action.id, Object.assign({}, action, { state: 'failed', lastStatus: res.status, lastError: await errorMessage(res) }))
  }

  return { synced, retryLater, authRequired }
}

// Raw IndexedDB helpers — same database/store names as idb-keyval's defaults.
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
    const req = db.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getItem(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('keyval', 'readonly').objectStore('keyval').get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function putItem(db, key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('keyval', 'readwrite').objectStore('keyval').put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function deleteItem(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('keyval', 'readwrite').objectStore('keyval').delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
