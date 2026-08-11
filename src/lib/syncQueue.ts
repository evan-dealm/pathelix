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

export async function flushSyncQueue(): Promise<number> {
  if (_flushInProgress) return 0
  _flushInProgress = true
  try {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.body),
      })
      if (res.ok || res.status === 422) {
        await del(action.id)
        synced++
      } else if (res.status >= 500) {
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
