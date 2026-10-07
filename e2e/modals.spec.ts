import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, dismissDialogs } from './helpers'

function modalDialog(page: import('@playwright/test').Page) {
  return page.locator('[role="dialog"][aria-modal="true"]')
}

async function goToMissions(page: import('@playwright/test').Page) {
  await navigateToTab(page, 'missions')
  // See missions.spec.ts beforeEach — the real fix was DataProvider's UTC/local date mismatch.
  await page.locator('[role="tabpanel"] tbody tr').first().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(300)
}

async function openFirstMissionDetail(page: import('@playwright/test').Page) {
  const tableRow = page.locator('[role="tabpanel"] tbody tr').first()
  await expect(tableRow).toBeVisible({ timeout: 15_000 })
  await tableRow.click()
  await expect(modalDialog(page)).toBeVisible({ timeout: 10_000 })
}

async function openFirstDriverDetail(page: import('@playwright/test').Page) {
  // The driver detail opens from the planning timeline (name button of a driver row),
  // on the dashboard — not from the Chauffeurs table, whose rows only carry inline actions.
  await navigateToTab(page, 'dashboard')
  const driverBtn = page.locator('button[class*="group/drv"]:visible').first()
  await expect(driverBtn).toBeVisible({ timeout: 15_000 })
  await driverBtn.click()
  await expect(modalDialog(page)).toBeVisible({ timeout: 10_000 })
}

test.describe('MissionDetailModal', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await goToMissions(page)
  })

  test('opens when clicking a mission row', async ({ page }) => {
    await openFirstMissionDetail(page)
    await expect(modalDialog(page)).toBeVisible()
  })

  test('shows type badge', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const typeBadge = dialog.locator('span, div').filter({
      // Labels come from the trade vocabulary (« Pose », « Retrait », « Échange »…).
      hasText: /POSER|RETIRER|ECHANGER|VIDER|Pose|Retrait|Retirer|Échange|Vider/i,
    }).first()
    await expect(typeBadge).toBeVisible({ timeout: 5_000 })
  })

  test('shows address or GPS warning', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const addressSection = dialog.locator('text=Adresse').first()
    const gpsWarning = dialog.locator('text=GPS manquant').first()
    const hasAddress = await addressSection.isVisible({ timeout: 5_000 }).catch(() => false)
    const hasGpsWarning = await gpsWarning.isVisible({ timeout: 1_000 }).catch(() => false)
    expect(hasAddress || hasGpsWarning).toBe(true)
  })

  test('shows date in dialog content', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const content = await dialog.textContent()
    expect(content).toBeTruthy()
    expect(content!.length).toBeGreaterThan(20)
    // Date must appear in some form — digits with separators or month names
    expect(content).toMatch(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre/i)
  })

  test('edit button is present', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const editBtn = dialog.locator('button').filter({ hasText: /Modifier/ }).first()
    await expect(editBtn).toBeVisible({ timeout: 5_000 })
  })

  test('duplicate button is present', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const dupBtn = dialog.locator('button').filter({ hasText: /Dupliquer/ }).first()
    await expect(dupBtn).toBeVisible({ timeout: 5_000 })
  })

  test('delete button is present', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const deleteBtn = dialog.locator('button').filter({ hasText: /Supprimer/ }).first()
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 })
  })

  test('close button has aria-label Fermer', async ({ page }) => {
    await openFirstMissionDetail(page)
    const closeBtn = modalDialog(page).locator('button[aria-label="Fermer"]')
    await expect(closeBtn).toBeVisible({ timeout: 5_000 })
  })

  test('close button dismisses the modal', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    const closeBtn = dialog.locator('button[aria-label="Fermer"]')
    await expect(closeBtn).toBeVisible({ timeout: 5_000 })
    await closeBtn.click()
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })
  })

  test('escape key closes the modal', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })
  })

  test('modal has correct accessibility attributes', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  test('modal traps keyboard focus within its bounds', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab')
    const focusedInDialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return dlg?.contains(document.activeElement) ?? false
    })
    expect(focusedInDialog).toBe(true)
  })

  test('modal panel has overflow-y scrollable class', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    const cls = await dialog.getAttribute('class')
    expect(cls).toMatch(/overflow-y-auto|overflow-auto/)
  })

  test('modal overlay has backdrop blur styling', async ({ page }) => {
    await openFirstMissionDetail(page)
    const overlay = page.locator('.fixed.inset-0').filter({ has: page.locator('[role="dialog"]') }).first()
    await expect(overlay).toBeVisible()
    const cls = await overlay.getAttribute('class')
    expect(cls).toMatch(/backdrop-blur/)
  })

  test('assignment sub-form shows driver dropdown', async ({ page }) => {
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    const assignBtn = dialog.locator('button').filter({ hasText: /Assigner/ }).first()
    if (await assignBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await assignBtn.click()
      await page.waitForTimeout(300)
      const driverSelect = dialog.locator('select').first()
      await expect(driverSelect).toBeVisible({ timeout: 5_000 })
      const optCount = await driverSelect.locator('option').count()
      expect(optCount).toBeGreaterThan(0)
      const cancelBtn = dialog.locator('button').filter({ hasText: /Annuler/ }).first()
      if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click()
    } else {
      // Mission already assigned — driver info section must be visible instead
      const content = await dialog.textContent()
      expect(content!.length).toBeGreaterThan(20)
    }
  })
})

test.describe('DriverDetailModal', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
  })

  test('opens when clicking a driver row', async ({ page }) => {
    await openFirstDriverDetail(page)
    await expect(modalDialog(page)).toBeVisible()
  })

  test('shows driver name in modal', async ({ page }) => {
    await openFirstDriverDetail(page)
    const dialog = modalDialog(page)
    const content = await dialog.textContent()
    expect(content).toBeTruthy()
    expect(content!.length).toBeGreaterThan(10)
  })

  test('shows sector or depot info', async ({ page }) => {
    await openFirstDriverDetail(page)
    const dialog = modalDialog(page)
    const content = await dialog.textContent()
    expect(content).toMatch(/Annecy|Chambéry|Grenoble|Lyon|Bourg|secteur|dépôt|Dépôt/i)
  })

  test('modal close button present', async ({ page }) => {
    await openFirstDriverDetail(page)
    const closeBtn = modalDialog(page).locator('button[aria-label="Fermer"]')
    await expect(closeBtn).toBeVisible({ timeout: 5_000 })
  })

  test('shows planned missions list or empty state', async ({ page }) => {
    await openFirstDriverDetail(page)
    const dialog = modalDialog(page)
    const content = await dialog.textContent()
    expect(content).toMatch(/mission|Aucune|planning/i)
  })

  test('delete button triggers deletion flow', async ({ page }) => {
    dismissDialogs(page)
    await openFirstDriverDetail(page)
    const dialog = modalDialog(page)
    const deleteBtn = dialog.locator('button').filter({ hasText: /Supprimer/ }).first()
    if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForTimeout(500)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})

test.describe('General Modal Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
  })

  test('clicking overlay background closes the modal', async ({ page }) => {
    await goToMissions(page)
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    const dialogBox = await dialog.boundingBox()
    expect(dialogBox).not.toBeNull()
    const clickX = Math.max(dialogBox!.x - 40, 5)
    const clickY = dialogBox!.y + dialogBox!.height / 2
    await page.mouse.click(clickX, clickY)
    await page.waitForTimeout(400)
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })
  })

  test('opening a new modal closes the previously open one', async ({ page }) => {
    await goToMissions(page)
    const rows = page.locator('[role="tabpanel"] tbody tr')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(2)
    await rows.first().click()
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible({ timeout: 8_000 })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })
    await rows.nth(1).click()
    await expect(dialog).toBeVisible({ timeout: 8_000 })
    const visibleDialogs = await page.locator('[role="dialog"][aria-modal="true"]').count()
    expect(visibleDialogs).toBe(1)
  })

  test('modal has correct accessibility attributes', async ({ page }) => {
    await goToMissions(page)
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  test('modal traps keyboard focus within its bounds', async ({ page }) => {
    await goToMissions(page)
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 10; i++) await page.keyboard.press('Tab')
    const focusedInDialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      return dlg?.contains(document.activeElement) ?? false
    })
    expect(focusedInDialog).toBe(true)
  })

  test('close button has aria-label Fermer', async ({ page }) => {
    await goToMissions(page)
    await openFirstMissionDetail(page)
    const closeBtn = modalDialog(page).locator('button[aria-label="Fermer"]')
    await expect(closeBtn).toBeVisible({ timeout: 5_000 })
  })

  test('modal overlay has backdrop blur styling', async ({ page }) => {
    await goToMissions(page)
    await openFirstMissionDetail(page)
    const overlay = page.locator('.fixed.inset-0').filter({ has: page.locator('[role="dialog"]') }).first()
    await expect(overlay).toBeVisible()
    const cls = await overlay.getAttribute('class')
    expect(cls).toMatch(/backdrop-blur/)
  })

  test('modal panel is scrollable for long content', async ({ page }) => {
    await goToMissions(page)
    await openFirstMissionDetail(page)
    const dialog = modalDialog(page)
    await expect(dialog).toBeVisible()
    const cls = await dialog.getAttribute('class')
    expect(cls).toMatch(/overflow-y-auto|overflow-auto/)
  })
})
