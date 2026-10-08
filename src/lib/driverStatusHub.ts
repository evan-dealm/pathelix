import { createLogger } from '@/lib/logger'
import { channelName } from '@/lib/driverStatusPubSub'
import type { StatusSnapshot } from '@/lib/driverStatusSnapshot'

const log = createLogger('driverStatusHub')

/**
 * Fan-out of live field progress to the dispatch screens of one server process.
 *
 * Every open screen used to hold its own Redis connection and, at each status change, to read
 * the day's snapshot from the database on its own: 50 screens of one organisation meant 50 Redis
 * connections and 50 identical queries per tap of a driver. Here:
 *  - one Redis subscriber for the whole process, whatever the number of screens;
 *  - one "topic" per (organisation, day): a change triggers ONE snapshot read, sent to every
 *    screen of the topic; reads of a topic never overlap and a burst of changes is folded into
 *    the read that follows it;
 *  - without Redis, or while it is down, each topic polls the database (one query per topic,
 *    not per screen), and everything is re-read when the connection comes back.
 *
 * The payload is always the full snapshot from the database: a lost message can delay an update,
 * never corrupt the screen.
 */

const POLL_MS = 5_000
/** Smallest gap between two reads of the same topic: ten taps in a second are one or two reads. */
const MIN_GAP_MS = 250

type Listener = (_json: string) => void

interface SubscriberLike {
  subscribe(_channel: string): Promise<unknown>
  unsubscribe(_channel: string): Promise<unknown>
  on(_event: string, _handler: (..._args: never[]) => void): unknown
  disconnect(): void
}

export interface StatusHubDeps {
  loadSnapshot: (_tenantId: string, _date: string) => Promise<StatusSnapshot>
  /** Returns a connected-on-demand Redis subscriber, or null when Redis is not configured. */
  createSubscriber: () => Promise<SubscriberLike | null>
  pollMs?: number
  minGapMs?: number
}

interface Topic {
  tenantId: string
  date: string
  channel: string
  listeners: Set<Listener>
  /** The Redis subscription of this topic's channel is in place. */
  subscribed: boolean
  /** A subscription attempt is in flight (the connection becoming ready must not start another). */
  attaching: boolean
  lastJson: string | null
  loading: Promise<void> | null
  dirty: boolean
  lastLoadAt: number
  pollTimer: ReturnType<typeof setInterval> | null
  gapTimer: ReturnType<typeof setTimeout> | null
}

export interface StatusHub {
  /**
   * Registers a screen. `onSnapshot` receives the current snapshot (JSON) first, then every
   * changed one. The returned function unregisters it; it is safe to call more than once.
   */
  subscribe(_tenantId: string, _date: string, _onSnapshot: Listener): Promise<() => void>
  stats(): { topics: number; listeners: number; redisSubscribed: boolean; polling: number }
  close(): void
}

export function createStatusHub(deps: StatusHubDeps): StatusHub {
  const pollMs = deps.pollMs ?? POLL_MS
  const minGapMs = deps.minGapMs ?? MIN_GAP_MS
  const topics = new Map<string, Topic>()
  let subscriber: SubscriberLike | null = null
  let subscriberPromise: Promise<SubscriberLike | null> | null = null
  /** The subscriber is connected and its subscriptions are live. */
  let live = false
  let closed = false

  function startPolling(topic: Topic): void {
    if (topic.pollTimer || closed) return
    topic.pollTimer = setInterval(() => refresh(topic), pollMs)
    topic.pollTimer.unref?.()
  }
  function stopPolling(topic: Topic): void {
    if (topic.pollTimer) clearInterval(topic.pollTimer)
    topic.pollTimer = null
  }

  function setLive(next: boolean): void {
    if (live === next) return
    live = next
    for (const topic of topics.values()) {
      if (!next) startPolling(topic)
      else if (topic.subscribed) {
        stopPolling(topic)
        refresh(topic)
      } // catch up with what was missed
      else if (!topic.attaching) void attach(topic) // its subscription failed while Redis was away
    }
  }

  /** One read at a time per topic; a change that arrives meanwhile triggers exactly one more. */
  function refresh(topic: Topic): void {
    if (closed || topic.listeners.size === 0) return
    if (topic.loading || topic.gapTimer) {
      topic.dirty = true
      return
    }
    const wait = topic.lastLoadAt + minGapMs - Date.now()
    if (wait > 0) {
      topic.gapTimer = setTimeout(() => {
        topic.gapTimer = null
        refresh(topic)
      }, wait)
      return
    }
    topic.dirty = false
    topic.loading = load(topic).finally(() => {
      topic.loading = null
      if (topic.dirty) refresh(topic)
    })
  }

  async function load(topic: Topic): Promise<void> {
    topic.lastLoadAt = Date.now()
    let json: string
    try {
      json = JSON.stringify(await deps.loadSnapshot(topic.tenantId, topic.date))
    } catch (err) {
      log.warn('Snapshot read failed', { err: err instanceof Error ? err.message : String(err) })
      return
    }
    if (json === topic.lastJson) return
    topic.lastJson = json
    for (const listener of [...topic.listeners]) {
      try {
        listener(json)
      } catch {
        /* a closed stream unregisters itself */
      }
    }
  }

  async function getSubscriber(): Promise<SubscriberLike | null> {
    if (subscriber) return subscriber
    if (!subscriberPromise) {
      subscriberPromise = deps
        .createSubscriber()
        .then(sub => {
          if (!sub) return null
          const byChannel = (channel: string) => {
            for (const topic of topics.values()) if (topic.channel === channel) return topic
            return null
          }
          sub.on('message', ((channel: string) => {
            const t = byChannel(channel)
            if (t) refresh(t)
          }) as never)
          // ioredis reconnects and re-subscribes on its own; meanwhile topics poll the database.
          sub.on('ready', (() => setLive(true)) as never)
          sub.on('error', (() => setLive(false)) as never)
          sub.on('close', (() => setLive(false)) as never)
          sub.on('end', (() => setLive(false)) as never)
          subscriber = sub
          return sub
        })
        .catch(err => {
          log.warn('Redis subscriber unavailable — live views poll the database', {
            err: err instanceof Error ? err.message : String(err),
          })
          subscriberPromise = null
          return null
        })
    }
    return subscriberPromise
  }

  async function attach(topic: Topic): Promise<void> {
    topic.attaching = true
    try {
      await attachOnce(topic)
    } finally {
      topic.attaching = false
    }
  }

  async function attachOnce(topic: Topic): Promise<void> {
    const sub = await getSubscriber()
    if (!sub) {
      startPolling(topic)
      return
    }
    try {
      await sub.subscribe(topic.channel)
      // A topic emptied while subscribing must not stay subscribed.
      if (topic.listeners.size === 0) {
        void sub.unsubscribe(topic.channel).catch(() => {})
        return
      }
      topic.subscribed = true
      setLive(true)
      stopPolling(topic)
      refresh(topic)
    } catch (err) {
      log.warn('Redis subscribe failed — polling the database for this view', {
        err: err instanceof Error ? err.message : String(err),
      })
      startPolling(topic)
    }
  }

  function detach(topic: Topic): void {
    stopPolling(topic)
    if (topic.gapTimer) clearTimeout(topic.gapTimer)
    topic.gapTimer = null
    topics.delete(`${topic.tenantId}|${topic.date}`)
    topic.subscribed = false
    if (subscriber) void subscriber.unsubscribe(topic.channel).catch(() => {})
  }

  return {
    async subscribe(tenantId, date, onSnapshot) {
      const key = `${tenantId}|${date}`
      let topic = topics.get(key)
      const created = !topic
      if (!topic) {
        topic = {
          tenantId,
          date,
          channel: channelName(tenantId, date),
          listeners: new Set(),
          subscribed: false,
          attaching: false,
          lastJson: null,
          loading: null,
          dirty: false,
          lastLoadAt: 0,
          pollTimer: null,
          gapTimer: null,
        }
        topics.set(key, topic)
      }
      const t = topic
      let active = true
      // The first frame goes to this screen only, even when the snapshot did not change.
      let gotFirst = false
      const listener: Listener = json => {
        gotFirst = true
        onSnapshot(json)
      }
      t.listeners.add(listener)
      const unsubscribe = () => {
        if (!active) return
        active = false
        t.listeners.delete(listener)
        if (t.listeners.size === 0) detach(t)
      }

      if (created) void attach(t)

      if (t.loading) await t.loading.catch(() => {})
      if (active && !gotFirst) {
        if (t.lastJson === null || Date.now() - t.lastLoadAt > minGapMs) {
          refresh(t)
          if (t.loading) await t.loading.catch(() => {})
        }
        if (active && !gotFirst && t.lastJson !== null) listener(t.lastJson)
      }
      return unsubscribe
    },

    stats() {
      let listeners = 0,
        polling = 0
      for (const t of topics.values()) {
        listeners += t.listeners.size
        if (t.pollTimer) polling++
      }
      return { topics: topics.size, listeners, redisSubscribed: live, polling }
    },

    close() {
      closed = true
      for (const t of [...topics.values()]) {
        t.listeners.clear()
        detach(t)
      }
      subscriber?.disconnect()
      subscriber = null
      subscriberPromise = null
      live = false
    },
  }
}

// One hub per process, shared by every route bundle.
const GLOBAL_KEY = '__pathelixDriverStatusHub'

export function getStatusHub(): StatusHub {
  const g = globalThis as unknown as Record<string, StatusHub | undefined>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createStatusHub({
      loadSnapshot: async (tenantId, date) =>
        (await import('@/lib/driverStatusSnapshot')).loadStatusSnapshot(tenantId, date),
      createSubscriber: async () => {
        const { REDIS_AVAILABLE } = await import('@/lib/redisClient')
        if (!REDIS_AVAILABLE) return null
        const { default: Redis } = await import('ioredis')
        const { redisBaseOptions } = await import('@/lib/queue/connection')
        const sub = new Redis({
          ...redisBaseOptions(),
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3_000,
          // Keep trying for ever: the hub polls the database while Redis is away.
          retryStrategy: (times: number) => Math.min(times * 500, 10_000),
        })
        return sub as unknown as SubscriberLike
      },
    })
  }
  return g[GLOBAL_KEY]!
}
