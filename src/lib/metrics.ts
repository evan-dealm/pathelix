export interface MetricLabels {
  [key: string]: string | number | boolean
}

interface CounterEntry {
  value:  number
  labels: MetricLabels
}

interface HistogramBuckets {
  count:  number
  sum:    number
  min:    number
  max:    number
  labels: MetricLabels

  _reservoir: number[]
  _dirty: boolean
  _p50: number
  _p95: number
  _p99: number
}

const RESERVOIR_SIZE = 1024

class MetricsRegistry {
  private _counters   = new Map<string, CounterEntry>()
  private _histograms = new Map<string, HistogramBuckets>()

  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    const key = buildKey(name, labels)
    const existing = this._counters.get(key)
    if (existing) {
      existing.value += by
    } else {
      this._counters.set(key, { value: by, labels })
    }
  }

  getCounter(name: string, labels: MetricLabels = {}): number {
    return this._counters.get(buildKey(name, labels))?.value ?? 0
  }

  histogram(name: string, value: number, labels: MetricLabels = {}): void {
    if (!isFinite(value)) return
    const key = buildKey(name, labels)
    let h = this._histograms.get(key)

    if (!h) {
      h = {
        count: 0,
        sum:   0,
        min:   value,
        max:   value,
        labels,
        _reservoir: [],
        _dirty: true,
        _p50: 0,
        _p95: 0,
        _p99: 0,
      }
      this._histograms.set(key, h)
    }

    h.count++
    h.sum   += value
    h.min    = Math.min(h.min, value)
    h.max    = Math.max(h.max, value)

    if (h._reservoir.length < RESERVOIR_SIZE) {
      h._reservoir.push(value)
    } else {
      const j = Math.floor(Math.random() * h.count)
      if (j < RESERVOIR_SIZE) {
        h._reservoir[j] = value
      }
    }

    h._dirty = true
  }

  private _computePercentiles(h: HistogramBuckets): void {
    if (!h._dirty || h._reservoir.length === 0) return
    const sorted = [...h._reservoir].sort((a, b) => a - b)
    h._p50 = percentile(sorted, 0.50)
    h._p95 = percentile(sorted, 0.95)
    h._p99 = percentile(sorted, 0.99)
    h._dirty = false
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, CounterSnapshot>    = {}
    const histograms: Record<string, HistogramSnapshot> = {}

    for (const [key, c] of this._counters.entries()) {
      counters[key] = { value: c.value, labels: c.labels }
    }

    for (const [key, h] of this._histograms.entries()) {
      this._computePercentiles(h)
      histograms[key] = {
        count:  h.count,
        sum:    h.sum,
        min:    h.min,
        max:    h.max,
        avg:    h.count > 0 ? h.sum / h.count : 0,
        p50:    h._p50,
        p95:    h._p95,
        p99:    h._p99,
        labels: h.labels,
      }
    }

    return { counters, histograms, timestamp: new Date().toISOString() }
  }

  countersFor(prefix: string): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [key, c] of this._counters.entries()) {
      if (key.startsWith(prefix)) result[key] = c.value
    }
    return result
  }

  reset(): void {
    this._counters.clear()
    this._histograms.clear()
  }
}

export interface CounterSnapshot {
  value:  number
  labels: MetricLabels
}

export interface HistogramSnapshot {
  count:  number
  sum:    number
  min:    number
  max:    number
  avg:    number
  p50:    number
  p95:    number
  p99:    number
  labels: MetricLabels
}

export interface MetricsSnapshot {
  counters:   Record<string, CounterSnapshot>
  histograms: Record<string, HistogramSnapshot>
  timestamp:  string
}

function escapeLabel(s: string): string {
  return s.replace(/[,={}\\]/g, '_')
}

function buildKey(name: string, labels: MetricLabels): string {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return name
  const labelStr = keys.map(k => `${escapeLabel(k)}=${escapeLabel(String(labels[k] ?? ''))}`).join(',')
  return `${name}{${labelStr}}`
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)]
}

export const metrics = new MetricsRegistry()

export const METRIC = {

  API_REQUESTS:      'api.requests',
  API_LATENCY_MS:    'api.latency_ms',
  API_ERRORS:        'api.errors',

  VRP_ENQUEUED:      'vrp.jobs.enqueued',
  VRP_COMPLETED:     'vrp.jobs.completed',
  VRP_FAILED:        'vrp.jobs.failed',
  VRP_DURATION_MS:   'vrp.duration_ms',

  CB_OPEN:           'circuit_breaker.opened',
  CB_SUCCESS:        'circuit_breaker.success',
  CB_FAILURE:        'circuit_breaker.failure',

  AUTH_LOGIN_OK:     'auth.login.success',
  AUTH_LOGIN_FAIL:   'auth.login.failure',

  SSE_CONNECTIONS:   'sse.connections',
  REDIS_PUBLISH_FAIL:'redis.publish.failure',
} as const
