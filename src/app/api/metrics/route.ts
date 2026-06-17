import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { metrics }     from '@/lib/metrics'
import { getAllCircuitStates } from '@/lib/circuitBreaker'
import { loadShedder } from '@/lib/loadShedder'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

const METRICS_TOKEN = process.env.METRICS_TOKEN ?? ''

const START_TIME = Date.now()

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

function formatLabels(labels: Record<string, string | number | boolean>): string {
  const parts = Object.entries(labels).map(
    ([k, v]) => `${sanitizeName(k)}="${String(v).replace(/"/g, '\\"')}"`,
  )
  return parts.length > 0 ? `{${parts.join(',')}}` : ''
}

function parseMetricKey(key: string): { name: string; labels: Record<string, string> } {
  const braceIdx = key.indexOf('{')
  if (braceIdx === -1) return { name: key, labels: {} }

  const name      = key.slice(0, braceIdx)
  const labelStr  = key.slice(braceIdx + 1, -1)
  const labels: Record<string, string> = {}

  for (const part of labelStr.split(',')) {
    const [k, v] = part.split('=')
    if (k && v) labels[k] = v
  }

  return { name, labels }
}

function promCounter(key: string, value: number): string {
  const { name, labels } = parseMetricKey(key)
  const promName = sanitizeName(name) + '_total'
  return `${promName}${formatLabels(labels)} ${value}`
}

function promHistogram(key: string, h: { count: number; sum: number; p50: number; p95: number; p99: number }): string {
  const { name, labels } = parseMetricKey(key)
  const promName = sanitizeName(name)
  const lStr     = formatLabels(labels)

  return [
    `${promName}_count${lStr} ${h.count}`,
    `${promName}_sum${lStr} ${h.sum}`,
    `${promName}_p50${lStr} ${h.p50}`,
    `${promName}_p95${lStr} ${h.p95}`,
    `${promName}_p99${lStr} ${h.p99}`,
  ].join('\n')
}

export async function GET(req: NextRequest): Promise<Response> {

  if (METRICS_TOKEN) {

    const auth  = req.headers.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const maxLen   = Math.max(token.length, METRICS_TOKEN.length, 1)
    const a = Buffer.alloc(maxLen); a.write(token,         0, 'utf8')
    const b = Buffer.alloc(maxLen); b.write(METRICS_TOKEN, 0, 'utf8')
    if (!timingSafeEqual(a, b) || token.length !== METRICS_TOKEN.length) {
      return new Response('Unauthorized', { status: 401 })
    }
  } else {

    const sessionToken = req.cookies.get(SESSION_COOKIE)?.value ?? null
    const session = sessionToken ? await verifySession(sessionToken) : null
    if (!session) {
      return new Response('Unauthorized — METRICS_TOKEN not set, session required', { status: 401 })
    }
  }

  const snap    = metrics.snapshot()
  const lines: string[] = []

  lines.push('# HELP process_uptime_seconds Uptime du processus en secondes')
  lines.push('# TYPE process_uptime_seconds gauge')
  lines.push(`process_uptime_seconds ${Math.floor((Date.now() - START_TIME) / 1000)}`)
  lines.push('')

  lines.push('# HELP load_concurrent Requêtes concurrentes actuelles')
  lines.push('# TYPE load_concurrent gauge')
  lines.push(`load_concurrent ${loadShedder.concurrent}`)
  lines.push('')

  lines.push('# HELP circuit_breaker_state État du circuit breaker (0=CLOSED, 1=HALF_OPEN, 2=OPEN)')
  lines.push('# TYPE circuit_breaker_state gauge')
  const cbStates = getAllCircuitStates()
  const stateToInt: Record<string, number> = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 }
  for (const [name, state] of Object.entries(cbStates)) {
    lines.push(`circuit_breaker_state{name="${name}"} ${stateToInt[state] ?? 0}`)
  }
  lines.push('')

  if (Object.keys(snap.counters).length > 0) {
    lines.push('# HELP app_counter_total Compteurs applicatifs')
    lines.push('# TYPE app_counter_total counter')
    for (const [key, c] of Object.entries(snap.counters)) {
      lines.push(promCounter(key, c.value))
    }
    lines.push('')
  }

  for (const [key, h] of Object.entries(snap.histograms)) {
    const { name } = parseMetricKey(key)
    lines.push(`# HELP ${sanitizeName(name)} Histogramme ${name}`)
    lines.push(`# TYPE ${sanitizeName(name)} summary`)
    lines.push(promHistogram(key, h))
    lines.push('')
  }

  const body = lines.join('\n') + '\n'

  return new Response(body, {
    headers: {
      'Content-Type':  'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
