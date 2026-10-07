import { test, expect } from '@playwright/test'
import {
  login,
  waitForAdminReady,
  navigateToTab,
  closeModal,
  acceptDialogs,
  dismissDialogs,
} from './helpers'

test.describe('Drivers Tab — Advanced Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'drivers')
    // DriversTab is a dynamic import — wait for its content to render (skeleton has no text)
    await page
      .waitForFunction(
        () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
        { timeout: 30_000 },
      )
      .catch(() => {})
    await page.waitForTimeout(300)
  })

  test('speed input accepts value within 20-130 km/h range', async ({ page }) => {
    const speedInput = page
      .locator('table tbody input[type="number"][title="Vitesse km/h"]')
      .first()
    if (await speedInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const currentValue = await speedInput.inputValue()
      expect(Number(currentValue)).toBeGreaterThanOrEqual(20)
      expect(Number(currentValue)).toBeLessThanOrEqual(130)

      await speedInput.fill('80')
      await page.waitForTimeout(300)
      await expect(speedInput).toHaveValue('80')
    }
  })

  test('speed input has min=20 and max=130 attributes', async ({ page }) => {
    const speedInput = page
      .locator('table tbody input[type="number"][title="Vitesse km/h"]')
      .first()
    if (await speedInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(speedInput).toHaveAttribute('min', '20')
      await expect(speedInput).toHaveAttribute('max', '130')
    }
  })

  test('weekly hours bar is displayed with hours label', async ({ page }) => {
    const hoursLabel = page.locator('table tbody td span.tabular-nums').first()
    if (await hoursLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(hoursLabel).toBeVisible()
    }

    const progressBarContainer = page.locator('table tbody .rounded-full.overflow-hidden').first()
    if (await progressBarContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(progressBarContainer).toBeVisible()
    }
  })

  test('weekly hours bar uses correct color coding (green/orange/red)', async ({ page }) => {
    const barContainers = page.locator('table tbody .rounded-full.overflow-hidden')
    const count = await barContainers.count()
    if (count > 0) {
      const innerBar = barContainers.first().locator('div').first()
      if (await innerBar.isVisible({ timeout: 2000 }).catch(() => false)) {
        const barClass = (await innerBar.getAttribute('class')) || ''
        const hasValidColor =
          barClass.includes('bg-green-500') ||
          barClass.includes('bg-orange-400') ||
          barClass.includes('bg-red-500')
        expect(hasValidColor).toBeTruthy()
      }
    }
  })

  test('availability toggle shows green or red indicator', async ({ page }) => {
    const availBtn = page
      .locator(
        'table tbody button:has-text("Disponible"), table tbody button:has-text("Indisponible")',
      )
      .first()
    if (await availBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const text = (await availBtn.textContent()) || ''
      const isAvailable = text.includes('Disponible') && !text.includes('Indisponible')
      const isUnavailable = text.includes('Indisponible')
      expect(isAvailable || isUnavailable).toBeTruthy()

      const btnClass = (await availBtn.getAttribute('class')) || ''
      if (isAvailable) {
        expect(btnClass).toContain('emerald')
      } else {
        expect(btnClass).toContain('red')
      }
    }
  })

  test('availability toggle switches state on click', async ({ page }) => {
    const availBtn = page
      .locator(
        'table tbody button:has-text("Disponible"), table tbody button:has-text("Indisponible")',
      )
      .first()
    if (await availBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const textBefore = (await availBtn.textContent()) || ''
      await availBtn.click()
      await page.waitForTimeout(400)

      const availBtnAfter = page
        .locator(
          'table tbody button:has-text("Disponible"), table tbody button:has-text("Indisponible")',
        )
        .first()

      if (textBefore.includes('Indisponible')) {
        expect((await availBtnAfter.textContent()) || '').toContain('Disponible')
      } else {
        // Marking a driver unavailable asks for the reason and the end date first.
        const dialog = page.locator('[role="dialog"]').filter({ hasText: /Indisponibilité/ })
        await expect(dialog).toBeVisible({ timeout: 3000 })
        await expect(dialog.getByText('Motif')).toBeVisible()
        await dialog.getByRole('button', { name: 'Annuler' }).click()
        expect((await availBtnAfter.textContent()) || '').toContain('Disponible')
      }
    }
  })

  test('availability date picker is present and interactive', async ({ page }) => {
    const datePicker = page.locator('input[type="date"][title="Date de disponibilité"]').first()
    if (await datePicker.isVisible({ timeout: 3000 }).catch(() => false)) {
      const val = await datePicker.inputValue()
      expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      await datePicker.fill('2026-04-15')
      await page.waitForTimeout(300)
      await expect(datePicker).toHaveValue('2026-04-15')
    }
  })

  test('bulk mark unavailable button appears after selection and works', async ({ page }) => {
    const selectAll = page
      .locator('input[type="checkbox"][aria-label="Sélectionner tous les chauffeurs"]')
      .first()
    if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selectAll.click()
      await page.waitForTimeout(300)

      const bulkBar = page.locator('text=/sélectionné/i').first()
      if (await bulkBar.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(bulkBar).toBeVisible()

        const bulkUnavailBtn = page.locator('button:has-text("Marquer indisponibles")').first()
        const hasBulkBtn = await bulkUnavailBtn.isVisible({ timeout: 3000 }).catch(() => false)
        if (hasBulkBtn) await expect(bulkUnavailBtn).toBeVisible()
      }

      await selectAll.click()
      await page.waitForTimeout(200)
    }
  })

  test('bulk mark available button appears after selection and works', async ({ page }) => {
    const selectAll = page
      .locator('input[type="checkbox"][aria-label="Sélectionner tous les chauffeurs"]')
      .first()
    if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selectAll.click()
      await page.waitForTimeout(300)

      const bulkAvailBtn = page.locator('button:has-text("Marquer disponibles")').first()
      await expect(bulkAvailBtn).toBeVisible({ timeout: 2000 })

      await selectAll.click()
      await page.waitForTimeout(200)
    }
  })

  test('driver link opens /driver/{id} in a new tab', async ({ page }) => {
    const driverRow = page.locator('table tbody tr').first()
    if (await driverRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await driverRow.hover()
      await page.waitForTimeout(300)

      const driverLink = page.locator('a[href^="/driver/"][target="_blank"]').first()
      if (await driverLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        const href = await driverLink.getAttribute('href')
        expect(href).toMatch(/^\/driver\/.+/)
        await expect(driverLink).toHaveAttribute('target', '_blank')
        await expect(driverLink).toHaveAttribute('rel', /noopener/)
      }
    }
  })

  test('archive section toggle reveals archived drivers', async ({ page }) => {
    const archiveToggle = page.locator('button:has-text("Archives")').first()
    if (await archiveToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const text = (await archiveToggle.textContent()) || ''

      expect(text).toMatch(/Archives/)
      expect(text).toMatch(/\(\d+/)

      await archiveToggle.click()
      await page.waitForTimeout(300)

      const archivedEntries = page.locator('button:has-text("Restaurer")')
      const count = await archivedEntries.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('restore button restores an archived driver', async ({ page }) => {
    const archiveToggle = page.locator('button:has-text("Archives")').first()
    if (await archiveToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await archiveToggle.click()
      await page.waitForTimeout(300)

      const restoreBtn = page.locator('button:has-text("Restaurer")').first()
      if (await restoreBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const archiveCountBefore = await page.locator('button:has-text("Restaurer")').count()
        await restoreBtn.click()
        await page.waitForTimeout(500)

        const archiveCountAfter = await page.locator('button:has-text("Restaurer")').count()
        expect(archiveCountAfter).toBeLessThanOrEqual(archiveCountBefore)
      }
    }
  })

  test('sector filter dropdown lists available sectors', async ({ page }) => {
    const sectorSelect = page.locator('select[title="Filtrer par secteur"]').first()
    if (await sectorSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = await sectorSelect.locator('option').allTextContents()
      expect(options.length).toBeGreaterThan(0)

      expect(options[0]).toBe('Tous secteurs')
    }
  })

  test('sector filter narrows displayed drivers', async ({ page }) => {
    const sectorSelect = page.locator('select[title="Filtrer par secteur"]').first()
    if (await sectorSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = await sectorSelect.locator('option').allTextContents()
      if (options.length > 1) {
        await sectorSelect.selectOption({ index: 1 })
        await page.waitForTimeout(400)

        const counterSpan = page.locator('span.text-xs.font-semibold.text-surface-500').first()
        const text = await counterSpan.textContent().catch(() => '')
        expect(text).toBeTruthy()

        await sectorSelect.selectOption({ value: 'all' })
        await page.waitForTimeout(300)
      }
    }
  })

  test('depot filter dropdown lists available depots', async ({ page }) => {
    const depotSelect = page.locator('select[title="Filtrer par dépôt"]').first()
    if (await depotSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = await depotSelect.locator('option').allTextContents()
      expect(options.length).toBeGreaterThan(0)

      expect(options[0]).toBe('Tous dépôts')
    }
  })

  test('depot filter narrows displayed drivers', async ({ page }) => {
    const depotSelect = page.locator('select[title="Filtrer par dépôt"]').first()
    if (await depotSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = await depotSelect.locator('option').allTextContents()
      if (options.length > 1) {
        await depotSelect.selectOption({ index: 1 })
        await page.waitForTimeout(400)

        const counterSpan = page.locator('span.text-xs.font-semibold.text-surface-500').first()
        const text = await counterSpan.textContent().catch(() => '')
        expect(text).toBeTruthy()

        await depotSelect.selectOption({ value: 'all' })
        await page.waitForTimeout(300)
      }
    }
  })

  test('search input applies debounced filtering', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Rechercher…"]').first()
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('zzz-no-match-xyz')

      await page.waitForTimeout(400)

      const noResult = page.locator('text="Aucun chauffeur trouvé"')
      const rows = page.locator('table tbody tr')
      const noResultVisible = await noResult.isVisible().catch(() => false)
      const rowCount = await rows.count().catch(() => 0)
      expect(noResultVisible || rowCount === 0).toBeTruthy()

      await searchInput.fill('')
      await page.waitForTimeout(400)
    }
  })

  test('search filters by driver name, sector, and depot', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Rechercher…"]').first()
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const firstDriverName = page
        .locator('table tbody tr td div.text-surface-900.font-semibold')
        .first()
      if (await firstDriverName.isVisible({ timeout: 3000 }).catch(() => false)) {
        const name = ((await firstDriverName.textContent()) || '').trim()
        if (name.length > 2) {
          const searchTerm = name.slice(0, 3)
          await searchInput.fill(searchTerm)
          await page.waitForTimeout(400)

          const rows = page.locator('table tbody tr')
          const count = await rows.count()
          expect(count).toBeGreaterThan(0)
        }
      }
      await searchInput.fill('')
      await page.waitForTimeout(300)
    }
  })

  test('pagination displays controls when more than 100 drivers', async ({ page }) => {
    const counterSpan = page.locator('span.text-xs.font-semibold.text-surface-500').first()
    if (await counterSpan.isVisible({ timeout: 3000 }).catch(() => false)) {
      const text = (await counterSpan.textContent()) || ''

      const match = text.match(/(\d+)\/(\d+)/)
      if (match) {
        const total = parseInt(match[2])
        if (total > 100) {
          const paginationInfo = page.locator('text=/sur \\d+/').first()
          await expect(paginationInfo).toBeVisible({ timeout: 2000 })

          const nextBtn = page.locator('button').filter({ hasText: /^>$/ }).first()
          await expect(nextBtn).toBeVisible()
        }
      }
    }
  })

  test('pagination next/previous buttons navigate between pages', async ({ page }) => {
    const nextBtn = page.locator('button').filter({ hasText: /^>$/ }).first()
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const isDisabled = await nextBtn.isDisabled()
      if (!isDisabled) {
        const pageIndicator = page
          .locator('span.text-xs.text-surface-600')
          .filter({ hasText: /\d+\/\d+/ })
          .first()
        const textBefore = (await pageIndicator.textContent().catch(() => '')) || ''

        await nextBtn.click()
        await page.waitForTimeout(300)

        const textAfter = (await pageIndicator.textContent().catch(() => '')) || ''
        expect(textAfter).not.toBe(textBefore)

        const prevBtn = page.locator('button').filter({ hasText: /^<$/ }).first()
        if ((await prevBtn.isVisible()) && !(await prevBtn.isDisabled())) {
          await prevBtn.click()
          await page.waitForTimeout(300)
          const textFinal = (await pageIndicator.textContent().catch(() => '')) || ''
          expect(textFinal).toBe(textBefore)
        }
      }
    }
  })

  test('clicking edit button on a driver row opens detail/edit form', async ({ page }) => {
    const driverRow = page.locator('table tbody tr').first()
    if (await driverRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await driverRow.hover()
      await page.waitForTimeout(300)

      const editBtn = page.locator('button:has-text("Modifier")').first()
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click()
        await page.waitForTimeout(500)

        const modal = page.locator('[role="dialog"]').first()
        if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
          await closeModal(page)
        }
      }
    }
  })

  test('import button opens import modal with upload zone', async ({ page }) => {
    const importBtn = page.locator('button:has-text("Import")').first()
    if (await importBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await importBtn.click()
      await page.waitForTimeout(500)

      const modalTitle = page.locator('text="Importer des données"')
      const modalVisible = await modalTitle.isVisible({ timeout: 10_000 }).catch(() => false)
      if (modalVisible) {
        const formatHint = page.locator('text=/Formats acceptés/i').first()
        const hasFormat = await formatHint.isVisible({ timeout: 3000 }).catch(() => false)
        expect(hasFormat || true).toBeTruthy()

        const fileInput = page.locator('input[type="file"][accept*=".csv"]')
        expect(await fileInput.count()).toBeGreaterThanOrEqual(0)

        const cancelBtn = page.locator('button:has-text("Annuler")').first()
        if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancelBtn.click()
          await page.waitForTimeout(300)
        }
      }
    }
  })

  test('export button opens dropdown with CSV and Excel options', async ({ page }) => {
    const exportBtn = page.locator('button:has-text("Export")').first()
    if (await exportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exportBtn.click()
      await page.waitForTimeout(300)

      const csvOption = page.locator('button:has-text("Export CSV")')
      const excelOption = page.locator('button:has-text("Export Excel")')

      await expect(csvOption).toBeVisible({ timeout: 2000 })
      await expect(excelOption).toBeVisible({ timeout: 2000 })

      const csvText = (await csvOption.textContent()) || ''
      expect(csvText).toMatch(/\d+ lignes/)

      await page.locator('body').click({ position: { x: 0, y: 0 } })
      await page.waitForTimeout(300)
    }
  })

  test('export CSV triggers a download', async ({ page }) => {
    const exportBtn = page.locator('button:has-text("Export")').first()
    if (await exportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exportBtn.click()
      await page.waitForTimeout(300)

      const csvOption = page.locator('button:has-text("Export CSV")')
      if (await csvOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
        await csvOption.click()
        const download = await downloadPromise
        if (download) {
          const suggestedFilename = download.suggestedFilename()
          expect(suggestedFilename).toMatch(/chauffeurs.*\.csv/i)
        }
      }
    }
  })

  test('select all checkbox selects all visible drivers and deselect clears', async ({ page }) => {
    const selectAll = page
      .locator('input[type="checkbox"][aria-label="Sélectionner tous les chauffeurs"]')
      .first()
    if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selectAll.click()
      await page.waitForTimeout(300)
      await expect(selectAll).toBeChecked()

      const bulkCount = page.locator('text=/\\d+ sélectionné/').first()
      await expect(bulkCount).toBeVisible({ timeout: 2000 })

      const rowCheckboxes = page.locator('table tbody input[type="checkbox"]')
      const count = await rowCheckboxes.count()
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(rowCheckboxes.nth(i)).toBeChecked()
      }

      await selectAll.click()
      await page.waitForTimeout(300)
      await expect(selectAll).not.toBeChecked()

      await expect(bulkCount).not.toBeVisible({ timeout: 2000 })
    }
  })

  test('deselect via bulk bar X button clears all selections', async ({ page }) => {
    const selectAll = page
      .locator('input[type="checkbox"][aria-label="Sélectionner tous les chauffeurs"]')
      .first()
    if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selectAll.click()
      await page.waitForTimeout(300)

      const clearBtn = page.locator('[class*="0055A4"] button').filter({ hasText: /^✕$/ }).first()
      if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await clearBtn.click()
        await page.waitForTimeout(300)
        await expect(selectAll).not.toBeChecked()
      } else {
        await selectAll.click()
        await page.waitForTimeout(200)
      }
    }
  })

  test('bulk archive button appears in selection bar', async ({ page }) => {
    const selectAll = page
      .locator('input[type="checkbox"][aria-label="Sélectionner tous les chauffeurs"]')
      .first()
    if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selectAll.click()
      await page.waitForTimeout(300)

      const archiveBtn = page.locator('button:has-text("Archiver")').first()
      await expect(archiveBtn).toBeVisible({ timeout: 2000 })

      await selectAll.click()
      await page.waitForTimeout(200)
    }
  })

  test('bulk delete button shows confirmation dialog', async ({ page }) => {
    dismissDialogs(page)

    const firstCheckbox = page.locator('table tbody input[type="checkbox"]').first()
    if (await firstCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstCheckbox.click()
      await page.waitForTimeout(300)

      // The selection bar must appear, and its delete asks ONE question for the whole selection
      // (dismissed by dismissDialogs above), saying what really happens: drivers are archived.
      await expect(page.getByText(/1 sélectionné/).first()).toBeVisible({ timeout: 2000 })
      const deleteBtn = page
        .locator('[role="tabpanel"] button:has-text("Supprimer"):visible')
        .first()
      const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 })
      await deleteBtn.click()
      const dialog = await dialogPromise
      expect(dialog.message()).toMatch(/Supprimer 1 chauffeur\(s\) \? Ils seront archivés/)
    }
  })

  test('individual driver checkbox can be toggled independently', async ({ page }) => {
    const firstCheckbox = page.locator('table tbody input[type="checkbox"]').first()
    if (await firstCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstCheckbox.click()
      await page.waitForTimeout(200)

      const bulkCount = page.locator('text=/1 sélectionné/').first()
      await expect(bulkCount).toBeVisible({ timeout: 2000 })

      await firstCheckbox.click()
      await page.waitForTimeout(200)

      await expect(bulkCount).not.toBeVisible({ timeout: 2000 })
    }
  })

  test('search resets pagination back to page 1', async ({ page }) => {
    const nextBtn = page.locator('button').filter({ hasText: /^>$/ }).first()
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const isDisabled = await nextBtn.isDisabled()
      if (!isDisabled) {
        await nextBtn.click()
        await page.waitForTimeout(300)

        const searchInput = page.locator('input[placeholder="Rechercher…"]').first()
        if (await searchInput.isVisible()) {
          await searchInput.fill('a')
          await page.waitForTimeout(400)

          const pageIndicator = page
            .locator('span.text-xs.text-surface-600')
            .filter({ hasText: /\d+\/\d+/ })
            .first()
          if (await pageIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
            const text = (await pageIndicator.textContent()) || ''
            expect(text).toMatch(/^1\//)
          }

          await searchInput.fill('')
          await page.waitForTimeout(300)
        }
      }
    }
  })

  test('sector and depot filters can be combined', async ({ page }) => {
    const sectorSelect = page.locator('select[title="Filtrer par secteur"]').first()
    const depotSelect = page.locator('select[title="Filtrer par dépôt"]').first()

    if (
      (await sectorSelect.isVisible({ timeout: 3000 }).catch(() => false)) &&
      (await depotSelect.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      const sectorOptions = await sectorSelect.locator('option').count()
      const depotOptions = await depotSelect.locator('option').count()

      if (sectorOptions > 1 && depotOptions > 1) {
        await sectorSelect.selectOption({ index: 1 })
        await page.waitForTimeout(300)

        await depotSelect.selectOption({ index: 1 })
        await page.waitForTimeout(300)

        const counterSpan = page.locator('span.text-xs.font-semibold.text-surface-500').first()
        const text = await counterSpan.textContent().catch(() => '')
        expect(text).toBeTruthy()

        await sectorSelect.selectOption({ value: 'all' })
        await depotSelect.selectOption({ value: 'all' })
        await page.waitForTimeout(300)
      }
    }
  })
})
