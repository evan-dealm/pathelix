import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

// Full-data validation of FleetMap against a real, non-trivial tenant (3 drivers, a real
// planned tournée, an exutoire, a pool mission, and a live GPS position) — seeded via
// scripts/seed-fleetmap-e2e.ts against the sandbox DB (never prod, always through
// scripts/db-guard.sh). Runs after the fix documented in MIGRATION_MAPLIBRE_LOG.md
// "Investigation 2"; the near-empty tenant in maplibre-migration.spec.ts proves the map loads
// at all, this proves the actual data-driven behavior (markers, routes, interactions) works
// end to end against real Prisma-backed data, on a production build.
//
// Prerequisite: `export DATABASE_URL=<sandbox>` then
// `scripts/db-guard.sh npx tsx scripts/seed-fleetmap-e2e.ts` — not run automatically by this
// spec (it needs an explicit, guarded, human-initiated DB write, per this mission's rule 5).

const FLEETMAP_E2E_EMAIL = 'admin@fleetmap-e2e.test'
const FLEETMAP_E2E_PASSWORD = 'FleetMapE2E2026!'

// Real coordinates from scripts/seed-fleetmap-e2e.ts — used to verify lat/lng was not
// transposed anywhere along the Leaflet [lat,lng] -> MapLibre [lng,lat] conversion path.
const MISSION_ONE = { lat: 48.8920, lng: 2.3550 }
const ALICE_DEPOT  = { lat: 48.8900, lng: 2.3500 }

// Finds the live maplibregl.Map instance (see useMapLibreMap.ts's `container.__maplibreMap`
// testability hook) and stashes it on `window` once, so every later page.evaluate() in this
// spec can reach it with a plain, self-contained arrow function — no eval, no shared-closure
// tricks, each call site passed directly to Playwright's own (safe) function serialization.
async function grabMapHandle(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    function findMap(el: Element | null): unknown {
      let node = el as (Element & { __maplibreMap?: unknown }) | null
      while (node) {
        if (node.__maplibreMap) return node.__maplibreMap
        node = node.parentElement as (Element & { __maplibreMap?: unknown }) | null
      }
      return null
    }
    const canvas = document.querySelector('.maplibregl-canvas')
    const map = findMap(canvas)
    if (!map) throw new Error('No MapLibre map instance found on the page')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__e2eMap = map
  })
}

test.describe('FleetMap — full-data validation (real tenant, real tournée)', () => {
  test('renders drivers, missions, routes, interactions and heatmap correctly against real data', async ({ page }) => {
    const consoleErrors: string[] = []
    const fontGlyph404s: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', err => consoleErrors.push(err.message))
    // OpenFreeMap's public font/glyph server (tiles.openfreemap.org/fonts/...) does not have
    // full emoji coverage for every Unicode range — mission markers use literal emoji as
    // text-field (['get', 'emoji']), and MapLibre 404s fetching the .pbf glyph range for
    // codepoints it can't serve, then falls back to a visible-but-glyphless box. Pre-existing
    // third-party style/font-server limitation, unrelated to this migration's own bug (the
    // worker-URL/middleware fix documented in MIGRATION_MAPLIBRE_LOG.md "Investigation 2") —
    // tracked separately, not silently ignored: see that file's "Known residual issue" note.
    page.on('response', res => { if (res.status() === 404 && res.url().includes('tiles.openfreemap.org/fonts/')) fontGlyph404s.push(res.url()) })

    // The 'chromium' project preloads a storageState session cookie for a DIFFERENT tenant
    // (excoffier-test, from e2e/global-setup.ts) — login()'s early-return-if-already-has-a-
    // session-cookie path would otherwise silently reuse that wrong session instead of
    // authenticating as this spec's own fleetmap-e2e admin.
    await page.context().clearCookies()
    await login(page, FLEETMAP_E2E_EMAIL, FLEETMAP_E2E_PASSWORD)
    await waitForAdminReady(page)

    // Live position for Alice — real POST through the app's own API, same as an OBD device
    // would, authenticated via the browser's own session cookie.
    const driversRes = await page.request.get('/api/driver-list')
    // Grouped by sector: [{ sector, drivers: [{ id, firstName, lastName, ... }] }]
    const bySector = await driversRes.json() as Array<{ drivers: Array<{ id: string; firstName: string }> }>
    const driverList = bySector.flatMap(s => s.drivers)
    const alice = driverList.find((d) => d.firstName === 'Alice')
    expect(alice, 'Alice must exist — did you run scripts/seed-fleetmap-e2e.ts against this DB?').toBeTruthy()

    const posRes = await page.request.post('/api/driver-position', {
      data: { driverId: alice!.id, latitude: ALICE_DEPOT.lat + 0.001, longitude: ALICE_DEPOT.lng + 0.001, speedKmh: 22 },
    })
    expect(posRes.ok()).toBe(true)

    await navigateToTab(page, 'tours')
    await expect(page.locator('[data-maplibre-loaded="true"]')).toBeVisible({ timeout: 20_000 })

    // ── 1. Canvas, controls, attribution ─────────────────────────────────────────────────
    await expect(page.locator('.maplibregl-canvas')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-compass')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-scale')).toBeVisible()

    // Give the mission/route GeoJSON sources a moment to receive their first setData() call
    // (driven by React effects, not the style 'load' event) plus queryRenderedFeatures needs
    // at least one render pass after that.
    await page.waitForTimeout(1500)
    await grabMapHandle(page)

    // ── 2. Mission markers present, correct [lng,lat] (not transposed) ─────────────────────
    // queryRenderedFeatures can return the same feature more than once (documented MapLibre/
    // Mapbox GL behavior across tile boundaries) — de-dupe by missionId. Alice's simulated
    // tour (src/lib/algorithm.ts calcTour) may also insert its own synthetic exutoire-visit
    // stops alongside the 2 real missions (ids like "_ex_<exutoireId>_after_<missionId>") —
    // that route-simulation behavior predates this migration and is unchanged by it (FleetMap's
    // `!step.isSynthetic` filter is the exact same check the old Leaflet code used), so this
    // spec only asserts the 2 real seeded missions are present, not an exact total count.
    const uniqueMissionIds = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      const features = map.queryRenderedFeatures(undefined, { layers: ['fleetmap-missions-circle'] })
      return [...new Set(features.map((f: { properties: { missionId: string } }) => f.properties.missionId))]
    })
    const realMissionIds = uniqueMissionIds.filter((id): id is string => typeof id === 'string' && !id.startsWith('_ex_'))
    expect(realMissionIds, 'Expected both real seeded missions to be rendered').toHaveLength(2)

    const missionOneCoords = await page.evaluate((targetLat) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      const features = map.queryRenderedFeatures(undefined, { layers: ['fleetmap-missions-circle'] })
      const match = features.find((f: { geometry: { type: string; coordinates: [number, number] } }) =>
        f.geometry.type === 'Point' && Math.abs(f.geometry.coordinates[1] - targetLat) < 0.001,
      )
      return match ? match.geometry.coordinates : null
    }, MISSION_ONE.lat)
    expect(missionOneCoords, 'Mission one should be findable by its real latitude').toBeTruthy()
    // GeoJSON/MapLibre order is [lng, lat] — coordinates[0] must be the longitude (~2.35), not
    // the latitude (~48.89). A transposed conversion would fail this exact assertion.
    expect(missionOneCoords![0]).toBeCloseTo(MISSION_ONE.lng, 2)
    expect(missionOneCoords![1]).toBeCloseTo(MISSION_ONE.lat, 2)

    // ── 3. Route line rendered for Alice's tournée ──────────────────────────────────────────
    const routeFeatureCount = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      return map.queryRenderedFeatures(undefined, { layers: ['fleetmap-routes-line'] }).length
    })
    expect(routeFeatureCount, "Expected at least Alice's route line to be rendered").toBeGreaterThan(0)

    // ── 4. fitBounds encompasses the seeded points (not stuck at the [6.1,45.9] fallback) ───
    const bounds = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      const b = map.getBounds()
      return { sw: [b.getWest(), b.getSouth()], ne: [b.getEast(), b.getNorth()] }
    })
    expect(bounds.sw[0]).toBeLessThan(MISSION_ONE.lng)
    expect(bounds.ne[0]).toBeGreaterThan(MISSION_ONE.lng)
    expect(bounds.sw[1]).toBeLessThan(MISSION_ONE.lat)
    expect(bounds.ne[1]).toBeGreaterThan(MISSION_ONE.lat)

    // ── 5. Click a route -> isolates that driver (legend shows "N isole(s)") ────────────────
    const routeScreenPoint = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      const f = map.queryRenderedFeatures(undefined, { layers: ['fleetmap-routes-line'] })[0]
      const coords = f.geometry.coordinates as [number, number][]
      const mid = coords[Math.floor(coords.length / 2)]
      const p = map.project(mid)
      return { x: p.x, y: p.y }
    })
    await page.locator('.maplibregl-canvas').click({ position: routeScreenPoint })
    await expect(page.locator('text=/\\d+ isole/')).toBeVisible({ timeout: 5_000 })

    // ── 6. Hover a mission -> tooltip popup with its content appears ───────────────────────
    const missionScreenPoint = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      const f = map.queryRenderedFeatures(undefined, { layers: ['fleetmap-missions-circle'] })[0]
      const p = map.project(f.geometry.coordinates)
      return { x: p.x, y: p.y }
    })
    await page.locator('.maplibregl-canvas').hover({ position: missionScreenPoint })
    await expect(page.locator('.fleetmap-tooltip')).toBeVisible({ timeout: 5_000 })

    // ── 7. Heatmap toggle adds/removes the native heatmap layer visibility ─────────────────
    const getHeatmapVisibility = () => page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      return map.getLayoutProperty('fleetmap-heatmap', 'visibility')
    })
    expect(await getHeatmapVisibility()).toBe('none')
    await page.locator('button[title="Afficher la densité de missions"]').click()
    await expect.poll(getHeatmapVisibility).toBe('visible')
    await page.locator('button[title="Masquer la heatmap"]').click()
    await expect.poll(getHeatmapVisibility).toBe('none')

    // ── 8. Panel resize is picked up by the ResizeObserver -> map.resize() ─────────────────
    const getCanvasWidth = () => page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__e2eMap
      return map.getCanvas().width
    })
    const canvasWidthBefore = await getCanvasWidth()
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.waitForTimeout(500)
    const canvasWidthAfter = await getCanvasWidth()
    expect(canvasWidthAfter).not.toBe(canvasWidthBefore)

    // ── 9. Zero real console/page errors across the whole scenario ─────────────────────────
    // Swallow exactly as many generic "Failed to load resource...404" console lines as we
    // independently confirmed (via the response listener above) came from OpenFreeMap's font
    // glyph server — never more. Any 404/error beyond that known, counted, documented set
    // still fails the test; this is not a blanket text-match that could hide a real future bug.
    const GENERIC_RESOURCE_404 = 'Failed to load resource: the server responded with a status of 404 ()'
    let explainedBy404 = fontGlyph404s.length
    const realErrors = consoleErrors.filter(e => {
      if (e.includes('favicon') || e.includes('ERR_BLOCKED_BY_CLIENT')) return false
      if (e === GENERIC_RESOURCE_404 && explainedBy404 > 0) { explainedBy404--; return false }
      return true
    })
    expect(realErrors, `Console/page errors during the full validation scenario:\n${realErrors.join('\n')}`).toEqual([])
  })
})
