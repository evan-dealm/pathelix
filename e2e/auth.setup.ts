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

  await context.storageState({ path: AUTH_FILE })
})
