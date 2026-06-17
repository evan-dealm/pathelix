import type { Driver, PlannedMission } from '@/lib/types'
import type { TourResult } from '@/lib/algorithm'

interface TourExportData {
  driver: Driver
  plan: PlannedMission[]
  result: TourResult | null
  date: string
  startTime: string
}

export function exportTourSheetPdf(tours: TourExportData[], companyName?: string): void {
  const win = window.open('', '_blank')
  if (!win) {

    window.dispatchEvent(new CustomEvent('pathelix:toast', { detail: { type: 'error', message: 'Popup bloquée. Autorisez les popups pour exporter.' } }))
    return
  }

  const dateStr = tours[0]?.date || ''
  const title = `Feuilles de route — ${dateStr}`

  const formatMin = (m: number) => {
    const h = Math.floor(m / 60)
    const min = Math.round(m % 60)
    return h + 'h' + String(min).padStart(2, '0')
  }

  const escHtml = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const tourPages = tours.map((tour, idx) => {
    const { driver, result, date, startTime } = tour
    const steps = result?.steps || []

    const dateDisplay = (() => {
      try {
        return new Date(date + 'T00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      } catch { return date }
    })()

    const printedAt = (() => {
      const now = new Date()
      return `${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    })()

    const statsHtml = result ? `
  <div class="stats">
    <div class="stat"><div class="value">${escHtml(steps.filter(s => !s.isSynthetic).length)}</div><div class="label">Missions</div></div>
    <div class="stat"><div class="value">${formatMin(result.totalDurationMin)}</div><div class="label">Durée totale</div></div>
    <div class="stat"><div class="value">${escHtml(result.totalRoadDistKm)} km</div><div class="label">Distance</div></div>
    <div class="stat"><div class="value">${formatMin(result.totalDrivingMin)}</div><div class="label">Conduite</div></div>
    <div class="stat"><div class="value">${formatMin(result.totalOnSiteMin)}</div><div class="label">Sur site</div></div>
  </div>` : ''

    const rowsHtml = steps.map((step, i) => `
      <tr>
        <td>${escHtml(i + 1)}</td>
        <td><span class="type-badge type-${escHtml(step.mission.type)}">${escHtml(step.mission.type)}</span>${step.mission.priority === 1 ? ' <span class="p1">P1</span>' : ''}</td>
        <td><strong>${escHtml(step.mission.clientName || step.mission.outletName || '')}</strong><br/>${escHtml(step.mission.address)}</td>
        <td>${escHtml(step.arrivalStr)}</td>
        <td>${escHtml(step.departureStr)}</td>
        <td>${formatMin(step.onSiteMin)}</td>
        <td>${escHtml(step.roadDistKm)}</td>
        <td>${escHtml(step.mission.accessNotes || '')}</td>
      </tr>`).join('')

    return `
  ${idx > 0 ? '<div class="page-break"></div>' : ''}
  <div class="header">
    <h1>${escHtml(companyName || 'PATHÉLIX')}</h1>
    <div class="info">
      <div>Feuille de route</div>
      <div><strong>${escHtml(dateDisplay)}</strong></div>
      <div>Imprimé le ${escHtml(printedAt)}</div>
    </div>
  </div>
  <div class="driver-info">
    <div>
      <div class="name">${escHtml(driver.firstName)} ${escHtml(driver.lastName)}</div>
      <div class="detail">Secteur : ${escHtml(driver.sector)} · Dépôt : ${escHtml(driver.depotName)}</div>
    </div>
    <div>
      <div class="detail">Départ : <strong>${escHtml(startTime)}</strong></div>
      ${result ? '<div class="detail">Fin estimée : <strong>' + escHtml(result.finishStr) + '</strong></div>' : ''}
    </div>
  </div>
  ${statsHtml}
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Type</th>
        <th>Client / Adresse</th>
        <th>Arrivée</th>
        <th>Départ</th>
        <th>Durée</th>
        <th>Km</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
    ${rowsHtml}
    </tbody>
  </table>
  <div class="notes-section">
    <h3>Notes du chauffeur</h3>
    <div class="notes-lines">&nbsp;</div>
  </div>
  <div class="footer">${escHtml(companyName || 'PATHÉLIX')} — Feuille de route ${escHtml(date)} — ${escHtml(driver.firstName)} ${escHtml(driver.lastName)}</div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  @media print { .page-break { page-break-before: always; } .no-print { display: none !important; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0055A4; padding-bottom: 8px; margin-bottom: 12px; }
  .header h1 { font-size: 18px; color: #0055A4; }
  .header .info { text-align: right; font-size: 10px; color: #666; }
  .driver-info { background: #f0f4f8; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; display: flex; gap: 24px; }
  .driver-info .name { font-size: 16px; font-weight: bold; }
  .driver-info .detail { font-size: 10px; color: #555; }
  .stats { display: flex; gap: 16px; margin-bottom: 12px; }
  .stat { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 4px; padding: 6px 12px; text-align: center; }
  .stat .value { font-size: 14px; font-weight: bold; color: #0055A4; }
  .stat .label { font-size: 9px; color: #888; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #0055A4; color: white; padding: 6px 8px; font-size: 10px; text-align: left; text-transform: uppercase; }
  td { padding: 6px 8px; border-bottom: 1px solid #e8e8e8; font-size: 11px; }
  tr:nth-child(even) { background: #fafafa; }
  .type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: bold; }
  .type-POSER { background: #dbeafe; color: #1d4ed8; }
  .type-RETIRER { background: #fee2e2; color: #dc2626; }
  .type-ECHANGER { background: #ffedd5; color: #ea580c; }
  .type-VIDER { background: #f3e8ff; color: #9333ea; }
  .type-PAUSE { background: #f3f4f6; color: #6b7280; }
  .p1 { color: #dc2626; font-weight: bold; }
  .notes-section { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; }
  .notes-section h3 { font-size: 12px; margin-bottom: 6px; }
  .notes-lines { min-height: 60px; border: 1px solid #ddd; border-radius: 4px; padding: 8px; }
  .footer { margin-top: 16px; text-align: center; font-size: 9px; color: #aaa; border-top: 1px solid #eee; padding-top: 6px; }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #0055A4; color: white; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; cursor: pointer; z-index: 100; }
  .print-btn:hover { background: #003d7a; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Imprimer / PDF</button>
${tourPages}
</body>
</html>`

  win.document.write(html)
  win.document.close()
}
