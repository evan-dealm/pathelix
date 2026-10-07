import { Page, expect } from '@playwright/test'

export async function login(page: Page, email = 'admin@excoffier.fr', password = 'Excoffier2026!') {
  const cookies = await page.context().cookies()
  const hasSession = cookies.some(c => c.name === 'session')

  if (hasSession) {
    try {
      await page.goto('/admin', { waitUntil: 'domcontentloaded' })
      await page.waitForURL(/\/(admin|onboarding)/, { timeout: 20_000 })

      if (page.url().includes('/onboarding')) {
        await page.locator('button[aria-label*="Sélectionner"]').first().click()
        await page.locator('button:has-text("Continuer")').click()
        await page.waitForURL(/\/admin/, { timeout: 15_000 })
      }
      return
    } catch {
      // storageState session rejected — fall through to full re-login
    }
  }

  const context = page.context()
  const res = await context.request.post('/api/auth/login', {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok()) {
    throw new Error(`Login failed (${res.status()}): ${await res.text()}`)
  }

  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/(admin|onboarding)/, { timeout: 30_000 })

  if (page.url().includes('/onboarding')) {
    await page.locator('button[aria-label*="Sélectionner"]').first().click()
    await page.locator('button:has-text("Continuer")').click()
    await page.waitForURL(/\/admin/, { timeout: 15_000 })
  }
}

export async function navigateToTab(page: Page, tabName: string) {
  const labelMap: Record<string, string> = {
    dashboard: 'Dashboard',
    missions: 'Missions',
    tours: 'Tournées',
    stats: 'Statistiques',
    history: 'Historique',
    catalogue: 'Clients & sites',
    drivers: 'Chauffeurs',
    vehicles: 'Camions',
    exutoires: 'Exutoires',
    templates: 'Récurrentes',
    users: 'Utilisateurs',
    audit: 'Audit',
    telematics: 'Télématique',
    settings: 'Paramètres',
  }

  // Several spec files call this with the capitalized display label (e.g. 'Dashboard',
  // 'Chauffeurs') instead of the lowercase AppTab key ('dashboard', 'drivers') the id selector
  // below actually needs. The button click still worked by accident in those cases (label
  // resolution falls back to the raw string, which happens to match the visible button text),
  // but #tabpanel-{tabName} is a case-sensitive CSS id and every real tabpanel id is lowercase
  // (see src/app/admin/page.tsx) — so the panel-visibility wait always failed for those calls,
  // independent of any timing/environment factor. Resolve to the canonical lowercase key
  // regardless of which convention the caller used.
  const reverseLabelMap = Object.fromEntries(
    Object.entries(labelMap).map(([key, value]) => [value.toLowerCase(), key]),
  )
  const key = labelMap[tabName.toLowerCase()]
    ? tabName.toLowerCase()
    : (reverseLabelMap[tabName.toLowerCase()] ?? tabName.toLowerCase())

  const label = labelMap[key] || tabName

  const tab = page
    .locator(`nav[aria-label="Navigation principale"] button[title="${label}"]`)
    .first()
  // `:visible` matters on mobile: the sidebar button is still in the DOM (hidden) and comes
  // first, while the one a user can tap is in the bottom navigation bar.
  const fallback = page.locator(`nav button:has-text("${label}"):visible`).first()

  // Each tab's content div carries id="tabpanel-{tabName}" (see src/app/admin/page.tsx) — the
  // same key already used in labelMap above. The click can silently no-op if it lands before
  // React finishes hydrating (the button is server-rendered and "visible"/"clickable" per
  // Playwright's actionability checks well before its onClick handler is attached), which
  // leaves activeTab unchanged with no error — every subsequent assertion in the test then times
  // out waiting for content that will never appear on the wrong panel. Retrying the click once
  // against a fresh locator recovers from that race without slowing down the common case where
  // it worked the first time.
  const targetPanel = page.locator(`#tabpanel-${key}`)

  // Each tab is a client-only dynamic import (see NAV_ITEMS / dynamic(..., {ssr:false}) in
  // src/app/admin/page.tsx) compiled on demand by Next.js dev mode — under real-world Windows
  // dev-machine conditions (antivirus real-time scanning of node_modules/.next during webpack
  // compilation) this can legitimately take well over 10s. The old loop re-clicked the tab on
  // every attempt with no check for "did the previous click already land and is just slow to
  // render" — a click that succeeded but was still compiling got a redundant second click layered
  // on top on the next attempt, and the wait restarted from zero instead of just needing more
  // time. Checking targetPanel first avoids re-clicking (and therefore avoids ever needing to
  // find out whether a second click on an already-active tab restarts anything) and widening the
  // per-attempt wait gives slow compiles room to finish on their own.
  let landed = false
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await targetPanel.isVisible({ timeout: 500 }).catch(() => false)) {
      landed = true
      break
    }
    if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tab.click()
    } else if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fallback.click()
    } else {
      break
    }
    if (
      await targetPanel
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      landed = true
      break
    }
  }
  // The sidebar expands on hover and overlays the content (src/app/globals.css, .sidebar:hover).
  // After clicking a nav button the pointer is still on it, so the expanded sidebar covered the
  // left of the panel and every later click there (table select-all checkboxes…) was
  // intercepted by it. A real user's pointer leaves the sidebar; move ours away too.
  await page.mouse.move(900, 400)
  await page.waitForTimeout(500)

  // Fail loudly and specifically here rather than silently returning — every caller's next
  // assertion would otherwise time out waiting for content on a panel that will never appear,
  // producing a confusing "waiting for tbody tr" error with no hint that the actual problem was
  // the tab switch itself never landing (found via e2e investigation: the previous silent
  // fallthrough masked this exact failure mode behind an unrelated-looking timeout downstream).
  if (!landed) {
    throw new Error(
      `navigateToTab('${tabName}'): #tabpanel-${key} never became visible after 3 click attempts`,
    )
  }
}

export async function waitForAdminReady(page: Page) {
  // Nav bar timeout kept short so beforeEach + test body stays within the 120s global limit.
  const navReady = await page
    .locator('nav[aria-label="Navigation principale"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (!navReady) {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page
      .locator('nav[aria-label="Navigation principale"]')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => {})
  }
  // DashboardTab (and all admin tabs) are dynamic imports — DynamicLoading skeleton has no text.
  await page
    .waitForFunction(
      () => (document.querySelector('#tabpanel-dashboard')?.textContent ?? '').trim().length > 10,
      { timeout: 8_000 },
    )
    .catch(() => {})
  await page.waitForTimeout(300)
}

export async function closeModal(page: Page) {
  const closeBtn = page
    .locator('button:has-text("Annuler"), button:has-text("Fermer"), [aria-label="Fermer"]')
    .first()
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click()
    await page.waitForTimeout(300)
  }
}

export function acceptDialogs(page: Page) {
  page.on('dialog', dialog => dialog.accept())
}

export function dismissDialogs(page: Page) {
  page.on('dialog', dialog => dialog.dismiss())
}
