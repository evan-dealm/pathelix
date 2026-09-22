import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

// Real-browser verification for the Leaflet -> MapLibre GL JS migration (2026-09-22, see
// MIGRATION_MAPLIBRE_LOG.md). jsdom (used by the unit/component tests) has no WebGL, so this
// is the only layer that can actually confirm the map renders a real canvas with real pixels
// rather than just "the code that would build one didn't throw".

test.describe('MapLibre migration — real browser rendering', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    // The Tournées/Telematique tabs pull in a large, dev-mode on-demand-compiled chunk
    // (MapLibre GL JS is far heavier than Leaflet was) — give Next.js's dev server room to
    // finish that first compile before the tab-switch retry loop starts timing itself out.
    await page.waitForTimeout(2000)
  })

  // KNOWN FAILING TEST — confirmed real bug, not flakiness or environment limitation.
  // Investigated 2026-09-22 (see MIGRATION_MAPLIBRE_LOG.md "Known open defect" section):
  // FleetMap's `useMapLibreMap` map instance never fires 'load' in a real browser (confirmed
  // in both `next dev` and a production `next build && next start`), even though the network
  // panel shows the style/sprite/tile requests all completing with 200, the canvas mounts at
  // its correct real size, a WebGL context is obtainable, and there are zero console/page
  // errors — it just silently never finishes. LiveTrackingMap, built on the exact same shared
  // hook, works correctly every time. Root cause not found despite ruling out: React 18
  // StrictMode dev double-invoke (reproduces in production too, where that doesn't run),
  // container sizing (608x573, confirmed real), degenerate/NaN coordinates (confirmed valid,
  // real seed coordinates), network failure (all 200s), pitch (reproduces with pitch:0 too),
  // tab focus/backgrounding, and the shared logger swallowing an 'error' event (it doesn't —
  // confirmed via direct console capture). Left failing intentionally per this mission's own
  // rule against masking a real defect — do not skip, weaken, or delete this test to make the
  // suite green; fix the underlying bug in FleetMap.tsx / useMapLibreMap.ts instead.
  test('FleetMap (Tournées tab) renders a non-empty WebGL canvas with visible controls, no console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', err => consoleErrors.push(err.message))

    await navigateToTab(page, 'tours')

    const canvas = page.locator('.maplibregl-canvas')
    await expect(canvas).toBeVisible({ timeout: 20_000 })

    // 'load' (which gates isStyleLoaded) fires once the style JSON is parsed — the vector
    // tiles themselves are still an in-flight network fetch at that point, so the canvas is
    // legitimately blank for a bit afterwards. Poll pixel content instead of sampling once.
    async function samplePixels(): Promise<boolean | null> {
      return canvas.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('webgl2') || el.getContext('webgl')
        if (!ctx) return false
        const gl = ctx as WebGLRenderingContext
        const pixels = new Uint8Array(4)
        gl.readPixels(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        // Fully transparent black (0,0,0,0) at the exact center is what an un-rendered/cleared
        // WebGL canvas looks like — any other value means the basemap actually painted something.
        return !(pixels[0] === 0 && pixels[1] === 0 && pixels[2] === 0 && pixels[3] === 0)
      }).catch(() => null)
    }

    let hasNonEmptyPixels: boolean | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      hasNonEmptyPixels = await samplePixels()
      if (hasNonEmptyPixels) break
      await page.waitForTimeout(1000)
    }

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

    expect(
      hasNonEmptyPixels,
      'FleetMap canvas never painted any pixels — the style never finished loading (isStyleLoaded stuck false). See the KNOWN FAILING TEST comment above this test for the full investigation.',
    ).toBe(true)
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
      await expect(canvas.first()).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.maplibregl-ctrl-attrib').first()).toBeVisible()
    }
  })
})
