import { get, set, del, keys } from 'idb-keyval'

const QUEUE_PREFIX = 'sync-q:'

const MAX_RETRIES = 5

let _flushInProgress = false

export interface QueuedAction {
  id: string
  url: string
  body: Record<string, unknown>
  timestamp: number
  retryCount: number
}

export async function enqueueAction(url: string, body: Record<string, unknown>): Promise<void> {
  const id = `${QUEUE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const action: QueuedAction = { id, url, body, timestamp: Date.now(), retryCount: 0 }
  await set(id, action)

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'FORCE_SYNC' })
  }

  void requestBackgroundSync()
}

export async function getSyncQueueSize(): Promise<number> {
  const allKeys = await keys()
  return allKeys.filter(k => typeof k === 'string' && k.startsWith(QUEUE_PREFIX)).length
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
  const allKeys = await keys()
  const queueKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(QUEUE_PREFIX)) as string[]
  const actions: QueuedAction[] = []
  for (const key of queueKeys) {
    const action = await get<QueuedAction>(key)
    if (action) actions.push(action)
  }
  return actions.sort((a, b) => a.timestamp - b.timestamp)
}

// The Service Worker (public/sw.js) runs its OWN independent flush loop against this exact same
// IndexedDB queue (background 'sync' event, or the page's own FORCE_SYNC message) — two
// concurrent flushers reading the same un-yet-deleted action and both POSTing it is a real race
// (N23: a driver action could be sent twice). The Web Locks API is the fix: `navigator.locks` is
// shared across every same-origin context including Service Workers, so a single named lock
// naturally serializes the page's flush against the SW's flush, whichever asks first blocks the
// other until it's done deleting what it sent. `_flushInProgress` alone only guarded against two
// calls *within the same context* (e.g. FORCE_SYNC firing while a flush was already running on
// the page) — kept as a fast local short-circuit, the lock is what actually closes the
// cross-context race.
const SYNC_LOCK_NAME = 'pathelix-offline-sync-queue'

export async function flushSyncQueue(): Promise<number> {
  if (_flushInProgress) return 0
  _flushInProgress = true
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(SYNC_LOCK_NAME, () => _doFlush())
    }
    // No Web Locks support (very old browser) — best effort, same as before this fix.
    return await _doFlush()
  } finally {
    _flushInProgress = false
  }
}

async function _doFlush(): Promise<number> {
  const actions = await getQueuedActions()
  let synced = 0

  for (const action of actions) {
    if (action.retryCount >= MAX_RETRIES) {
      await del(action.id)
      continue
    }
    try {
      const res = await fetch(action.url, {
        method: 'POST',
        // action.id already uniquely identifies this one queued action (generated once at
        // enqueue time, never regenerated on retry) — reused as-is as the idempotency key so a
        // replay (double network send, or a race the Web Locks coordination above didn't fully
        // close) is recognized server-side and its stored response is replayed instead of the
        // action being reprocessed. See src/lib/idempotency.ts.
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action.id },
        body: JSON.stringify(action.body),
      })
      if (res.ok || res.status === 422) {
        await del(action.id)
        synced++
      } else if (res.status >= 500) {
        // Intentional head-of-line blocking — `break`, not `continue`. Actions are ordered
        // (timestamp-sorted by getQueuedActions()) and a 5xx here usually means the server
        // itself is down/degraded, not that this one action is bad. Retrying later actions in
        // the same cycle would just spam an already-struggling server for no benefit. This is a
        // deliberate design choice, not a bug — do not "fix" it into a `continue`.
        await set(action.id, { ...action, retryCount: action.retryCount + 1 })
        break
      } else {
        // 4xx (hors 422): rejet côté serveur — compte la tentative pour éviter
        // qu'une action refusée (400, 401 session expirée…) reste en file indéfiniment,
        // sans bloquer les actions suivantes
        await set(action.id, { ...action, retryCount: action.retryCount + 1 })
      }
    } catch {
      // Erreur réseau générique (pas de réponse serveur) : ne compte pas comme une
      // tentative — sinon un chauffeur en zone blanche prolongée perd silencieusement
      // son action après MAX_RETRIES ouvertures d'app sans jamais avoir été rejeté par
      // le serveur. Cohérent avec sw.js (event 'sync' en arrière-plan).
      break
    }
  }

  return synced
}

export async function requestBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    if ('sync' in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register: (_tag: string) => Promise<void> } }).sync.register('flush-offline-queue')
    }
  } catch {

  }
}

export async function cacheDayPlan(driverId: string, date: string, data: unknown): Promise<void> {
  await set(`plan:${driverId}:${date}`, { data, cachedAt: Date.now() })
}

export async function getCachedDayPlan(driverId: string, date: string): Promise<unknown | null> {
  const entry = await get<{ data: unknown; cachedAt: number }>(`plan:${driverId}:${date}`)
  if (!entry) return null

  if (Date.now() - entry.cachedAt > 86_400_000) return null
  return entry.data
}
