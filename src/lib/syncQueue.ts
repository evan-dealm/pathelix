import { get, set, del, keys } from 'idb-keyval'

/**
 * Offline queue for driver actions (status, photo, signature, weighing ticket, incident,
 * comment). Every action is written to IndexedDB first, then delivered by `flushSyncQueue()` —
 * from the page, or from the Service Worker's background sync (public/sw.js mirrors the exact
 * same algorithm; keep both in step).
 *
 * Guarantees:
 * - exactly-once on the server: each action carries an Idempotency-Key generated once at
 *   enqueue time (src/lib/idempotency.ts claims it atomically);
 * - nothing is ever silently dropped: a network error / 5xx / timeout is retried with
 *   exponential backoff forever; a 401 (session expired) PAUSES the queue until the driver
 *   logs in again; any other rejection (4xx) moves the action to a visible "failed" state the
 *   driver can retry or discard;
 * - ordering: actions are delivered oldest first and a retryable failure blocks the ones
 *   behind it (head-of-line), so a later status never overtakes an earlier one;
 * - one flusher at a time across the page, other tabs and the Service Worker (Web Locks).
 */

const QUEUE_PREFIX = 'sync-q:'
const SYNC_LOCK_NAME = 'pathelix-offline-sync-queue'
const REQUEST_TIMEOUT_MS = 20_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 10 * 60_000

export type QueueMethod = 'POST' | 'DELETE'

export interface QueuedAction {
  id: string
  url: string
  method?: QueueMethod
  body: Record<string, unknown>
  timestamp: number
  retryCount: number
  /** Not retried before this time (ms epoch) — exponential backoff after a retryable failure. */
  nextAttemptAt?: number
  /** 'failed' = rejected by the server (4xx), kept for the driver to retry or discard. */
  state?: 'pending' | 'failed'
  lastStatus?: number
  lastError?: string
  /** Driver the action was recorded for — a different session never replays it. */
  ownerId?: string
  /** Short human label for the failed-actions list ("Statut : arrivé", "Photo"…). */
  label?: string
}

export interface FlushResult {
  synced: number
  pending: number
  failed: number
  /** The server answered 401: the session expired, the queue is paused until re-login. */
  authRequired: boolean
}

export interface QueueStatus {
  pending: number
  failed: QueuedAction[]
}

let _flushInProgress = false

function newActionId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `${QUEUE_PREFIX}${Date.now()}-${rand}`
}

export function backoffDelay(retryCount: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, retryCount - 1), BACKOFF_MAX_MS)
}

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pathelix:sync-queue'))
}

/**
 * Persists an action. Throws if IndexedDB is unavailable (private mode, quota…) — callers must
 * then fall back to sending it directly, see `sendNow()`.
 */
export async function enqueueAction(
  url: string,
  body: Record<string, unknown>,
  opts: { method?: QueueMethod; ownerId?: string; label?: string } = {},
): Promise<string> {
  const id = newActionId()
  const action: QueuedAction = {
    id, url, body, timestamp: Date.now(), retryCount: 0, state: 'pending',
    method: opts.method ?? 'POST', ownerId: opts.ownerId, label: opts.label,
  }
  await set(id, action)
  notify()

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'FORCE_SYNC' })
  }
  void requestBackgroundSync()
  return id
}

/**
 * Direct delivery when the queue itself can't be used (IndexedDB unavailable). Same
 * Idempotency-Key semantics, no persistence — the result tells the caller whether to warn.
 */
export async function sendNow(url: string, body: Record<string, unknown>, method: QueueMethod = 'POST'): Promise<boolean> {
  try {
    const res = await deliver({ id: newActionId(), url, body, method, timestamp: Date.now(), retryCount: 0 })
    return res.ok
  } catch {
    return false
  }
}

async function queueKeys(): Promise<string[]> {
  const all = await keys()
  return all.filter((k): k is string => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
  const actions: QueuedAction[] = []
  for (const key of await queueKeys()) {
    const action = await get<QueuedAction>(key)
    if (action) actions.push(action)
  }
  return actions.sort((a, b) => a.timestamp - b.timestamp)
}

export async function getSyncQueueSize(): Promise<number> {
  return (await getQueuedActions()).filter(a => a.state !== 'failed').length
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const actions = await getQueuedActions()
  return {
    pending: actions.filter(a => a.state !== 'failed').length,
    failed:  actions.filter(a => a.state === 'failed'),
  }
}

/** Puts a failed action back in the queue (driver tapped "Réessayer"). */
export async function retryFailedAction(id: string): Promise<void> {
  const action = await get<QueuedAction>(id)
  if (!action) return
  await set(id, { ...action, state: 'pending', retryCount: 0, nextAttemptAt: undefined, lastError: undefined, lastStatus: undefined })
  notify()
}

/** Drops a failed action for good (driver tapped "Abandonner"). */
export async function discardAction(id: string): Promise<void> {
  await del(id)
  notify()
}

function deliver(action: QueuedAction): Promise<Response> {
  const method = action.method ?? 'POST'
  const url = method === 'DELETE'
    ? `${action.url}?${new URLSearchParams(action.body as Record<string, string>).toString()}`
    : action.url
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      // Generated once at enqueue time, identical on every retry — the server replays the
      // stored answer for a duplicate delivery instead of running the action twice.
      'Idempotency-Key': action.id,
    },
    body: method === 'POST' ? JSON.stringify(action.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch { /* not JSON */ }
  return `Refusé par le serveur (${res.status})`
}

/**
 * Delivers every due action, oldest first. Serialized across tabs and the Service Worker by a
 * Web Lock. `ownerId`: only actions recorded for this driver (or unowned legacy ones) are sent.
 */
export async function flushSyncQueue(ownerId?: string): Promise<FlushResult> {
  if (_flushInProgress) return { synced: 0, ...(await countQueue()), authRequired: false }
  _flushInProgress = true
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(SYNC_LOCK_NAME, () => doFlush(ownerId))
    }
    return await doFlush(ownerId)
  } finally {
    _flushInProgress = false
    notify()
  }
}

async function countQueue(): Promise<{ pending: number; failed: number }> {
  const s = await getQueueStatus()
  return { pending: s.pending, failed: s.failed.length }
}

async function doFlush(ownerId?: string): Promise<FlushResult> {
  let synced = 0
  let authRequired = false
  const now = Date.now()

  for (const action of await getQueuedActions()) {
    if (action.state === 'failed') continue
    if (ownerId && action.ownerId && action.ownerId !== ownerId) continue
    if (action.nextAttemptAt && action.nextAttemptAt > now) break // head-of-line: keep order

    let res: Response
    try {
      res = await deliver(action)
    } catch {
      // Offline, timeout, DNS… — retry later, never drop.
      await set(action.id, { ...action, retryCount: action.retryCount + 1, nextAttemptAt: Date.now() + backoffDelay(action.retryCount + 1) })
      break
    }

    if (res.ok) {
      await del(action.id)
      synced++
      continue
    }
    if (res.status === 401) {
      authRequired = true
      break
    }
    if (res.status === 409 || res.status === 429 || res.status >= 500) {
      // 409 = the same action is still being processed server-side; 429/5xx = transient.
      await set(action.id, { ...action, retryCount: action.retryCount + 1, nextAttemptAt: Date.now() + backoffDelay(action.retryCount + 1), lastStatus: res.status })
      break
    }
    await set(action.id, { ...action, state: 'failed', lastStatus: res.status, lastError: await errorMessage(res) })
  }

  return { synced, ...(await countQueue()), authRequired }
}

export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    if ('sync' in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register: (_tag: string) => Promise<void> } }).sync.register('flush-offline-queue')
    }
  } catch {
    // Background Sync unsupported (Safari/Firefox): the page's own periodic flush covers it.
  }
}

const PLAN_CACHE_TTL_MS = 86_400_000

export async function cacheDayPlan(driverId: string, date: string, data: unknown): Promise<void> {
  await set(`plan:${driverId}:${date}`, { data, cachedAt: Date.now() })
}

export async function getCachedDayPlan(driverId: string, date: string): Promise<unknown | null> {
  const entry = await get<{ data: unknown; cachedAt: number }>(`plan:${driverId}:${date}`)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > PLAN_CACHE_TTL_MS) return null
  return entry.data
}

/**
 * Removes every trace of the driver's work from this device: cached plans, GPS backlog and —
 * unless `keepPending` — queued actions. Called at logout: on a shared tablet the next user
 * must neither see the previous driver's tour nor replay their actions.
 */
export async function clearDriverDeviceData(opts: { keepPending?: boolean } = {}): Promise<void> {
  const all = await keys()
  for (const k of all) {
    if (typeof k !== 'string') continue
    if (k.startsWith('plan:') || k.startsWith('gps-q:') || (!opts.keepPending && k.startsWith(QUEUE_PREFIX))) {
      await del(k)
    }
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('driver-status-')) localStorage.removeItem(k)
    }
  } catch { /* storage blocked */ }
  notify()
}
