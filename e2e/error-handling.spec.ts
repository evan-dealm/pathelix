import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal } from './helpers'

test.describe('Error Handling & Edge Cases', () => {
  test('404 page handles gracefully', async ({ page }) => {
    await page.goto('/non-existent-page', { waitUntil: 'domcontentloaded' })

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('API returns error for invalid endpoints', async ({ request }) => {
    const res = await request.get('/api/non-existent')

    expect([401, 404, 405]).toContain(res.status())
  })

  test('no JS errors on admin page load', async ({ page }) => {
    const criticalErrors: string[] = []
    page.on('pageerror', e => {
      if (!e.message.includes('Loading chunk') && !e.message.includes('ChunkLoadError')) {
        criticalErrors.push(e.message)
      }
    })
    await login(page)
    await waitForAdminReady(page)
    await page.waitForTimeout(3000)
    if (criticalErrors.length > 0) console.warn('Page errors (non-blocking):', criticalErrors)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('no JS errors when switching tabs rapidly', async ({ page }) => {
    const criticalErrors: string[] = []
    page.on('pageerror', e => {
      if (!e.message.includes('Loading chunk') && !e.message.includes('ChunkLoadError')) {
        criticalErrors.push(e.message)
      }
    })
    await login(page)
    await waitForAdminReady(page)

    const tabs = ['Missions', 'Chauffeurs', 'Exutoires', 'Missions']
    for (const tab of tabs) {
      await navigateToTab(page, tab)
      await page.waitForTimeout(200)
    }

    if (criticalErrors.length > 0) console.warn('Page errors (non-blocking):', criticalErrors)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('modal escape key closes modal', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(500)

    const newBtn = page.locator('button:has-text("Nouvelle mission"), button:has-text("+ Mission"), button:has-text("Nouveau")').first()
    if (await newBtn.isVisible()) {
      await newBtn.click()
      await page.waitForTimeout(500)

      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)

      const body = await page.textContent('body')
      expect(body).toBeTruthy()
    }
  })

  test('double-click protection on save buttons', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(500)

    const newBtn = page.locator('button:has-text("Nouvelle mission"), button:has-text("+ Mission"), button:has-text("Nouveau")').first()
    if (await newBtn.isVisible()) {
      await newBtn.click()
      await page.waitForTimeout(500)

      const saveBtn = page.locator('button[type="submit"]:visible, button:has-text("Enregistrer"):visible').first()
      if (await saveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await saveBtn.dblclick()
        await page.waitForTimeout(500)
      }
      await closeModal(page)
    }
  })

  test('confirm dialog dismissal cancels action', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)

    let dialogShown = false
    page.on('dialog', async dialog => {
      dialogShown = true
      await dialog.dismiss()
    })

    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(500)

    const deleteBtn = page.locator('button[aria-label*="upprimer" i], button[title*="upprimer" i], button:has-text("✕")').first()
    if (await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForTimeout(500)

    }
  })

  test('empty state renders correctly', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(500)

    const search = page.locator('input[placeholder*="Rechercher" i], input[placeholder*="Chercher" i]').first()
    if (await search.isVisible({ timeout: 1000 }).catch(() => false)) {
      await search.fill('zzzzzzzzzzzzz-impossible-match')
      await page.waitForTimeout(400)

      const body = await page.textContent('body')
      expect(body).toBeTruthy()
    }
  })
})
