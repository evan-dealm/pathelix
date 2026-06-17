import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('text=PATHÉLIX').first()).toBeVisible()
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('login page has no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })

  test('shows error with wrong credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.locator('button[type="submit"]:has-text("Se connecter")').waitFor({ state: 'visible' })
    await page.waitForTimeout(500)
    await page.locator('#email').fill('wrong@test.com')
    await page.locator('#password').fill('wrongpassword123')
    await page.locator('button[type="submit"]').click({ noWaitAfter: true })

    await page.waitForTimeout(3000)
    expect(page.url()).toContain('login')
  })

  test('unauthenticated /admin redirects to /login', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/login/, { timeout: 30_000 })
    expect(page.url()).toContain('login')
  })

  test('password field masks input', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#password')).toHaveAttribute('type', 'password')
  })
})
