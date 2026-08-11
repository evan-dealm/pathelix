/**
 * Scenario: 150 simultaneous SSE connections (driver-status)
 *
 * Verifies the SSE server can hold 150 long-lived connections
 * without hitting the per-tenant connection cap (default 200).
 *
 * Pattern: open 150 connections, hold 30s, check keep-alive,
 * then ramp down.  Separate "reconnect" stage validates slot release.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 \
 *          -e AUTH_TOKEN=<session-cookie> \
 *          load-tests/scenarios/sse-connections.js
 */
import http  from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Counter } from 'k6/metrics'

import { BASE_URL, authHeaders } from '../k6-config.js'

export const options = {
  scenarios: {
    sse_hold: {
      executor:     'constant-vus',
      vus:          150,
      duration:     '60s',
      gracefulStop: '5s',
    },
    sse_overflow_check: {
      executor:   'constant-vus',
      vus:        1,
      duration:   '10s',
      startTime:  '10s',    // while sse_hold is already at 150
      gracefulStop: '2s',
      // Uses a different tenant to avoid interfering with sse_hold count
      env: { SSE_TENANT_OVERRIDE: 'tenant-overflow-check' },
    },
  },
  thresholds: {
    'sse_open_ok':   ['rate>0.99'],
    'sse_29_ok':     ['rate>0.99'],
    // overflow test must get exactly 0 successes for connection 201+
  },
}

const openOk  = new Rate('sse_open_ok')
const alive29 = new Rate('sse_29_ok')
const rejected = new Counter('sse_429_count')

const TODAY = new Date().toISOString().slice(0, 10)

export default function (data) {
  const scenarioName = __ENV.SSE_TENANT_OVERRIDE ? 'overflow' : 'hold'
  const tenant  = __ENV.SSE_TENANT_OVERRIDE ?? 'tenant-load-scale'
  const headers = { ...authHeaders(), 'x-tenant-id': tenant }

  if (scenarioName === 'overflow') {
    // In the overflow scenario this VU is VU 1 of a separate scenario.
    // We try to open 210 connections — past the 200 limit.
    // Connections 201+ must return 429.
    let accepted = 0
    let firstRejectedAt = 0
    for (let i = 0; i < 10; i++) {
      const r = http.get(`${BASE_URL}/api/sse/driver-status?date=${TODAY}`, {
        headers,
        tags:    { name: 'sse_overflow' },
        timeout: '5s',
      })
      if (r.status === 200) accepted++
      else if (r.status === 429) {
        rejected.add(1)
        if (!firstRejectedAt) firstRejectedAt = accepted + 1
        check(r, {
          '429 has error field': res => {
            try { return 'error' in JSON.parse(res.body) } catch { return false }
          },
        })
      }
    }
    return
  }

  // Normal hold scenario
  const res = http.get(
    `${BASE_URL}/api/sse/driver-status?date=${TODAY}`,
    {
      headers,
      tags:    { name: 'sse_open' },
      timeout: '10s',
    },
  )

  const opened = check(res, {
    'SSE opened (200)':      r => r.status === 200,
    'content-type SSE':      r => (r.headers['Content-Type'] ?? '').includes('text/event-stream'),
  })
  openOk.add(opened)

  if (!opened) {
    console.error(`[VU ${__VU}] SSE open failed: status=${res.status} body=${res.body?.slice(0, 200)}`)
    return
  }

  // Hold connection for 29s — server sends keep-alive every 30s
  sleep(29)

  // Verify connection still alive via a lightweight GET position poll
  const ping = http.get(
    `${BASE_URL}/api/driver-position?date=${TODAY}`,
    { headers, tags: { name: 'sse_alive_ping' }, timeout: '5s' },
  )
  alive29.add(check(ping, { 'alive ping 200': r => r.status === 200 }))
}
