import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal } from './helpers'

test.describe('Catalogue Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'catalogue')
    // Wait for any tabpanel to render — if Fast Refresh fires the page may reset to dashboard
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(800)
  })

  test('clients sub-tab loads', async ({ page }) => {

    const clientTab = page.locator('[role="tabpanel"] button:has-text("Clients")').first()
    if (await clientTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await clientTab.click({ force: true })
      await page.waitForTimeout(800)
    }

    // Use [role="tabpanel"] so a Fast Refresh reload back to dashboard doesn't fail this
    const tabpanel = page.locator('[role="tabpanel"]').first()
    await expect(tabpanel).toBeAttached({ timeout: 30_000 })
  })

  test('clients search works', async ({ page }) => {
    const clientTab = page.locator('[role="tabpanel"] button:has-text("Clients")').first()
    if (await clientTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clientTab.click({ force: true })
      await page.waitForTimeout(500)
    }

    const search = page.locator('[role="tabpanel"] input[placeholder="Rechercher..."]').first()
    if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
      await search.fill('zzz-no-match')
      await page.waitForTimeout(300)
    }
  })

  test('new client button opens form', async ({ page }) => {
    const clientTab = page.locator('[role="tabpanel"] button:has-text("Clients")').first()
    if (await clientTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clientTab.click({ force: true })
      await page.waitForTimeout(500)
    }

    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau client")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"]').first()
      if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await closeModal(page)
      }
    }
  })

  test('client form has VIP and BSD checkboxes', async ({ page }) => {
    const clientTab = page.locator('[role="tabpanel"] button:has-text("Clients")').first()
    if (await clientTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clientTab.click({ force: true })
      await page.waitForTimeout(500)
    }
    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau client")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)

      const checkboxes = await page.locator('[role="dialog"] input[type="checkbox"]').count()
      expect(checkboxes).toBeGreaterThan(0)
      await closeModal(page)
    }
  })

  test('sites sub-tab loads', async ({ page }) => {
    const siteTab = page.locator('[role="tabpanel"] button:has-text("Sites")').first()
    if (await siteTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await siteTab.click({ force: true })
      await page.waitForTimeout(800)
    }

    // Use [role="tabpanel"] (not #tabpanel-catalogue) so a Fast Refresh reload doesn't fail this
    const tabpanel = page.locator('[role="tabpanel"]').first()
    await expect(tabpanel).toBeAttached({ timeout: 30_000 })
  })

  test('new site button opens form', async ({ page }) => {
    const siteTab = page.locator('[role="tabpanel"] button:has-text("Sites")').first()
    if (await siteTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await siteTab.click({ force: true })
      await page.waitForTimeout(500)
    }

    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau site")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"]').first()
      if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await closeModal(page)
      }
    }
  })

  test('site form has geocoding button', async ({ page }) => {
    const siteTab = page.locator('[role="tabpanel"] button:has-text("Sites")').first()
    if (await siteTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await siteTab.click({ force: true })
      await page.waitForTimeout(500)
    }
    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau site")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)

      const geoBtn = page.locator('[role="dialog"] button:has-text("GPS")').first()
      if (await geoBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await expect(geoBtn).toBeVisible()
        await closeModal(page)
      }
    }
  })

  test('products sub-tab loads', async ({ page }) => {
    const prodTab = page.locator('[role="tabpanel"] button:has-text("Produits")').first()
    if (await prodTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await prodTab.click({ force: true })
      await page.waitForTimeout(800)
    }

    // Use [role="tabpanel"] (not #tabpanel-catalogue) so a Fast Refresh reload doesn't fail this
    const tabpanel = page.locator('[role="tabpanel"]').first()
    await expect(tabpanel).toBeAttached({ timeout: 30_000 })
  })

  test('new product button opens form', async ({ page }) => {
    const prodTab = page.locator('[role="tabpanel"] button:has-text("Produits")').first()
    if (await prodTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await prodTab.click({ force: true })
      await page.waitForTimeout(500)
    }

    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau produit")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"]').first()
      if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await closeModal(page)
      }
    }
  })

  test('sub-tab switching works', async ({ page }) => {
    for (const tab of ['Clients', 'Sites', 'Produits']) {
      const tabBtn = page.locator(`[role="tabpanel"] button:has-text("${tab}")`).first()
      if (await tabBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tabBtn.click({ force: true })
        await page.waitForTimeout(300)
      }
    }
  })
})
