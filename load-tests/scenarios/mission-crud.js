/**
 * Scenario: 1000-1500 missions CRUD + pagination
 *
 * Simulates dispatchers creating missions + admins listing them.
 * Two groups of VUs:
 *  - 5 "writer" VUs — POST /api/missions in a loop
 *  - 15 "reader" VUs — GET /api/missions?page=N, cycling pages
 *
 * Target: ~1200 missions created over 2 min (5 VUs × ~4 rps × 60s = 1200).
 * Pagination must work: responses must include `total` and `page` fields.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 \
 *          -e AUTH_TOKEN=<session-cookie> \
 *          load-tests/scenarios/mission-crud.js
 */
import http  from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import { BASE_URL, authHeaders } from '../k6-config.js'

export const options = {
  scenarios: {
    writers: {
      executor: 'constant-vus',
      vus:      5,
      duration: '2m',
      gracefulStop: '10s',
      env: { ROLE: 'writer' },
    },
    readers: {
      executor: 'constant-vus',
      vus:      15,
      duration: '2m',
      gracefulStop: '10s',
      env: { ROLE: 'reader' },
    },
  },
  thresholds: {
    'mission_create_ok':                        ['rate>0.98'],
    'mission_list_ok':                          ['rate>0.99'],
    'http_req_duration{name:mission_create}':   ['p(95)<800', 'p(99)<2000'],
    'http_req_duration{name:mission_list}':     ['p(95)<500', 'p(99)<1500'],
  },
}

const createOk = new Rate('mission_create_ok')
const listOk   = new Rate('mission_list_ok')
const created  = new Counter('missions_created_total')

const TODAY    = new Date().toISOString().slice(0, 10)
const CLIENTS  = Array.from({ length: 20 }, (_, i) => `client-load-${i + 1}`)
const TYPES    = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'CHARGER_IMMEDIAT']
const DRIVERS  = Array.from({ length: 150 }, (_, i) => `load-driver-${String(i + 1).padStart(3, '0')}`)

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randomLat() { return 45.7 + (Math.random() - 0.5) * 0.5 }
function randomLng() { return 4.83 + (Math.random() - 0.5) * 0.5 }

export default function () {
  const role = __ENV.ROLE

  if (role === 'writer') {
    const payload = JSON.stringify({
      date:       TODAY,
      clientId:   pick(CLIENTS),
      driverId:   pick(DRIVERS),
      type:       pick(TYPES),
      latitude:   randomLat(),
      longitude:  randomLng(),
      address:    `${Math.floor(Math.random() * 200) + 1} rue de la Paix, Lyon`,
      binSize:    `${Math.floor(Math.random() * 20) + 5}m3`,
      wasteType:  'DIB',
      scheduled:  `${TODAY}T08:00:00.000Z`,
      estimatedDurationMin: 20,
      maneuverTimeMin:      5,
    })

    const res = http.post(
      `${BASE_URL}/api/missions`,
      payload,
      { headers: authHeaders(), tags: { name: 'mission_create' }, timeout: '10s' },
    )

    const ok = check(res, {
      'create 201 or 200': r => r.status === 200 || r.status === 201,
      'has id in body':    r => {
        try { return !!JSON.parse(r.body).id || !!JSON.parse(r.body).mission?.id } catch { return false }
      },
    })
    createOk.add(ok)
    if (ok) created.add(1)
    else console.error(`[writer VU ${__VU}] POST /api/missions ${res.status}: ${res.body?.slice(0, 200)}`)

    sleep(0.25)  // ~4 rps per writer
  } else {
    // Reader: paginate through missions
    const page    = Math.floor(Math.random() * 10) + 1
    const limit   = 50

    const res = http.get(
      `${BASE_URL}/api/missions?date=${TODAY}&page=${page}&limit=${limit}`,
      { headers: authHeaders(), tags: { name: 'mission_list' }, timeout: '10s' },
    )

    const ok = check(res, {
      'list 200':       r => r.status === 200,
      'has data array': r => {
        try { return Array.isArray(JSON.parse(r.body).data) } catch { return false }
      },
      'has pagination': r => {
        try { return 'pagination' in JSON.parse(r.body) } catch { return false }
      },
    })
    listOk.add(ok)
    if (!ok) console.error(`[reader VU ${__VU}] GET /api/missions ${res.status}: ${res.body?.slice(0, 200)}`)

    sleep(1)
  }
}
