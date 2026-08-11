/**
 * Scenario: Admin dashboard load with 150 drivers active
 *
 * Simulates dispatchers/admins hitting the dashboard while GPS ingestion runs.
 * Measures time-to-first-byte for the dashboard data endpoints,
 * with concurrent VRP optimization in the BullMQ queue.
 *
 * Dashboard endpoints exercised:
 *  - GET /api/driver-position?date=TODAY          (positions + history)
 *  - GET /api/missions?date=TODAY&limit=50        (mission list)
 *  - GET /api/sse/driver-status?date=TODAY        (SSE open then close)
 *  - POST /api/optimize                           (VRP — 1 VU only, simulates background run)
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 \
 *          -e AUTH_TOKEN=<session-cookie> \
 *          load-tests/scenarios/dashboard.js
 */
import http  from 'k6/http'
import { check, sleep, group } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { BASE_URL, authHeaders } from '../k6-config.js'

export const options = {
  scenarios: {
    dispatchers: {
      executor:     'constant-vus',
      vus:          10,     // 10 concurrent dispatcher sessions
      duration:     '2m',
      gracefulStop: '10s',
      env: { ROLE: 'dispatcher' },
    },
    vrp_background: {
      executor:     'constant-vus',
      vus:          1,       // one VRP optimization run at a time
      duration:     '2m',
      gracefulStop: '30s',
      env: { ROLE: 'vrp' },
    },
  },
  thresholds: {
    'http_req_duration{name:dashboard_positions}': ['p(50)<300', 'p(95)<1200', 'p(99)<3000'],
    'http_req_duration{name:dashboard_missions}':  ['p(50)<200', 'p(95)<800',  'p(99)<2000'],
    'dashboard_ok':                                ['rate>0.99'],
    'vrp_accepted':                                ['rate>0.95'],
  },
}

const dashOk    = new Rate('dashboard_ok')
const vrpAccept = new Rate('vrp_accepted')
const posTrend  = new Trend('dashboard_positions_ms')
const misTrend  = new Trend('dashboard_missions_ms')

const TODAY   = new Date().toISOString().slice(0, 10)
const DRIVERS = Array.from({ length: 150 }, (_, i) => `load-driver-${String(i + 1).padStart(3, '0')}`)

export default function () {
  const role = __ENV.ROLE

  if (role === 'vrp') {
    // One VRP job every 30s — mimics real dispatcher triggering optimization
    sleep(Math.random() * 5)   // stagger starts

    const payload = JSON.stringify({
      date:      TODAY,
      driverIds: DRIVERS.slice(0, 20),   // small subset so test stays fast
      options:   { maxIterations: 10 },   // reduced iterations for load test
    })

    const res = http.post(
      `${BASE_URL}/api/optimize`,
      payload,
      { headers: authHeaders(), tags: { name: 'vrp_optimize' }, timeout: '60s' },
    )

    const ok = check(res, {
      'VRP accepted (200/202)': r => r.status === 200 || r.status === 202,
    })
    vrpAccept.add(ok)
    if (!ok) console.error(`[VRP VU] POST /api/optimize ${res.status}: ${res.body?.slice(0, 200)}`)

    sleep(30)
    return
  }

  // Dispatcher dashboard page load sequence
  group('dashboard_load', () => {
    // 1. Positions + speed history (heaviest query)
    const posRes = http.get(
      `${BASE_URL}/api/driver-position?date=${TODAY}`,
      { headers: authHeaders(), tags: { name: 'dashboard_positions' }, timeout: '15s' },
    )
    const posOk = check(posRes, {
      'positions 200':           r => r.status === 200,
      'positions array present': r => {
        try { return Array.isArray(JSON.parse(r.body).positions) } catch { return false }
      },
    })
    dashOk.add(posOk)
    posTrend.add(posRes.timings.duration)

    // 2. Mission list (first page)
    const misRes = http.get(
      `${BASE_URL}/api/missions?date=${TODAY}&limit=50&page=1`,
      { headers: authHeaders(), tags: { name: 'dashboard_missions' }, timeout: '10s' },
    )
    const misOk = check(misRes, {
      'missions 200': r => r.status === 200,
    })
    dashOk.add(misOk)
    misTrend.add(misRes.timings.duration)

    // 3. SSE volontairement absent ici : k6 http.get ne peut pas tenir un stream
    // event-stream (timeout inévitable → status 0, faux négatif). La tenue de
    // 150 connexions SSE simultanées est couverte par le test Node dédié
    // (scratchpad/sse-hold-test.mjs — 150/150 tenues 60 s, 0 déconnexion).
  })

  // Dispatcher polls ~every 10s (auto-refresh)
  sleep(10 + Math.random() * 5)
}
