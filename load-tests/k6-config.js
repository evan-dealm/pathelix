/**
 * Shared config of the k6 scenarios.
 *
 * Sessions come from load-tests/.tokens.json, written by `load-tests/seed.ts`: one per simulated
 * driver, dispatcher and admin. The application limits requests per user, so virtual users must
 * not share a cookie — they would measure the rate limiter instead of the application.
 *
 *   k6 run -e BASE_URL=https://… load-tests/scenarios/<scenario>.js
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

const TOKENS = (() => {
  try {
    return JSON.parse(open('./.tokens.json'))
  } catch (_err) {
    throw new Error('load-tests/.tokens.json is missing — run: npx tsx --tsconfig tsconfig.json load-tests/seed.ts')
  }
})()

/** Number of simulated drivers (at most what the seed created). */
export const DRIVER_COUNT = Math.min(parseInt(__ENV.DRIVER_COUNT || '150', 10), TOKENS.drivers.length)
export const DISPATCHER_COUNT = TOKENS.dispatchers.length
export const CLIENT_IDS = TOKENS.clientIds

const headers = token => ({ 'Cookie': `session=${token}`, 'Content-Type': 'application/json' })

/** The driver played by virtual user `vu` (1-based): its id and its own session. */
export function driverFor(vu) {
  const d = TOKENS.drivers[(vu - 1) % TOKENS.drivers.length]
  return { id: d.id, headers: headers(d.token) }
}

/** The dispatcher played by virtual user `vu` (1-based). */
export function dispatcherHeaders(vu) {
  return headers(TOKENS.dispatchers[(vu - 1) % TOKENS.dispatchers.length])
}

export function adminHeaders() {
  return headers(TOKENS.admin)
}

export function driverIds(count = DRIVER_COUNT) {
  return TOKENS.drivers.slice(0, count).map(d => d.id)
}

export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
export function randomLat() { return 45.75 + (Math.random() - 0.5) * 0.5 }
export function randomLng() { return 4.83 + (Math.random() - 0.5) * 0.5 }
export function today() { return new Date().toISOString().slice(0, 10) }
