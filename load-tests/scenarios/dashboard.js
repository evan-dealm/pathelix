/**
 * Scenario: the dispatchers' screens while the fleet is on the road.
 *
 * - `dispatchers`: each one keeps the planning open — live map (positions every 15 s, without
 *   the speed history, exactly what the map asks) and the day's missions.
 * - `telematics`: two of them watch the telematics tab (positions + the day's speed history of
 *   the whole fleet, every 30 s) — the heaviest read of the application.
 * - `vrp`: an optimisation of 20 drivers launched every 30 s.
 *
 * Run it while gps-ingestion is running (or right after) so that there are positions to read.
 * Server-sent events are not covered: k6's http client cannot hold a stream open.
 *
 *   k6 run -e BASE_URL=http://localhost:3000 load-tests/scenarios/dashboard.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'
import { BASE_URL, adminHeaders, dispatcherHeaders, driverIds, today } from '../k6-config.js'

const DURATION = __ENV.DURATION || '2m'

export const options = {
  scenarios: {
    dispatchers: {
      executor: 'constant-vus',
      vus: 10,
      duration: DURATION,
      gracefulStop: '10s',
      env: { ROLE: 'dispatcher' },
    },
    telematics: {
      executor: 'constant-vus',
      vus: 2,
      duration: DURATION,
      gracefulStop: '10s',
      env: { ROLE: 'telematics' },
    },
    vrp: {
      executor: 'constant-vus',
      vus: 1,
      duration: DURATION,
      gracefulStop: '60s',
      env: { ROLE: 'vrp' },
    },
  },
  thresholds: {
    'http_req_duration{name:map_positions}': ['p(50)<150', 'p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:missions_list}': ['p(50)<200', 'p(95)<800', 'p(99)<2000'],
    'http_req_duration{name:telematics_history}': ['p(50)<800', 'p(95)<2500', 'p(99)<5000'],
    dashboard_ok: ['rate>0.99'],
    vrp_accepted: ['rate>0.95'],
  },
}

const dashOk = new Rate('dashboard_ok')
const vrpAccepted = new Rate('vrp_accepted')
const TODAY = today()

export default function () {
  const role = __ENV.ROLE

  if (role === 'vrp') {
    const res = http.post(
      `${BASE_URL}/api/optimize`,
      JSON.stringify({ date: TODAY, driverIds: driverIds(20) }),
      { headers: adminHeaders(), tags: { name: 'vrp_optimize' }, timeout: '90s' },
    )
    const ok = check(res, {
      'optimisation accepted (200/202)': r => r.status === 200 || r.status === 202,
    })
    vrpAccepted.add(ok)
    if (!ok)
      console.error(`[vrp] POST /api/optimize ${res.status}: ${String(res.body).slice(0, 200)}`)
    sleep(30)
    return
  }

  // The two telematics viewers use dispatcher accounts the map viewers do not use.
  const headers = dispatcherHeaders(role === 'telematics' ? 10 + __VU : __VU)

  if (role === 'telematics') {
    const res = http.get(`${BASE_URL}/api/driver-position?date=${TODAY}`, {
      headers,
      tags: { name: 'telematics_history' },
      timeout: '20s',
    })
    dashOk.add(
      check(res, {
        'telematics 200': r => r.status === 200,
        'history is present': r => {
          try {
            return typeof JSON.parse(r.body).history === 'object'
          } catch (_e) {
            return false
          }
        },
      }),
    )
    sleep(30)
    return
  }

  const pos = http.get(`${BASE_URL}/api/driver-position?date=${TODAY}&history=0`, {
    headers,
    tags: { name: 'map_positions' },
    timeout: '15s',
  })
  dashOk.add(
    check(pos, {
      'positions 200': r => r.status === 200,
      'positions an array': r => {
        try {
          return Array.isArray(JSON.parse(r.body).positions)
        } catch (_e) {
          return false
        }
      },
    }),
  )

  const missions = http.get(`${BASE_URL}/api/missions?date=${TODAY}&limit=50&page=1`, {
    headers,
    tags: { name: 'missions_list' },
    timeout: '10s',
  })
  dashOk.add(check(missions, { 'missions 200': r => r.status === 200 }))

  sleep(15)
}
