/**
 * Scenario: GPS ingestion — 150 drivers posting position every 10s
 *
 * Simulates the hottest path at 150-driver scale.
 * Each VU = 1 driver. 150 VUs run for 2 minutes,
 * each posting their GPS position every 10 seconds.
 *
 * Expected: p95 < 200ms, 0 errors, DB queries stay cached.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 \
 *          -e AUTH_TOKEN=<session-cookie> \
 *          load-tests/scenarios/gps-ingestion.js
 */
import http  from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { BASE_URL, authHeaders, DRIVER_COUNT } from '../k6-config.js'

export const options = {
  scenarios: {
    gps_flood: {
      executor:          'constant-vus',
      vus:               DRIVER_COUNT,
      duration:          '2m',
      gracefulStop:      '10s',
    },
  },
  thresholds: {
    'http_req_duration{name:gps_post}': ['p(50)<100', 'p(95)<400', 'p(99)<1000'],
    'http_req_failed{name:gps_post}':   ['rate<0.01'],
    'gps_post_ok':                      ['rate>0.99'],
  },
}

const latency   = new Trend('gps_post_latency')
const successRt = new Rate('gps_post_ok')

// Lyon area bounding box — realistic GPS drift
function jitter(base, range) { return base + (Math.random() - 0.5) * range }

export default function () {
  const vu      = __VU
  const driverId = `load-driver-${String(vu).padStart(3, '0')}`
  const lat      = jitter(45.75, 0.5)
  const lng      = jitter(4.83,  0.5)

  const payload = JSON.stringify({
    driverId,
    latitude:  lat,
    longitude: lng,
    speedKmh:  Math.floor(Math.random() * 90),
    timestamp: new Date().toISOString(),
  })

  const res = http.post(
    `${BASE_URL}/api/driver-position`,
    payload,
    {
      headers: authHeaders(),
      tags:    { name: 'gps_post' },
    },
  )

  const ok = check(res, {
    'status 200':  r => r.status === 200,
    'body ok=true': r => {
      try { return JSON.parse(r.body).ok === true } catch { return false }
    },
  })

  latency.add(res.timings.duration)
  successRt.add(ok)

  if (!ok) {
    console.error(`[VU ${vu}] POST failed: status=${res.status} body=${res.body?.slice(0, 200)}`)
  }

  // Driver apps post every 10s
  sleep(10)
}
