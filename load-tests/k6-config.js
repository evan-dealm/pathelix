/**
 * Shared config for all k6 load test scenarios.
 * Override via env vars: k6 run -e BASE_URL=https://... scenario.js
 */
export const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:3000'
export const TENANT_ID  = __ENV.TENANT_ID  || 'tenant-load-test'
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''   // session cookie value

// Number of simulated drivers
export const DRIVER_COUNT = parseInt(__ENV.DRIVER_COUNT || '150', 10)

// Thresholds — what "passing" means at 150 drivers
export const THRESHOLDS = {
  http_req_duration: ['p(50)<200', 'p(95)<1000', 'p(99)<3000'],
  http_req_failed:   ['rate<0.01'],   // <1% errors
}

export function authHeaders() {
  // X-Forwarded-For unique par VU : simule des appareils distincts (chaque chauffeur
  // a sa propre IP mobile en prod). Sans ça, tous les VUs partagent l'IP localhost
  // et le rate limit global du middleware (300 req/min/IP) fausse tout le test.
  const vu = typeof __VU !== 'undefined' ? __VU : 0
  return {
    'Cookie':          `session=${AUTH_TOKEN}`,
    'Content-Type':    'application/json',
    'X-Forwarded-For': `10.66.${Math.floor(vu / 250)}.${(vu % 250) + 1}`,
  }
}

// Generate a realistic driver ID list
export function driverIds(count = DRIVER_COUNT) {
  return Array.from({ length: count }, (_, i) => `load-driver-${String(i + 1).padStart(3, '0')}`)
}

export function randomLat() { return 45.7 + (Math.random() - 0.5) * 0.5 }
export function randomLng() { return 4.83 + (Math.random() - 0.5) * 0.5 }
export function today()     { return new Date().toISOString().slice(0, 10) }
