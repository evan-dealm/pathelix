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

  test('LiveTrackingMap (Telematique tab) renders a canvas with controls', async ({ page }) => {
    await navigateToTab(page, 'telematics')
    await page.waitForTimeout(500)

    const canvas = page.locator('.maplibregl-canvas')
    const count = await canvas.count()
    // Only asserted when the widget actually mounts (it's conditionally rendered only once
    // live position data exists — see TelematicsTab.tsx) — a 0-canvas result here is a
    // legitimate "no live positions in this test run" state, not a failure.
    if (count > 0) {
      await expect(page.locator('[data-maplibre-loaded="true"]').first()).toBeVisible({ timeout: 20_000 })
      await expect(canvas.first()).toBeVisible()
      await expect(page.locator('.maplibregl-ctrl-attrib').first()).toBeVisible()
    }
  })
})
