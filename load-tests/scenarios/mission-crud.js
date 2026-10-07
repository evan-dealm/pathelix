/**
 * Scenario: missions being entered and browsed.
 *
 * - `writers`: one mission created per second. An organisation is limited to 100 mission
 *   writes per minute (bulk loads go through the import), so this is close to the most the
 *   application accepts; beyond it answers 429.
 * - `readers`: 15 dispatchers paging through the day's missions.
 *
 *   k6 run -e BASE_URL=http://localhost:3000 load-tests/scenarios/mission-crud.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Counter } from 'k6/metrics'
import { BASE_URL, CLIENT_IDS, dispatcherHeaders, pick, randomLat, randomLng, today } from '../k6-config.js'

const DURATION = __ENV.DURATION || '2m'

export const options = {
  scenarios: {
    writers: { executor: 'constant-vus', vus: 1,  duration: DURATION, gracefulStop: '10s', env: { ROLE: 'writer' } },
    readers: { executor: 'constant-vus', vus: 15, duration: DURATION, gracefulStop: '10s', env: { ROLE: 'reader' } },
  },
  thresholds: {
    'mission_create_ok': ['rate>0.98'],
    'mission_list_ok':   ['rate>0.99'],
    'http_req_duration{name:mission_create}': ['p(95)<800', 'p(99)<2000'],
    'http_req_duration{name:mission_list}':   ['p(95)<500', 'p(99)<1500'],
  },
}

const createOk = new Rate('mission_create_ok')
const listOk = new Rate('mission_list_ok')
const created = new Counter('missions_created_total')

const TODAY = today()
// Types a dispatcher can create (VIDER and PAUSE are produced by the optimiser only).
const TYPES = ['POSER', 'RETIRER', 'ECHANGER', 'CHARGER_IMMEDIAT']

export default function () {
  // 16 virtual users, 20 dispatcher accounts: each has its own session.
  const headers = dispatcherHeaders(__VU)

  if (__ENV.ROLE === 'writer') {
    const res = http.post(`${BASE_URL}/api/missions`, JSON.stringify({
      date:      TODAY,
      type:      pick(TYPES),
      clientId:  pick(CLIENT_IDS),
      address:   `${Math.floor(Math.random() * 200) + 1} rue de la République, Lyon`,
      latitude:  randomLat(),
      longitude: randomLng(),
      estimatedDurationMin: 20,
      maneuverTimeMin: 5,
    }), { headers, tags: { name: 'mission_create' }, timeout: '10s' })

    const ok = check(res, {
      'created (200/201)': r => r.status === 200 || r.status === 201,
      'has an id':         r => { try { const b = JSON.parse(r.body); return !!(b.id || (b.mission && b.mission.id)) } catch (_e) { return false } },
    })
    createOk.add(ok)
    if (ok) created.add(1)
    else if (__ITER < 2) console.error(`[writer ${__VU}] POST /api/missions ${res.status}: ${String(res.body).slice(0, 200)}`)
    sleep(1)
    return
  }

  const page = Math.floor(Math.random() * 5) + 1
  const res = http.get(`${BASE_URL}/api/missions?date=${TODAY}&page=${page}&limit=50`, { headers, tags: { name: 'mission_list' }, timeout: '10s' })
  const ok = check(res, { 'list 200': r => r.status === 200 })
  listOk.add(ok)
  if (!ok && __ITER < 2) console.error(`[reader ${__VU}] GET /api/missions ${res.status}: ${String(res.body).slice(0, 200)}`)
  sleep(1)
}
