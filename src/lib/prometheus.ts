import { createLogger } from '@/lib/logger'
import { getRedisClient } from '@/lib/redisClient'

const _log = createLogger('prometheus')

const REDIS_COUNTERS_KEY = 'prom:counters'
const FLUSH_INTERVAL_MS  = 60_000
let _flushTimer: ReturnType<typeof setInterval> | null = null

export async function initPrometheusFromRedis(): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) return
  try {
    const raw = await redis.hgetall(REDIS_COUNTERS_KEY)
    if (!raw) return
    for (const [key, val] of Object.entries(raw)) {
      const num = parseFloat(val)
      if (!isFinite(num)) continue
      const existing = _counters.get(key)
      if (existing) existing.value = num
      else _counters.set(key, { value: num, help: key })
    }
    _log.info('Prometheus counters restored from Redis', { keys: Object.keys(raw).length })
  } catch (err) {
    _log.warn('Failed to restore Prometheus counters', { err: String(err) })
  }
}

export async function flushPrometheusToRedis(): Promise<void> {
  if (_counters.size === 0) return
  const redis = await getRedisClient()
  if (!redis) return
  try {
    const entries: Record<string, string> = {}
    for (const [key, data] of _counters) {
      entries[key] = String(data.value)
    }
    await redis.hset(REDIS_COUNTERS_KEY, entries)
  } catch (err) {
    _log.warn('Failed to flush Prometheus counters', { err: String(err) })
  }
}

export function startPrometheusFlush(): void {
  if (_flushTimer) return
  _flushTimer = setInterval(() => { void flushPrometheusToRedis() }, FLUSH_INTERVAL_MS)
  if (typeof _flushTimer === 'object' && _flushTimer !== null && 'unref' in _flushTimer) {
    (_flushTimer as { unref(): void }).unref()
  }
}

interface HistogramBucket {
  le: number
  count: number
}

interface _Metric {
  name:    string
  help:    string
  type:    'counter' | 'gauge' | 'histogram'
  value?:  number
  labels?: Record<string, string>
  buckets?: HistogramBucket[]
}

const _counters = new Map<string, { value: number; help: string; labels?: Record<string, string> }>()
const _gauges   = new Map<string, { value: number; help: string }>()
const _histograms = new Map<string, { values: number[]; help: string; maxValues: number }>()

export function promIncrement(name: string, help: string, labels?: Record<string, string>, delta = 1): void {
  const key = labels ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` : name
  const existing = _counters.get(key)
  if (existing) {
    existing.value += delta
  } else {
    _counters.set(key, { value: delta, help, labels })
  }
}

export function promGauge(name: string, help: string, value: number): void {
  _gauges.set(name, { value, help })
}

export function promObserve(name: string, help: string, value: number): void {
  const existing = _histograms.get(name)
  if (existing) {
    existing.values.push(value)
    if (existing.values.length > existing.maxValues) {
      existing.values.shift()
    }
  } else {
    _histograms.set(name, { values: [value], help, maxValues: 1000 })
  }
}

export function promTimer(name: string, help: string): () => void {
  const start = performance.now()
  return () => promObserve(name, help, performance.now() - start)
}

const HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000]

export function generatePrometheusMetrics(): string {
  const lines: string[] = []

  const countersByName = new Map<string, Array<{ key: string; value: number; labels?: Record<string, string> }>>()
  for (const [key, data] of _counters) {
    const name = key.includes('{') ? key.slice(0, key.indexOf('{')) : key
    const list = countersByName.get(name) ?? []
    list.push({ key, value: data.value, labels: data.labels })
    countersByName.set(name, list)

    if (list.length === 1) {
      lines.push(`# HELP ${name} ${data.help}`)
      lines.push(`# TYPE ${name} counter`)
    }
  }
  for (const [, entries] of countersByName) {
    for (const e of entries) {
      lines.push(`${e.key} ${e.value}`)
    }
  }

  for (const [name, data] of _gauges) {
    lines.push(`# HELP ${name} ${data.help}`)
    lines.push(`# TYPE ${name} gauge`)
    lines.push(`${name} ${data.value}`)
  }

  for (const [name, data] of _histograms) {
    if (data.values.length === 0) continue
    lines.push(`# HELP ${name} ${data.help}`)
    lines.push(`# TYPE ${name} histogram`)

    const sorted = [...data.values].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    const count = sorted.length

    for (const le of HISTOGRAM_BUCKETS) {
      const bucketCount = sorted.filter(v => v <= le).length
      lines.push(`${name}_bucket{le="${le}"} ${bucketCount}`)
    }
    lines.push(`${name}_bucket{le="+Inf"} ${count}`)
    lines.push(`${name}_sum ${Math.round(sum * 100) / 100}`)
    lines.push(`${name}_count ${count}`)
  }

  return lines.join('\n') + '\n'
}

export const PROM = {

  vrpDurationMs:     (ms: number) => promObserve('pathelix_vrp_duration_ms', 'VRP optimization duration in milliseconds', ms),
  vrpMissions:       (n: number)  => promGauge('pathelix_vrp_missions_total', 'Number of missions in last VRP run', n),
  vrpDrivers:        (n: number)  => promGauge('pathelix_vrp_drivers_total', 'Number of drivers in last VRP run', n),
  vrpCost:           (c: number)  => promGauge('pathelix_vrp_cost', 'Cost of last VRP solution', c),

  apiRequest:    (route: string, status: number) => promIncrement('pathelix_api_requests_total', 'Total API requests', { route, status: String(status) }),
  apiLatencyMs:  (route: string, ms: number)     => promObserve('pathelix_api_latency_ms', 'API request latency in milliseconds', ms),
  apiError:      (route: string)                 => promIncrement('pathelix_api_errors_total', 'Total API errors', { route }),

  cacheHit:  (cache: string) => promIncrement('pathelix_cache_hits_total', 'Cache hits', { cache }),
  cacheMiss: (cache: string) => promIncrement('pathelix_cache_misses_total', 'Cache misses', { cache }),

  queueDepth: (n: number) => promGauge('pathelix_queue_depth', 'BullMQ queue depth', n),
  queueJobMs: (ms: number) => promObserve('pathelix_queue_job_duration_ms', 'Queue job processing time in ms', ms),

  gpsPositions:  (n: number) => promGauge('pathelix_gps_positions_active', 'Number of active GPS positions', n),
  trafficEvents: (n: number) => promGauge('pathelix_traffic_events', 'Number of active traffic events', n),

  sseConnections: (n: number) => promGauge('pathelix_sse_connections', 'Active SSE connections', n),

  mlMetricsCollected: () => promIncrement('pathelix_ml_metrics_collected_total', 'ML intervention metrics collected'),
  mlCoefficientsApplied: () => promIncrement('pathelix_ml_coefficients_applied_total', 'ML coefficients applied to VRP'),

  activeTenants: (n: number) => promGauge('pathelix_active_tenants', 'Number of active tenants', n),
}
