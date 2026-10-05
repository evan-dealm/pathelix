/**
 * Web Push endpoints the server is willing to POST to. A subscription endpoint is client
 * supplied; without this allowlist any authenticated user could make the server send requests
 * to an arbitrary (internal) URL through /api/push/notify.
 */
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',               // Chrome, Edge (Chromium), Android
  'android.googleapis.com',
  'updates.push.services.mozilla.com', // Firefox
  'push.services.mozilla.com',
  'notify.windows.com',               // Edge legacy / Windows
  'push.apple.com',                   // Safari (web.push.apple.com)
]

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOST_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`))
}
