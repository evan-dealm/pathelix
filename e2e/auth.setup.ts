import { test as setup } from '@playwright/test'

const AUTH_FILE = 'e2e/.auth/state.json'

setup('authenticate', async ({ page }) => {

  const context = page.context()
  const res = await context.request.post('/api/auth/login', {
    data:    { email: 'admin@excoffier.fr', password: 'Excoffier2026!' },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
  })

  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`Login API failed (${res.status()}): ${body}`)
  }

  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/(admin|onboarding)/, { timeout: 30_000 })

  if (page.url().includes('/onboarding')) {
    await page.locator('button[aria-label*="Sélectionner"]').first().click()
    await page.locator('button:has-text("Continuer")').click()
    await page.waitForURL(/\/admin/, { timeout: 30_000 })
  }

  // OnboardingGuide is gated by localStorage (see src/components/ui/OnboardingGuide.tsx) — if
  // left un-dismissed here, every test reusing this storageState starts with the modal open,
  // blocking all page interaction behind it until each test's action timeout expires. The UI
  // click below is racy (hydration timing, especially under memory pressure), so it's backed by
  // a direct localStorage write that unconditionally guarantees the dismissed state regardless
  // of whether the button ever became visible in time — this is what storageState() actually
  // persists, not "we clicked something".
  const skipTour = page.locator('button[aria-label="Passer le guide"]')
  if (await skipTour.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await skipTour.click()
  }
  await page.evaluate(() => localStorage.setItem('pathelix-onboarding-v1', '1'))

  await context.storageState({ path: AUTH_FILE })
})
