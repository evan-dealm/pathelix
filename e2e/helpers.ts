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
    catalogue: 'Catalogue',
    drivers: 'Chauffeurs',
    vehicles: 'Camions',
    exutoires: 'Exutoires',
    templates: 'Recurrentes',
    users: 'Utilisateurs',
    audit: 'Audit',
    telematics: 'Telematique',
    settings: 'Parametres',
  }

  const label = labelMap[tabName] || tabName

  const tab = page.locator(`nav[aria-label="Navigation principale"] button[title="${label}"]`).first()
  const fallback = page.locator(`nav button:has-text("${label}")`).first()

  // Each tab's content div carries id="tabpanel-{tabName}" (see src/app/admin/page.tsx) — the
  // same key already used in labelMap above. The click can silently no-op if it lands before
  // React finishes hydrating (the button is server-rendered and "visible"/"clickable" per
  // Playwright's actionability checks well before its onClick handler is attached), which
  // leaves activeTab unchanged with no error — every subsequent assertion in the test then times
  // out waiting for content that will never appear on the wrong panel. Retrying the click once
  // against a fresh locator recovers from that race without slowing down the common case where
  // it worked the first time.
  const targetPanel = page.locator(`#tabpanel-${tabName}`)

  for (let attempt = 0; attempt < 2; attempt++) {
    if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tab.click()
    } else if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fallback.click()
    } else {
      break
    }
    if (await targetPanel.waitFor({ state: 'attached', timeout: 5_000 }).then(() => true).catch(() => false)) {
      break
    }
  }
  await page.waitForTimeout(500)
}

export async function waitForAdminReady(page: Page) {
  // Nav bar timeout kept short so beforeEach + test body stays within the 120s global limit.
  const navReady = await page.locator('nav[aria-label="Navigation principale"]').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
  if (!navReady) {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.locator('nav[aria-label="Navigation principale"]').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  }
  // DashboardTab (and all admin tabs) are dynamic imports — DynamicLoading skeleton has no text.
  await page.waitForFunction(
    () => (document.querySelector('#tabpanel-dashboard')?.textContent ?? '').trim().length > 10,
    { timeout: 8_000 },
  ).catch(() => {})
  await page.waitForTimeout(300)
}

export async function closeModal(page: Page) {
  const closeBtn = page.locator('button:has-text("Annuler"), button:has-text("Fermer"), [aria-label="Fermer"]').first()
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
