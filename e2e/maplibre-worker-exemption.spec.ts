import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'

// Point 2.4 of the mission: the middleware matcher exemption for the versioned worker path must
// be scoped to exactly these two static files, not a broader open prefix. Proven at the HTTP
// level (not by calling middleware() directly — `matcher` is compiled and applied by Next's own
// routing layer before middleware() ever runs, so a unit test of the function alone cannot
// exercise it).
//
// Uses a freshly-created APIRequestContext (not the `request` fixture) because the `chromium`
// project's `storageState` (set up by e2e/auth.setup.ts) would otherwise silently carry an
// authenticated session cookie into every request here, making "no session" assertions
// meaningless — this really did produce a false failure (200 instead of the expected redirect)
// on the first run of this exact test.
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'package.json'), 'utf8'),
)

test.describe('maplibre worker path auth exemption', () => {
  let anon: APIRequestContext

  test.beforeAll(async ({ baseURL }) => {
    // `storageState: undefined` is required — without it, newContext() still inherits the
    // chromium project's `use.storageState` (e2e/.auth/state.json) from playwright.config.ts,
    // silently attaching an authenticated session cookie and defeating the whole point of this
    // spec (confirmed live: /admin returned 200 instead of a redirect without this override).
    anon = await playwrightRequest.newContext({ baseURL, storageState: undefined })
  })
  test.afterAll(async () => {
    await anon.dispose()
  })

  test('worker script is reachable with no session cookie', async () => {
    const res = await anon.get(`/maplibre/${version}/maplibre-gl-worker.mjs`)
    expect(res.status()).toBe(200)
  })

  test('shared module is reachable with no session cookie', async () => {
    const res = await anon.get(`/maplibre/${version}/maplibre-gl-shared.mjs`)
    expect(res.status()).toBe(200)
  })

  test('a neighboring, non-exempted route still redirects to /login with no session', async () => {
    const res = await anon.get('/admin', { maxRedirects: 0 })
    expect(res.status()).toBe(307) // Next.js middleware redirect
    expect(res.headers()['location']).toContain('/login')
  })

  test('a made-up file under the maplibre/ prefix is NOT exempted (no open-prefix regression)', async () => {
    const res = await anon.get(`/maplibre/${version}/not-a-real-file.mjs`, { maxRedirects: 0 })
    // Static file 404s straight through (not a page route), so no redirect is expected here —
    // the point is that it must not be a 200 that would prove the prefix is wide open.
    expect(res.status()).not.toBe(200)
  })
})
