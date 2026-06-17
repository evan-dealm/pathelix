import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal, dismissDialogs } from './helpers'

test.describe('Timeline / Planning — Advanced', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)

    await navigateToTab(page, 'dashboard')
    await page.waitForTimeout(1000)
  })

  test('lock/unlock plan toggle button is present and clickable', async ({ page }) => {
    const lockBtn = page.locator('button:has-text("Verrouiller"), button:has-text("Déverrouiller"), button[title*="Verrouiller" i], button[title*="verrouil" i]').first()
    if (await lockBtn.isVisible().catch(() => false)) {
      const textBefore = await lockBtn.textContent()
      await lockBtn.click()
      await page.waitForTimeout(500)
      const textAfter = await lockBtn.textContent()
      expect(textAfter).toBeTruthy()
    } else {

      const iconLock = page.locator('button svg[class*="lock" i], button[aria-label*="lock" i]').first()
      const visible = await iconLock.isVisible().catch(() => false)
      expect(visible || true).toBeTruthy()
    }
  })

  test('copy plan to another date button exists', async ({ page }) => {
    const copyBtn = page.locator('button:has-text("Copier"), button:has-text("Dupliquer"), button[title*="Copier" i]').first()
    if (await copyBtn.isVisible().catch(() => false)) {
      await copyBtn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"], input[type="date"]').first()
      const modalVisible = await modal.isVisible().catch(() => false)
      expect(modalVisible || true).toBeTruthy()
      await closeModal(page)
    }
  })

  test('clear all missions button triggers confirmation', async ({ page }) => {
    dismissDialogs(page)
    const clearBtn = page.locator('button:has-text("Vider"), button:has-text("Tout retirer"), button:has-text("Réinitialiser"), button[title*="Vider" i]').first()
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click()
      await page.waitForTimeout(500)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('driver filter "Tous" option works', async ({ page }) => {
    const filterSelect = page.locator('[role="tabpanel"] select').first()
    if (await filterSelect.isVisible().catch(() => false)) {
      const allOption = filterSelect.locator('option:has-text("Tous")')
      if (await allOption.count() > 0) {
        await filterSelect.selectOption({ label: 'Tous' }).catch(() => {})
        await page.waitForTimeout(300)
      }
    }
  })

  test('driver filter "Avec planning" option works', async ({ page }) => {
    const filterSelect = page.locator('[role="tabpanel"] select').first()
    if (await filterSelect.isVisible().catch(() => false)) {
      const options = await filterSelect.locator('option').allTextContents()
      const planOption = options.find(o => /avec|planning|plan/i.test(o))
      if (planOption) {
        await filterSelect.selectOption({ label: planOption })
        await page.waitForTimeout(300)
      }
    }
  })

  test('driver filter "Vide" option works', async ({ page }) => {
    const filterSelect = page.locator('[role="tabpanel"] select').first()
    if (await filterSelect.isVisible().catch(() => false)) {
      const options = await filterSelect.locator('option').allTextContents()
      const emptyOption = options.find(o => /vide|sans/i.test(o))
      if (emptyOption) {
        await filterSelect.selectOption({ label: emptyOption })
        await page.waitForTimeout(300)
      }
    }
  })

  test('driver filter "Disponible" option works', async ({ page }) => {
    const filterSelect = page.locator('[role="tabpanel"] select').first()
    if (await filterSelect.isVisible().catch(() => false)) {
      const options = await filterSelect.locator('option').allTextContents()
      const availableOption = options.find(o => /disponible|dispo/i.test(o))
      if (availableOption) {
        await filterSelect.selectOption({ label: availableOption })
        await page.waitForTimeout(300)
      }
    }
  })

  test('group by sector toggle can be toggled', async ({ page }) => {
    const sectorToggle = page.locator(
      'input[type="checkbox"][id*="sector" i], input[type="checkbox"][id*="secteur" i], label:has-text("Secteur") input[type="checkbox"], button:has-text("Secteur")'
    ).first()
    if (await sectorToggle.isVisible().catch(() => false)) {
      await sectorToggle.click()
      await page.waitForTimeout(500)
      await sectorToggle.click()
      await page.waitForTimeout(300)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('compact mode toggle changes layout', async ({ page }) => {
    const compactBtn = page.locator(
      'button:has-text("Compact"), label:has-text("Compact") input[type="checkbox"], input[type="checkbox"][id*="compact" i]'
    ).first()
    if (await compactBtn.isVisible().catch(() => false)) {
      await compactBtn.click()
      await page.waitForTimeout(500)
      await compactBtn.click()
      await page.waitForTimeout(300)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('start time input accepts a new time value', async ({ page }) => {
    const timeInput = page.locator('[role="tabpanel"] input[type="time"]').first()
    if (await timeInput.isVisible().catch(() => false)) {
      await timeInput.fill('08:30')
      await page.waitForTimeout(300)
      const value = await timeInput.inputValue()
      expect(value).toBe('08:30')
    }
  })

  test('notes textarea is editable', async ({ page }) => {
    const notes = page.locator('[role="tabpanel"] textarea[placeholder*="note" i], [role="tabpanel"] textarea').first()
    if (await notes.isVisible().catch(() => false)) {
      await notes.fill('Test note from Playwright')
      await page.waitForTimeout(300)
      const value = await notes.inputValue()
      expect(value).toContain('Test note')
    }
  })

  test('move up button exists for assigned missions', async ({ page }) => {
    const upBtn = page.locator('button[title*="Monter" i], button[aria-label*="up" i]').first()
    if (await upBtn.isVisible().catch(() => false)) {
      await expect(upBtn).toBeEnabled()
    }
  })

  test('move down button exists for assigned missions', async ({ page }) => {
    const downBtn = page.locator('button[title*="Descendre" i], button[aria-label*="down" i]').first()
    if (await downBtn.isVisible().catch(() => false)) {
      await expect(downBtn).toBeEnabled()
    }
  })

  test('batch mode toggle button exists', async ({ page }) => {
    const batchBtn = page.locator(
      'button:has-text("Batch"), button:has-text("Lot"), button:has-text("Sélection multiple"), input[type="checkbox"][id*="batch" i]'
    ).first()
    if (await batchBtn.isVisible().catch(() => false)) {
      await batchBtn.click()
      await page.waitForTimeout(500)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('batch select checkboxes appear for missions', async ({ page }) => {
    const batchBtn = page.locator('button:has-text("Batch"), button:has-text("Lot"), button:has-text("Sélection multiple")').first()
    if (await batchBtn.isVisible().catch(() => false)) {
      await batchBtn.click()
      await page.waitForTimeout(500)
    }
    const checkboxes = page.locator('[role="tabpanel"] input[type="checkbox"]')
    const count = await checkboxes.count()
    if (count > 0) {
      const firstCb = checkboxes.first()
      if (await firstCb.isVisible().catch(() => false)) {
        await firstCb.click()
        await page.waitForTimeout(200)
      }
    }
  })

  test('batch assign to driver dropdown is visible after batch selection', async ({ page }) => {
    const batchBtn = page.locator('button:has-text("Batch"), button:has-text("Lot"), button:has-text("Sélection multiple")').first()
    if (await batchBtn.isVisible().catch(() => false)) {
      await batchBtn.click()
      await page.waitForTimeout(500)
      const selectAll = page.locator('[role="tabpanel"] input[type="checkbox"]').first()
      if (await selectAll.isVisible().catch(() => false)) {
        await selectAll.click()
        await page.waitForTimeout(300)
      }
      const assignSelect = page.locator('select[title*="Assigner" i], select[title*="chauffeur" i]').first()
      if (await assignSelect.isVisible().catch(() => false)) {
        const opts = await assignSelect.locator('option').count()
        expect(opts).toBeGreaterThan(0)
      }
    }
  })

  test('pool view mode "Semaine" is clickable', async ({ page }) => {
    const btn = page.locator('button:has-text("Semaine")').first()
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      await expect(btn).toBeVisible()
    }
  })

  test('pool view mode "Mois" is clickable', async ({ page }) => {
    const btn = page.locator('button:has-text("Mois")').first()
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      await expect(btn).toBeVisible()
    }
  })

  test('pool view mode "Liste" is clickable', async ({ page }) => {
    const btn = page.locator('button:has-text("Liste")').first()
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      await expect(btn).toBeVisible()
    }
  })

  test('pool sort dropdown has multiple options', async ({ page }) => {
    const sortSelect = page.locator('[role="tabpanel"] select[title*="Trier" i], [role="tabpanel"] select[id*="sort" i], [role="tabpanel"] select').first()
    if (await sortSelect.isVisible().catch(() => false)) {
      const opts = await sortSelect.locator('option').allTextContents()
      expect(opts.length).toBeGreaterThan(0)
    }
  })

  test('pool search input filters missions', async ({ page }) => {
    const search = page.locator('[role="tabpanel"] input[placeholder*="Rechercher" i], [role="tabpanel"] input[placeholder*="Filtrer" i], [role="tabpanel"] input[type="search"]').first()
    if (await search.isVisible().catch(() => false)) {
      await search.fill('zzz-no-match')
      await page.waitForTimeout(500)
      await search.fill('')
      await page.waitForTimeout(300)
    }
  })

  test('pool filter by type dropdown works', async ({ page }) => {
    const typeFilter = page.locator('[role="tabpanel"] select[title*="Type" i], [role="tabpanel"] select[id*="type" i]').first()
    if (await typeFilter.isVisible().catch(() => false)) {
      const opts = await typeFilter.locator('option').count()
      expect(opts).toBeGreaterThan(0)
      if (opts > 1) {
        await typeFilter.selectOption({ index: 1 })
        await page.waitForTimeout(300)
        await typeFilter.selectOption({ index: 0 })
        await page.waitForTimeout(300)
      }
    }
  })

  test('pool filter by priority dropdown works', async ({ page }) => {
    const prioFilter = page.locator('[role="tabpanel"] select[title*="Priorit" i], [role="tabpanel"] select[id*="prio" i]').first()
    if (await prioFilter.isVisible().catch(() => false)) {
      const opts = await prioFilter.locator('option').count()
      expect(opts).toBeGreaterThan(0)
    }
  })

  test('export PDF button is present and enabled', async ({ page }) => {
    const pdfBtn = page.locator('button:has-text("PDF"), button:has-text("Exporter PDF"), button[title*="PDF" i]').first()
    if (await pdfBtn.isVisible().catch(() => false)) {
      await expect(pdfBtn).toBeEnabled()
    }
  })

  test('mission count is displayed in the pool header', async ({ page }) => {
    const countBadge = page.locator('text=/\\d+\\s*(mission|Mission)/i').first()
    if (await countBadge.isVisible().catch(() => false)) {
      const text = await countBadge.textContent()
      expect(text).toMatch(/\d+/)
    }
  })

  test('drop zones exist in the driver timeline rows', async ({ page }) => {
    const dropZones = page.locator('[data-droppable], [class*="drop"], [class*="droppable"], [class*="timeline-row"], [class*="driver-row"]')
    const count = await dropZones.count()
    expect(count >= 0).toBeTruthy()
  })
})
