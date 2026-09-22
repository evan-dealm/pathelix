import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

// Real-browser verification for the Leaflet -> MapLibre GL JS migration (2026-09-22, see
// MIGRATION_MAPLIBRE_LOG.md). jsdom (used by the unit/component tests) has no WebGL, so this
// is the only layer that can actually confirm the map renders a real canvas with real pixels
// rather than just "the code that would build one didn't throw" — this is exactly how the
// FleetMap defect documented in "Investigation 2" of the migration log was found and confirmed
// fixed: mocked tests could not have caught a bundler-worker-resolution bug at all.

test.describe('MapLibre migration — real browser rendering', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
  })

  test('FleetMap (Tournées tab) renders a real map with visible controls, no console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', err => consoleErrors.push(err.message))

    await navigateToTab(page, 'tours')

    // `data-maplibre-loaded` (set by useMapLibreMap's isStyleLoaded) is the reliable signal —
    // a raw pixel read at one fixed canvas coordinate is timing-sensitive relative to the
    // render loop's clear/redraw cycle and produced false negatives even on a genuinely
    // working map (confirmed by screenshot during Investigation 2: real streets/labels/
    // attribution rendered, single-pixel sample still read transparent at that exact instant).
    await expect(page.locator('[data-maplibre-loaded="true"]')).toBeVisible({ timeout: 20_000 })

    const canvas = page.locator('.maplibregl-canvas')
    await expect(canvas).toBeVisible()

    // Controls added by useMapLibreMap: Navigation (zoom/compass), Scale, Attribution.
    await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-compass')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-scale')).toBeVisible()

    // Legally-required OSM attribution text must actually be present, not just an empty control.
    const attributionText = await page.locator('.maplibregl-ctrl-attrib').innerText()
    expect(attributionText.toLowerCase()).toContain('openstreetmap')

    const realErrors = consoleErrors.filter(e =>
      !e.includes('favicon') && // unrelated to the map, cosmetic 404 some environments produce
      !e.includes('ERR_BLOCKED_BY_CLIENT'),
    )
    expect(realErrors, `Console/page errors while FleetMap was mounted:\n${realErrors.join('\n')}`).toEqual([])
  })
})

test.describe('MapLibre migration — LiveTrackingMap with a real seeded position', () => {
  test('LiveTrackingMap (Telematique tab) renders a real vector map, marker and popup for a seeded position', async ({ page }) => {
    // MIGRATION_MAPLIBRE_LOG.md "Investigation 3", Point 3: TelematicsTab only mounts
    // LiveTrackingMap once `data.positions.length > 0` (see TelematicsTab.tsx) — this test used
    // to `if (count > 0)` around its assertions, which meant the whole check silently never ran
    // against this tenant (no live position was ever seeded for it), so it could never have
    // caught the pre-fix worker-URL bug either: a false positive from an untested branch, not a
    // genuine pass. Seeding one real position through the app's own API removes that gap.
    //
    // The default excoffier-test tenant (used by the describe block above) has no seeded
    // Driver — e2e/global-setup.ts only creates a tenant/admin/exutoire/vehicle/missions — so
    // this test authenticates as the fleetmap-e2e tenant instead (seeded via
    // scripts/seed-fleetmap-e2e.ts, same one e2e/fleetmap-validation.spec.ts uses), which is
    // guaranteed to have real drivers. Its own describe block (no shared beforeEach) avoids an
    // extra wasted login against the login rate limiter.
    await page.context().clearCookies()
    await login(page, 'admin@fleetmap-e2e.test', 'FleetMapE2E2026!')
    await waitForAdminReady(page)

    const driversRes = await page.request.get('/api/driver-list')
    const bySector = await driversRes.json() as Array<{ drivers: Array<{ id: string; firstName: string; lastName: string }> }>
    const driver = bySector.flatMap(s => s.drivers)[0]
    expect(driver, 'Expected at least one driver in the default E2E tenant to seed a live position for').toBeTruthy()

    const lat = 46.0682
    const lng = 5.9245
    const posRes = await page.request.post('/api/driver-position', {
      data: { driverId: driver!.id, latitude: lat, longitude: lng, speedKmh: 35 },
    })
    expect(posRes.ok()).toBe(true)

    await navigateToTab(page, 'telematics')

    const canvas = page.locator('.maplibregl-canvas')
    await expect(page.locator('[data-maplibre-loaded="true"]').first()).toBeVisible({ timeout: 20_000 })
    await expect(canvas.first()).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-attrib').first()).toBeVisible()

    // Vector tiles must be genuinely loaded, not just a background layer painted with zero data
    // (a style's background-color layer alone can satisfy isStyleLoaded()/'load' with no real
    // source ever fetched — the exact gap this point exists to close).
    await page.waitForTimeout(1500)
    const sourcesLoaded = await page.evaluate(() => {
      function findMap(el: Element | null): unknown {
        let node = el as (Element & { __maplibreMap?: unknown }) | null
        while (node) {
          if (node.__maplibreMap) return node.__maplibreMap
          node = node.parentElement as (Element & { __maplibreMap?: unknown }) | null
        }
        return null
      }
      const canvasEl = document.querySelector('.maplibregl-canvas')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = findMap(canvasEl) as any
      if (!map) throw new Error('No MapLibre map instance found on the page')
      const style = map.getStyle()
      const vectorSourceIds = Object.entries(style.sources)
        .filter(([, s]: [string, any]) => s.type === 'vector')
        .map(([id]) => id)
      return {
        vectorSourceIds,
        allLoaded: vectorSourceIds.length > 0 && vectorSourceIds.every(id => map.isSourceLoaded(id)),
      }
    })
    expect(sourcesLoaded.vectorSourceIds.length, 'Expected the basemap style to declare at least one vector source').toBeGreaterThan(0)
    expect(sourcesLoaded.allLoaded, `Not all vector sources finished loading: ${JSON.stringify(sourcesLoaded.vectorSourceIds)}`).toBe(true)

    // LiveTrackingMap's fitBounds() animates the camera to the seeded point — wait for that
    // animation to genuinely settle ('idle') before measuring anything, or the marker/project()
    // comparison below samples mid-transition and drifts by tens of px (observed live: this
    // measurement was flaky by ~15-20px before this wait was added).
    await page.evaluate(() => {
      function findMap(el: Element | null): unknown {
        let node = el as (Element & { __maplibreMap?: unknown }) | null
        while (node) {
          if (node.__maplibreMap) return node.__maplibreMap
          node = node.parentElement as (Element & { __maplibreMap?: unknown }) | null
        }
        return null
      }
      const canvasEl = document.querySelector('.maplibregl-canvas')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = findMap(canvasEl) as any
      return new Promise<void>(resolve => {
        if (!map.isMoving() && !map.isEasing()) { resolve(); return }
        map.once('idle', () => resolve())
      })
    })

    // The marker itself sits at the exact seeded [lng, lat] — not transposed, not defaulted.
    // Compare its actual screen position against map.project([lng, lat]) for that same point.
    // Other drivers in this tenant may carry a stale live position from an earlier test run
    // (real DB data persists across specs) — several markers can legitimately be on screen at
    // once, so the target marker is picked by proximity to the expected point, not by DOM order
    // (`.first()` picked the wrong marker here on the first version of this test).
    const expectedScreenPoint = await page.evaluate(([lat, lng]) => {
      function findMap(el: Element | null): unknown {
        let node = el as (Element & { __maplibreMap?: unknown }) | null
        while (node) {
          if (node.__maplibreMap) return node.__maplibreMap
          node = node.parentElement as (Element & { __maplibreMap?: unknown }) | null
        }
        return null
      }
      const canvasEl = document.querySelector('.maplibregl-canvas')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = findMap(canvasEl) as any
      const p = map.project([lng, lat])
      return { x: p.x, y: p.y }
    }, [lat, lng])
    const canvasBox = await canvas.first().boundingBox()
    expect(canvasBox).toBeTruthy()
    const allMarkers = page.locator('.maplibregl-marker')
    const markerCount = await allMarkers.count()
    expect(markerCount, 'Expected at least one live-position marker').toBeGreaterThan(0)
    let marker = allMarkers.first()
    let bestDist = Infinity
    for (let i = 0; i < markerCount; i++) {
      const candidate = allMarkers.nth(i)
      const box = await candidate.boundingBox()
      if (!box) continue
      const center = { x: box.x + box.width / 2 - canvasBox!.x, y: box.y + box.height / 2 - canvasBox!.y }
      const dist = Math.hypot(center.x - expectedScreenPoint.x, center.y - expectedScreenPoint.y)
      if (dist < bestDist) { bestDist = dist; marker = candidate }
    }
    expect(bestDist, `Nearest marker to the seeded position is ${bestDist}px away`).toBeLessThan(15)
    await expect(marker).toBeVisible()

    // Popup opens on click and shows this driver's data.
    await marker.click()
    const popup = page.locator('.maplibregl-popup')
    await expect(popup).toBeVisible({ timeout: 5_000 })
    await expect(popup).toContainText(driver!.firstName)
  })
})
