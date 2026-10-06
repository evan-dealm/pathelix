'use client'

import { useState } from 'react'
import { usePermissions, hasPerm } from '@/hooks/usePermissions'
import { apiRequest } from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

interface Co2Report {
  period:      { from: string; to: string }
  totalKm:     number
  totalCO2Kg:  number
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Statistiques → Rapports: monthly PDF report and CO2 summary (permission "Voir les rapports").
 * Both endpoints existed with no way to reach them from the app.
 */
export function ReportsPanel() {
  const { permissions, loading } = usePermissions()
  const { error: toastError } = useToast()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [downloading, setDownloading] = useState(false)
  const [co2, setCo2] = useState<Co2Report | null>(null)
  const [co2Loading, setCo2Loading] = useState(false)

  if (loading || !hasPerm(permissions, 'view_reports')) return null

  async function downloadPdf() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/reports/pdf?month=${encodeURIComponent(month)}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        toastError(body?.error ?? `Rapport indisponible (${res.status})`)
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `rapport-${month}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      toastError('Réseau indisponible — réessayez.')
    } finally {
      setDownloading(false)
    }
  }

  async function loadCo2() {
    setCo2Loading(true)
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86_400_000)
    const res = await apiRequest<Co2Report>(`/api/reports/co2?from=${isoDay(from)}&to=${isoDay(to)}`, { cache: 'no-store' })
    setCo2Loading(false)
    if (res.ok) setCo2(res.data)
    else toastError(res.error)
  }

  const btn = 'px-3 py-1.5 bg-[#0055A4] hover:bg-[#0066c4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg'

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-4 flex flex-wrap items-end gap-6">
      <div>
        <h3 className="text-surface-900 font-semibold text-sm mb-2">Rapport mensuel</h3>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Mois du rapport"
            className="bg-surface-100 border border-surface-200 rounded px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
          <button type="button" className={btn} onClick={downloadPdf} disabled={downloading || !month}>
            {downloading ? 'Génération…' : 'Télécharger le PDF'}
          </button>
        </div>
      </div>
      <div>
        <h3 className="text-surface-900 font-semibold text-sm mb-2">Bilan CO₂ (30 derniers jours)</h3>
        {co2 ? (
          <p className="text-xs text-surface-700">
            <span className="font-bold text-surface-900">{Math.round(co2.totalCO2Kg).toLocaleString('fr-FR')} kg CO₂</span>
            {' '}pour {Math.round(co2.totalKm).toLocaleString('fr-FR')} km planifiés
          </p>
        ) : (
          <button type="button" className={btn} onClick={loadCo2} disabled={co2Loading}>
            {co2Loading ? 'Calcul…' : 'Calculer'}
          </button>
        )}
      </div>
    </div>
  )
}
