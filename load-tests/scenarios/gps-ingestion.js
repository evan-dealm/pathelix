/**
 * Scenario: GPS ingestion — every driver's phone posting its position.
 *
 * One virtual user = one driver with its own session. The driver app posts every 30 s; this
 * scenario posts every 10 s, i.e. three times the real traffic of the simulated fleet.
 * Each post is written to PostgreSQL before the 200.
 *
 *   k6 run -e BASE_URL=http://localhost:3000 load-tests/scenarios/gps-ingestion.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'
import { BASE_URL, DRIVER_COUNT, driverFor, randomLat, randomLng } from '../k6-config.js'

export const options = {
  scenarios: {
    gps_flood: { executor: 'constant-vus', vus: DRIVER_COUNT, duration: __ENV.DURATION || '2m', gracefulStop: '10s' },
  },
  thresholds: {
    'http_req_duration{name:gps_post}': ['p(50)<100', 'p(95)<400', 'p(99)<1000'],
    'http_req_failed{name:gps_post}':   ['rate<0.01'],
    'gps_post_ok':                      ['rate>0.99'],
  },
}

const postOk = new Rate('gps_post_ok')

export default function () {
  const driver = driverFor(__VU)
  // Spread the fleet over the 10 s period instead of 150 simultaneous posts.
  if (__ITER === 0) sleep(Math.random() * 10)

  const res = http.post(`${BASE_URL}/api/driver-position`, JSON.stringify({
    driverId:  driver.id,
    latitude:  randomLat(),
    longitude: randomLng(),
    speedKmh:  Math.floor(Math.random() * 90),
    timestamp: new Date().toISOString(),
  }), { headers: driver.headers, tags: { name: 'gps_post' } })

  const ok = check(res, {
    'status 200':   r => r.status === 200,
    'body ok=true': r => { try { return JSON.parse(r.body).ok === true } catch (_e) { return false } },
  })
  postOk.add(ok)
  if (!ok && __ITER < 2) console.error(`[driver ${driver.id}] POST ${res.status}: ${String(res.body).slice(0, 160)}`)

  sleep(10)
}
