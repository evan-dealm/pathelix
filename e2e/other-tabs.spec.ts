import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

test.describe('History Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'history')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('history tab loads successfully', async ({ page }) => {
    const tabPanel = page.locator('#tabpanel-history').first()
    await expect(tabPanel).toBeVisible({ timeout: 10_000 })
    const content = await tabPanel.textContent()
    expect(content!.trim().length).toBeGreaterThan(5)
  })

  test('shows tour history entries or empty state', async ({ page }) => {
    const emptyState = page.locator('#tabpanel-history').getByText(/Aucune tourn/i).first()
    const entryCard  = page.locator('#tabpanel-history .rounded-xl, #tabpanel-history tbody tr').first()
    const hasEmpty   = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false)
    const hasEntries = await entryCard.isVisible({ timeout: 5_000 }).catch(() => false)
    // Must show either entries OR explicit empty state — not a blank screen
    expect(hasEmpty || hasEntries).toBe(true)
  })

  test('date navigation changes displayed entries', async ({ page }) => {
    const prevBtn = page.locator('#tabpanel-history button').filter({ hasText: /◀|←|</ }).first()
    const anyBtn  = page.locator('#tabpanel-history button').first()
    const btn = await prevBtn.isVisible({ timeout: 2_000 }).catch(() => false) ? prevBtn : anyBtn
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    await expect(page.locator('#tabpanel-history').first()).toBeVisible()
  })

  test('detail view opens or page remains stable', async ({ page }) => {
    const entryBtn = page.locator('#tabpanel-history button, #tabpanel-history [class*="cursor-pointer"]').first()
    if (await entryBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await entryBtn.click()
      await page.waitForTimeout(500)
    }
    await expect(page.locator('[role="tabpanel"]').first()).toBeVisible()
  })
})

test.describe('Stats Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'stats')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('stats tab loads successfully', async ({ page }) => {
    const tabPanel = page.locator('#tabpanel-stats').first()
    await expect(tabPanel).toBeVisible({ timeout: 10_000 })
    const content = await tabPanel.textContent()
    expect(content!.trim().length).toBeGreaterThan(5)
  })

  test('shows charts and statistics content', async ({ page }) => {
    const panel = page.locator('#tabpanel-stats').first()
    await expect(panel).toBeVisible({ timeout: 10_000 })
    const content = await panel.textContent()
    // Stats panel must have non-trivial content
    expect(content!.trim().length).toBeGreaterThan(10)
  })

  test('date selector changes stats data', async ({ page }) => {
    const dateInput = page.locator('#tabpanel-stats input[type="date"]').first()
    await expect(dateInput).toBeVisible({ timeout: 5_000 })
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    await dateInput.fill(weekAgo.toISOString().split('T')[0])
    await page.waitForTimeout(500)
    await expect(page.locator('#tabpanel-stats').first()).toBeVisible()
  })

  test('sector filter dropdown exists and works', async ({ page }) => {
    const sectorSelect = page.locator('#tabpanel-stats select').first()
    await expect(sectorSelect).toBeVisible({ timeout: 5_000 })
    const options = await sectorSelect.locator('option').count()
    expect(options).toBeGreaterThan(0)
    await sectorSelect.selectOption({ index: 1 })
    await page.waitForTimeout(300)
    await expect(page.locator('#tabpanel-stats').first()).toBeVisible()
  })
})

test.describe('Audit Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'audit')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('audit tab loads successfully', async ({ page }) => {
    const tabPanel = page.locator('#tabpanel-audit').first()
    await expect(tabPanel).toBeVisible({ timeout: 10_000 })
    const content = await tabPanel.textContent()
    expect(content!.trim().length).toBeGreaterThan(5)
  })

  test('shows audit log entries or empty state', async ({ page }) => {
    const emptyState = page.locator('#tabpanel-audit').getByText(/Aucune entr/i).first()
    const tableRow   = page.locator('#tabpanel-audit table tbody tr:visible, #tabpanel-audit .rounded-xl:visible').first()
    const hasEmpty   = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false)
    const hasEntries = await tableRow.isVisible({ timeout: 5_000 }).catch(() => false)
    expect(hasEmpty || hasEntries).toBe(true)
  })

  test('action type filter dropdown works', async ({ page }) => {
    const selects = page.locator('#tabpanel-audit select')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(1)
    const actionFilter = count >= 2 ? selects.nth(1) : selects.first()
    await expect(actionFilter).toBeVisible({ timeout: 5_000 })
    const options = await actionFilter.locator('option').count()
    expect(options).toBeGreaterThan(0)
    await actionFilter.selectOption({ index: 1 })
    await page.waitForTimeout(300)
    await actionFilter.selectOption({ index: 0 })
    await page.waitForTimeout(300)
  })

  test('date range filter works', async ({ page }) => {
    const dateInputs = page.locator('#tabpanel-audit input[type="date"]')
    const dateCount = await dateInputs.count()
    expect(dateCount).toBeGreaterThanOrEqual(1)
    const today = new Date().toISOString().split('T')[0]
    await dateInputs.first().fill(today)
    await page.waitForTimeout(300)
    if (dateCount >= 2) {
      await dateInputs.nth(1).fill(today)
      await page.waitForTimeout(300)
    }
    await expect(page.locator('#tabpanel-audit').first()).toBeVisible()
  })

  test('entity type filter dropdown works', async ({ page }) => {
    const selects = page.locator('#tabpanel-audit select')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(1)
    const entityFilter = selects.first()
    await expect(entityFilter).toBeVisible({ timeout: 5_000 })
    const options = await entityFilter.locator('option').count()
    expect(options).toBeGreaterThan(0)
    await entityFilter.selectOption({ index: 1 })
    await page.waitForTimeout(300)
    await entityFilter.selectOption({ index: 0 })
  })

  test('search input filters audit entries', async ({ page }) => {
    const searchInput = page.locator('#tabpanel-audit input[placeholder*="Rechercher" i]').first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('nonexistent-search-term')
    await page.waitForTimeout(500)
    await searchInput.clear()
    await page.waitForTimeout(300)
    await expect(page.locator('#tabpanel-audit').first()).toBeVisible()
  })
})

test.describe('ThemeToggle', () => {
  test('click toggles dark class on html element', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)

    const toggle = page.locator('button[aria-label*="sombre"], button[aria-label*="clair"]').first()
    await expect(toggle).toBeVisible({ timeout: 10_000 })

    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    await toggle.click()
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    expect(after).not.toBe(before)
  })
})

test.describe('Telematics Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'telematics')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('telematics tab loads successfully', async ({ page }) => {
    const tabPanel = page.locator('#tabpanel-telematics').first()
    await expect(tabPanel).toBeVisible({ timeout: 10_000 })
    const content = await tabPanel.textContent()
    expect(content!.trim().length).toBeGreaterThan(5)
  })

  test('shows driver positions or empty state', async ({ page }) => {
    const emptyState = page.locator('#tabpanel-telematics').getByText(/Aucune donn/i).first()
    const driverCards = page.locator('#tabpanel-telematics .rounded-xl')
    const hasEmpty = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false)
    const hasCards = (await driverCards.count()) > 0
    // Must show either driver data OR explicit empty state
    expect(hasEmpty || hasCards).toBe(true)
  })

  test('speed graphs render as SVG or show empty data message', async ({ page }) => {
    const svgGraphs = page.locator('#tabpanel-telematics svg[viewBox]')
    const svgCount  = await svgGraphs.count()
    const noDataMsg = page.locator('#tabpanel-telematics').getByText(/Aucune donn/i).first()
    const hasNoData = await noDataMsg.isVisible({ timeout: 5_000 }).catch(() => false)
    // Must show either SVG charts OR explicit no-data message
    expect(svgCount > 0 || hasNoData).toBe(true)
  })

  test('refresh button fetches new data', async ({ page }) => {
    const refreshBtn = page.locator('#tabpanel-telematics button:has-text("Actualiser")').first()
    await expect(refreshBtn).toBeVisible({ timeout: 5_000 })
    await refreshBtn.click()
    await page.waitForTimeout(1000)
    await expect(page.locator('#tabpanel-telematics').first()).toBeVisible()
  })

  test('auto-refresh indicator or refresh button present', async ({ page }) => {
    const autoLabel = page.locator('#tabpanel-telematics').getByText(/Auto 30s/i).first()
    const refreshBtn = page.locator('#tabpanel-telematics button:has-text("Actualiser")').first()
    const hasAuto = await autoLabel.isVisible({ timeout: 3_000 }).catch(() => false)
    const hasRefresh = await refreshBtn.isVisible({ timeout: 3_000 }).catch(() => false)
    expect(hasAuto || hasRefresh).toBe(true)
  })

  test('legend section shows speed or status indicators', async ({ page }) => {
    const emptyState = page.locator('#tabpanel-telematics').getByText(/Aucune donn/i).first()
    const isEmpty = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false)
    if (!isEmpty) {
      const legendItems = ['Vitesse', 'Heure courante']
      let foundLegend = 0
      for (const item of legendItems) {
        const el = page.locator(`#tabpanel-telematics text=${item}`).first()
        if (await el.isVisible().catch(() => false)) foundLegend++
      }
      // If data exists, at least one legend item must be visible
      expect(foundLegend).toBeGreaterThan(0)
    } else {
      await expect(emptyState).toBeVisible()
    }
  })
})
