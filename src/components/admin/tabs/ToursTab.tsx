'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import dynamic from 'next/dynamic'
import { Exutoire, PlannedMission, MISSION_TYPE_HEX, MISSION_TYPE_LABELS } from '@/lib/types'
import { useTrade } from '@/providers/TradeProvider'
import { calcTour, TourResult, formatDuration } from '@/lib/algorithm'
import { usePlanningStore } from '@/stores/planningStore'
import { useOptimizationStore } from '@/stores/optimizationStore'
import { TL_START, TL_END, LEGAL_MAX_DRIVING_MIN, LEGAL_MAX_WORK_MIN, TourOverrideState } from '../types'
import { Btn, DateNav, P1Badge, LegalBar } from '../ui'
import { useToast } from '@/components/ui/Toast'
import { today, displayFull, tlLeft, tlWidth, mTitle, useDebounce } from '../hooks'
import { TourOverrideModal } from '../modals/TourOverrideModal'
import { useDriverPositions } from '@/hooks/useDriverPositions'
import { computeRouteCostBreakdown, type RouteCostBreakdown } from '@/lib/tollDatabase'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ParetoSelector } from '@/components/admin/ParetoSelector'
import type { OptimizationResult } from '@/lib/types'
import { usePermissions, hasPerm } from '@/hooks/usePermissions'
import { cachedFetch } from '@/lib/clientCache'
import { loadPlansForDate } from '@/lib/loadPlansForDate'
import type { SettingsApiResponse } from '@/lib/types'

const FleetMap = dynamic(() => import('@/components/FleetMap'), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-surface-50 text-surface-300 text-sm">Chargement carte...</div>,
})

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeEtaDelayMin(
  result: TourResult,
  pos: { lat: number; lng: number; speedKmh: number } | undefined,
): number | null {
  if (!pos) return null
  const now = new Date()
  const currentMin = now.getHours() * 60 + now.getMinutes()
  const nextStep = result.steps.find(
    s => s.arrivalMin > currentMin && !s.mission.isSynthetic &&
      s.mission.latitude !== 0 && s.mission.longitude !== 0,
  )
  if (!nextStep) return null
  const dist = haversineKm(pos.lat, pos.lng, nextStep.mission.latitude, nextStep.mission.longitude)
  const speed = Math.max(pos.speedKmh, 15)
  const etaMin = currentMin + (dist / speed) * 60
  return Math.round(etaMin - nextStep.arrivalMin)
}


export function ToursTab({ onEditPlanned, onViewMission }: {
  onEditPlanned: (_m: PlannedMission, _driverId: string, _date: string) => void
  onViewMission: (_m: PlannedMission) => void
}) {
  const { missionIcon, missionLabel } = useTrade()
  const { success: toastSuccess, error: toastError } = useToast()
  const { permissions } = usePermissions()
  const canOptimize = hasPerm(permissions, 'optimize')
  const storeDrivers = usePlanningStore(s => s.drivers)
  const storePlans = usePlanningStore(s => s.plans)
  const storeStartTimes = usePlanningStore(s => s.startTimes)
  const storeSpeeds = usePlanningStore(s => s.speeds)
  const applyOptimization = usePlanningStore(s => s.applyOptimization)
  const reorderMissions = usePlanningStore(s => s.reorderMissions)
  const unassignFromDriver = usePlanningStore(s => s.unassignFromDriver)
  const assignToDriver = usePlanningStore(s => s.assignToDriver)
  const undo = usePlanningStore(s => s.undo)
  const redo = usePlanningStore(s => s.redo)
  const canUndo = usePlanningStore(s => s.canUndo)
  const canRedo = usePlanningStore(s => s.canRedo)
  const clearAllPlansForDate = usePlanningStore(s => s.clearAllPlansForDate)
  const moveUp = usePlanningStore(s => s.moveUp)
  const moveDown = usePlanningStore(s => s.moveDown)
  const [exutoires, setExutoires] = useState<Exutoire[]>([])
  const [settings, setSettings] = useState({ defaultSpeedKmh: 50, defaultStartTime: '07:00', costPerKm: 0.35, fuelCostPerLiter: 1.85, consumptionLPer100: 32 })
  const [routingSource, setRoutingSource] = useState<string | null>(null)

  const [mapResetKey, setMapResetKey] = useState(0)
  useEffect(() => {
    Promise.all([
      cachedFetch<Exutoire[] | { data?: Exutoire[] }>('/api/exutoires', 60_000),
      cachedFetch<SettingsApiResponse>('/api/settings', 120_000),
    ]).then(([exData, stData]) => {
      const ex = Array.isArray(exData) ? exData : (exData as { data?: Exutoire[] })?.data ?? []
      setExutoires(ex)
      if (stData?.defaultSpeedKmh !== undefined) {
        setSettings(prev => ({ ...prev, ...stData }))
        if (stData?.routingSource) setRoutingSource(stData.routingSource)
      }
    }).catch(() => {})
  }, [])
  const [tourDate, setTourDate] = useState(today())
  const [hoveredMissionId, setHoveredMissionId] = useState<string | null>(null)
  const [p1RiskMap, setP1RiskMap] = useState<Map<string, { risk: 'low' | 'medium' | 'high'; score: number; reason: string }>>(new Map())

  useEffect(() => { loadPlansForDate(tourDate) }, [tourDate])

  useEffect(() => {
    fetch(`/api/plans/p1-risk?date=${tourDate}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { p1Risks: Array<{ missionId: string; risk: 'low' | 'medium' | 'high'; score: number; reason: string }> } | null) => {
        if (!data?.p1Risks) return
        setP1RiskMap(new Map(data.p1Risks.map(r => [r.missionId, { risk: r.risk, score: r.score, reason: r.reason }])))
      })
      .catch(() => {})
  }, [tourDate])

  const [usePareto, setUsePareto] = useState(false)
  const [lastParetoFront, setLastParetoFront] = useState<NonNullable<OptimizationResult['stats']['paretoFront']> | null>(null)

  const [optToggles, setOptToggles] = useState({ distance: true, punctuality: true, balance: true, stability: false })

  const optWeights = {
    distance:    optToggles.distance    ? 1.0 : 0.1,
    punctuality: optToggles.punctuality ? 1.0 : 0.1,
    balance:     optToggles.balance     ? 1.0 : 0.1,
    stability:   optToggles.stability   ? 0.7 : 0,
  }
  const [showWeights, setShowWeights] = useState(false)
  const [showTTC, setShowTTC] = useState(true)

  const livePositions = useDriverPositions(tourDate, 15_000)

  const isOptimizing     = useOptimizationStore(s => s.isOptimizing)
  const optimizeStats    = useOptimizationStore(s => s.stats)
  const optimizeError    = useOptimizationStore(s => s.error)
  const optimizeElapsed  = useOptimizationStore(s => s.elapsed)
  const optimizeProgress = useOptimizationStore(s => s.progress)
  const cancelOptimize   = useOptimizationStore(s => s.cancel)
  const startOptimization = useOptimizationStore(s => s.startOptimization)

  function handleOptimize() {

    const existingPlans: Record<string, string[]> = {}
    for (const driver of (Array.isArray(storeDrivers) ? storeDrivers : [])) {
      const key  = `${driver.id}|${tourDate}`
      const plan = storePlans[key] || []
      const seq  = [...plan]
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .filter(m => !m.isSynthetic)
        .map(m => m.id)
      if (seq.length > 0) existingPlans[driver.id] = seq
    }

    startOptimization(tourDate, existingPlans, optWeights, (result) => {

      applyOptimization(tourDate, result.assignments, result.unassignedMissions, settings.defaultStartTime)

      if (result.stats.paretoFront && result.stats.paretoFront.length > 0) {
        setLastParetoFront(result.stats.paretoFront)
      } else {
        setLastParetoFront(null)
      }

      const assigned   = result.stats.assignedMissions
      const total      = result.stats.totalMissions
      const score      = Math.round(result.stats.globalScore ?? result.stats.score ?? 0)
      const unassigned = result.unassignedMissions.length
      if (unassigned > 0) {
        toastSuccess(`Optimisation terminée : ${assigned}/${total} missions planifiées (score ${score}/100). ${unassigned} mission(s) non assignée(s).`)
      } else {
        toastSuccess(`Optimisation terminée : ${assigned}/${total} missions planifiées · score ${score}/100`)
      }

      const errors = result.warnings.filter(w => w.severity === 'error')
      if (errors.length > 0) {
        toastError(`${errors.length} erreur(s) d'optimisation. Vérifiez les tournées en rouge.`)
      }
    }, usePareto)
  }

  function applyParetoObjective(weights: { distance: number; punctuality: number; balance: number }) {
    setLastParetoFront(null)
    const existingPlans: Record<string, string[]> = {}
    for (const driver of (Array.isArray(storeDrivers) ? storeDrivers : [])) {
      const key  = `${driver.id}|${tourDate}`
      const plan = storePlans[key] || []
      const seq  = [...plan].sort((a, b) => a.sequenceOrder - b.sequenceOrder).filter(m => !m.isSynthetic).map(m => m.id)
      if (seq.length > 0) existingPlans[driver.id] = seq
    }
    startOptimization(tourDate, existingPlans, { ...weights, stability: 0 }, (result) => {
      applyOptimization(tourDate, result.assignments, result.unassignedMissions, settings.defaultStartTime)
      const assigned = result.stats.assignedMissions
      const total    = result.stats.totalMissions
      toastSuccess(`Solution Pareto appliquée : ${assigned}/${total} missions planifiées`)
    }, false)
  }

  const [isLiveOptimizing, setIsLiveOptimizing] = useState(false)

  async function handleLiveOptimize() {
    if (isLiveOptimizing || isOptimizing) return
    setIsLiveOptimizing(true)

    try {
      const driverIds = (Array.isArray(storeDrivers) ? storeDrivers : [])
        .filter(d => !d.archived)
        .map(d => d.id)

      const res = await fetch('/api/optimize/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: tourDate,
          driverIds,
          options: {
            timeBudgetMs: 8000,
            weights: optWeights,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur serveur')

      if (data.result?.assignments) {

        applyOptimization(tourDate, data.result.assignments, data.result.unassignedMissions || [], settings.defaultStartTime)
        toastSuccess(`Re-optimisation live : ${data.stats?.reoptimized ?? 0} missions redistribuees (${data.stats?.driversWithGPS ?? 0} chauffeurs avec GPS)`)
      } else if (data.message) {
        toastSuccess(data.message)
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erreur de re-optimisation')
    } finally {
      setIsLiveOptimizing(false)
    }
  }

  async function handleDownloadAllPdf() {
    const drivers = (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => (storePlans[`${d.id}|${tourDate}`] || []).length > 0)
    if (drivers.length === 0) return
    for (const d of drivers) {
      try {
        const res = await fetch(`/api/tours/pdf?driverId=${d.id}&date=${tourDate}`)
        if (!res.ok) continue
        const blob = await res.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `tournee_${d.firstName}_${d.lastName}_${tourDate}.pdf`.toLowerCase().replace(/\s+/g, '_')
        a.click()
        URL.revokeObjectURL(url)

        await new Promise(r => setTimeout(r, 300))
      } catch {  }
    }
  }

  function handlePrintTours() {
    const driversForPrint = ( Array.isArray(storeDrivers) ? storeDrivers : [] ).filter(d => (storePlans[`${d.id}|${tourDate}`] || []).length > 0)
    if (driversForPrint.length === 0) return

    const dateFormatted = new Date(tourDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })

    const rows = driversForPrint.map((driver, driverIdx) => {
      const key   = `${driver.id}|${tourDate}`
      const plan  = [...(storePlans[key] || [])].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      const realMissions = plan.filter(m => !m.isSynthetic)
      const res   = calcResults[driver.id]
      const startTime = storeStartTimes[key] || settings.defaultStartTime

      const stepsHtml = realMissions.map((pm, i) => {

        const stepIdx = plan.indexOf(pm)
        const step  = res?.steps[stepIdx]
        const label = missionLabel(pm.type) || (MISSION_TYPE_LABELS as Record<string, string>)[pm.type] || pm.type
        const waste = [pm.wasteTypeLabel, pm.binSize].filter(Boolean).join(' — ') || '—'
        return `<tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:6px 8px;color:#6b7280;text-align:center;font-weight:600">${i + 1}</td>
          <td style="padding:6px 8px;font-family:monospace;white-space:nowrap;font-size:12px">${step ? step.arrivalStr : '—'} → ${step ? step.departureStr : '—'}</td>
          <td style="padding:6px 8px;font-weight:600">${pm.clientName || pm.outletName || '—'}</td>
          <td style="padding:6px 8px;color:#374151;font-size:12px">${pm.address}</td>
          <td style="padding:6px 8px;font-size:12px">${label}</td>
          <td style="padding:6px 8px;color:#374151;font-size:12px">${waste}</td>
          <td style="padding:6px 8px;color:#6b7280;font-size:11px">${pm.accessNotes || '—'}</td>
        </tr>`
      }).join('')

      const isLastDriver = driverIdx === driversForPrint.length - 1

      return `
        <div style="${isLastDriver ? '' : 'page-break-after:always;'}margin-bottom:32px">
          <h2 style="margin:0 0 4px 0;font-size:20px;color:#0055A4">Feuille de route — ${dateFormatted}</h2>
          <div style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid #0055A4;padding-bottom:8px;margin-bottom:12px">
            <div>
              <div style="font-size:16px;font-weight:700;margin-bottom:2px">${driver.firstName} ${driver.lastName}</div>
              <div style="color:#6b7280;font-size:12px">Secteur : ${driver.sector} · Dépôt : ${driver.depotName}</div>
              <div style="color:#6b7280;font-size:12px">Heure de départ : <b>${startTime}</b></div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#e5e7eb">
                <th style="padding:6px 8px;text-align:center;font-weight:700;width:30px">#</th>
                <th style="padding:6px 8px;text-align:left;font-weight:700">Horaire</th>
                <th style="padding:6px 8px;text-align:left;font-weight:700">Client</th>
                <th style="padding:6px 8px;text-align:left;font-weight:700">Adresse</th>
                <th style="padding:6px 8px;text-align:left;font-weight:700">Type</th>
                <th style="padding:6px 8px;text-align:left;font-weight:700">Déchet / Benne</th>
                <th style="padding:6px 8px;text-align:left;font-weight:700">Notes</th>
              </tr>
            </thead>
            <tbody>${stepsHtml}</tbody>
          </table>
          <div style="margin-top:12px;padding:10px 12px;background:#f3f4f6;border-radius:6px;display:flex;gap:32px;font-size:13px">
            <div><b>Missions :</b> ${realMissions.length}</div>
            ${res ? `<div><b>Distance totale :</b> ${res.totalRoadDistKm} km</div>` : ''}
            ${res ? `<div><b>Durée totale :</b> ${formatDuration(res.totalDurationMin)}</div>` : ''}
            ${res ? `<div><b>Fin estimée :</b> ${res.finishStr}</div>` : ''}
          </div>
          ${res?.warnings.length ? `<div style="margin-top:8px;padding:8px;background:#fef3c7;border-radius:4px;font-size:11px;color:#92400e">
            ⚠ ${res.warnings.map(w => w.message).join(' · ')}
          </div>` : ''}
        </div>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Feuilles de route — ${tourDate}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
        table { border-collapse: collapse; }
        tr:nth-child(even) td { background: #f9fafb; }
        @media print {
          body { margin: 12px; }
          .no-print { display: none !important; }
        }
      </style>
    </head><body>
      <div class="no-print" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding:12px;background:#f3f4f6;border-radius:8px">
        <span style="font-size:14px;color:#374151">${driversForPrint.length} feuille(s) de route — ${dateFormatted}</span>
        <button onclick="window.print()" style="padding:8px 16px;background:#0055A4;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px">Imprimer / Enregistrer en PDF</button>
      </div>
      ${rows}
    </body></html>`

    const w = window.open('', '_blank')
    if (w) {
      w.document.write(html)
      w.document.close()

      w.onload = () => {
        w.print()

        w.onafterprint = () => w.close()
      }
    }
  }

  function handlePrintBonPassage(
    mission: PlannedMission,
    driver: { firstName: string; lastName: string; sector: string },
    step: { arrivalStr?: string; departureStr?: string } | undefined,
  ) {
    const arrivalStr   = step?.arrivalStr   || '—'
    const departureStr = step?.departureStr || '—'
    const typeLabel    = missionLabel(mission.type) || (MISSION_TYPE_LABELS as Record<string, string>)[mission.type] || mission.type
    const clientName   = mission.clientName || mission.outletName || '-'
    const wasteLabel   = mission.wasteTypeLabel || '—'
    const binSizeLabel = mission.binSize || '—'
    const accessNotes  = mission.accessNotes || 'Aucune'
    const pageTitle    = `Bon de passage — ${clientName}`

    const html = `<!DOCTYPE html><html lang="fr"><head>
      <meta charset="UTF-8">
      <title>${pageTitle}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111; margin: 32px; font-size: 14px; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .subtitle { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
        .section { border-top: 1px solid #e5e7eb; padding: 12px 0; }
        .row { display: flex; gap: 24px; margin-bottom: 6px; }
        .label { color: #6b7280; font-size: 12px; min-width: 160px; }
        .value { font-weight: 600; }
        .fill-row { display: flex; gap: 32px; margin: 8px 0; }
        .fill-field { border-bottom: 1px solid #9ca3af; min-width: 160px; height: 22px; }
        .fill-label { font-size: 12px; color: #374151; margin-bottom: 2px; }
        .footer { margin-top: 32px; text-align: center; color: #9ca3af; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
        @media print { button { display: none; } }
      </style>
    </head><body>
      <button onclick="window.print()" style="float:right;padding:6px 14px;background:#0055A4;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">🖨 Imprimer</button>
      <h1>BON DE PASSAGE</h1>
      <div class="subtitle">
        Date : ${tourDate} &nbsp;|&nbsp;
        Chauffeur : ${driver.firstName} ${driver.lastName} &nbsp;|&nbsp;
        Secteur : ${driver.sector}
      </div>
      <div class="section">
        <div class="row"><span class="label">Type</span><span class="value">${typeLabel}</span></div>
        <div class="row"><span class="label">Client</span><span class="value">${clientName}</span></div>
        <div class="row"><span class="label">Adresse</span><span class="value">${mission.address}</span></div>
        <div class="row"><span class="label">Horaire prévu</span><span class="value">${arrivalStr} → ${departureStr}</span></div>
        <div class="row"><span class="label">Type de déchet</span><span class="value">${wasteLabel}</span></div>
        <div class="row"><span class="label">Taille benne</span><span class="value">${binSizeLabel}</span></div>
        <div class="row"><span class="label">Notes d'accès</span><span class="value">${accessNotes}</span></div>
      </div>
      <div class="section">
        <div style="font-weight:600;margin-bottom:10px;">Zone à compléter sur site :</div>
        <div class="fill-row">
          <div><div class="fill-label">Heure arrivée</div><div class="fill-field" style="width:80px"></div></div>
          <div><div class="fill-label">Heure départ</div><div class="fill-field" style="width:80px"></div></div>
          <div><div class="fill-label">Poids (tonnes)</div><div class="fill-field" style="width:100px"></div></div>
        </div>
        <div class="fill-row" style="margin-top:16px">
          <div><div class="fill-label">Signature chauffeur</div><div class="fill-field" style="width:200px;margin-top:24px"></div></div>
          <div><div class="fill-label">Signature client</div><div class="fill-field" style="width:200px;margin-top:24px"></div></div>
        </div>
      </div>
      <div class="footer">PATHÉLIX</div>
    </body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  const [tourSearch, setTourSearch] = useState('')
  const debouncedTourSearch = useDebounce(tourSearch, 200)
  const [tourFilter, setTourFilter] = useState<'all' | 'with' | 'without'>('all')

  const [dndTour, setDndTour]           = useState<{ missionId: string; fromDriverId: string } | null>(null)
  const [tourOverride, setTourOverride] = useState<TourOverrideState>(null)
  const [dropTarget, setDropTarget]     = useState<string | null>(null)

  const [dndReorder, setDndReorder] = useState<{ driverId: string; fromIndex: number; missionId: string } | null>(null)
  const [reorderOverIndex, setReorderOverIndex] = useState<number | null>(null)

  function handleMissionDragStart(missionId: string, fromDriverId: string, indexInPlan: number) {
    setDndTour({ missionId, fromDriverId })
    setDndReorder({ driverId: fromDriverId, fromIndex: indexInPlan, missionId })
    useOptimizationStore.getState().reset()
  }

  function handleReorderDragOver(e: React.DragEvent, driverId: string, overIndex: number) {
    if (!dndReorder || dndReorder.driverId !== driverId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setReorderOverIndex(overIndex)
  }

  function handleReorderDrop(e: React.DragEvent, driverId: string, dropIndex: number) {
    e.preventDefault()
    e.stopPropagation()
    if (!dndReorder || dndReorder.driverId !== driverId) return
    if (dndReorder.fromIndex !== dropIndex) {
      reorderMissions(driverId, tourDate, dndReorder.fromIndex, dropIndex)
    }
    setDndReorder(null)
    setReorderOverIndex(null)
    setDndTour(null)
  }

  function handleDriverDragOver(e: React.DragEvent, toDriverId: string) {

    if (dndReorder && dndReorder.driverId === toDriverId) return
    if (!dndTour || dndTour.fromDriverId === toDriverId) return
    e.preventDefault()
    setDropTarget(toDriverId)
  }

  function handleDriverDrop(e: React.DragEvent, toDriverId: string) {
    e.preventDefault()
    setDropTarget(null)
    setDndReorder(null)
    setReorderOverIndex(null)
    if (!dndTour || dndTour.fromDriverId === toDriverId) { setDndTour(null); return }
    setTourOverride({ missionId: dndTour.missionId, fromDriverId: dndTour.fromDriverId, toDriverId, date: tourDate })
    setDndTour(null)
  }

  function confirmTourOverride() {
    if (!tourOverride) return
    unassignFromDriver(tourOverride.missionId, tourOverride.fromDriverId, tourOverride.date)
    assignToDriver(tourOverride.missionId, tourOverride.toDriverId, tourOverride.date)
    setTourOverride(null)
  }

  const calcResultsCache = useRef<Record<string, { result: TourResult | null; planHash: string }>>({})
  const driverMapTours = useMemo(() => {
    const m = new Map<string, typeof storeDrivers[0]>()
    for (const d of (Array.isArray(storeDrivers) ? storeDrivers : [])) m.set(d.id, d)
    return m
  }, [storeDrivers])

  const calcResults = useMemo(() => {
    const results: Record<string, TourResult | null> = {}
    const cache = calcResultsCache.current
    const suffix = `|${tourDate}`

    for (const key of Object.keys(storePlans)) {
      if (!key.endsWith(suffix)) continue
      const missions = storePlans[key]
      if (!missions || missions.length === 0) continue
      const driverId = key.slice(0, key.length - suffix.length)
      const driver = driverMapTours.get(driverId)
      if (!driver) continue

      const startTime = storeStartTimes[key] || settings.defaultStartTime
      const speed = storeSpeeds[driverId] || settings.defaultSpeedKmh
      const planHash = `${missions.length}:${missions[0]?.id}:${missions[missions.length - 1]?.id}:${startTime}:${speed}:${exutoires.length}`

      const cached = cache[driverId]
      if (cached && cached.planHash === planHash) {
        results[driverId] = cached.result
        continue
      }

      const sorted = [...missions].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      const startEx = driver.startingExutoireId ? exutoires.find(e => e.id === driver.startingExutoireId) : null
      const startLat = startEx ? startEx.lat : driver.depotLat
      const startLng = startEx ? startEx.lng : driver.depotLng
      const result = calcTour(sorted, startLat, startLng, startTime, speed, exutoires.length > 0 ? exutoires : undefined, {
        costPerKm: settings.costPerKm,
        fuelCostPerLiter: settings.fuelCostPerLiter,
        consumptionLPer100: settings.consumptionLPer100,
      })
      cache[driverId] = { result, planHash }
      results[driverId] = result
    }
    return results
  }, [driverMapTours, storePlans, storeStartTimes, storeSpeeds, tourDate, exutoires, settings.defaultSpeedKmh, settings.defaultStartTime, settings.costPerKm, settings.fuelCostPerLiter, settings.consumptionLPer100])

  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender  = useRef(true)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')

  const plansHash = useMemo(() => {
    const suffix = `|${tourDate}`
    let h = 0
    for (const key of Object.keys(storePlans)) {
      if (!key.endsWith(suffix)) continue
      const plan = storePlans[key]
      if (!plan || plan.length === 0) continue
      h = (h * 31 + plan.length) | 0
      if (plan[0]) h = (h * 31 + plan[0].sequenceOrder) | 0
    }
    return h
  }, [storePlans, tourDate])

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setAutoSaveStatus('pending')
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {

      const suffix = `|${tourDate}`
      const plansPayload: Array<Record<string, unknown>> = []
      for (const key of Object.keys(storePlans)) {
        if (!key.endsWith(suffix)) continue
        const missions = storePlans[key]
        if (!missions || missions.length === 0) continue
        const driverId = key.slice(0, key.length - suffix.length)
        plansPayload.push({
          driverId, date: tourDate, missions,
          startTime: storeStartTimes[key] || settings.defaultStartTime,
          speedKmh: storeSpeeds[driverId] || settings.defaultSpeedKmh,
        })
      }
      if (plansPayload.length > 0) {
        setAutoSaveStatus('saving')
        try {

          for (let i = 0; i < plansPayload.length; i += 50) {
            await fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(plansPayload.slice(i, i + 50)) })
          }
          setAutoSaveStatus('saved')
          setTimeout(() => setAutoSaveStatus('idle'), 2500)
        } catch { setAutoSaveStatus('idle') }
      } else { setAutoSaveStatus('idle') }
    }, 3000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansHash])

  function buildTourExportRows() {
    const rows: Record<string, unknown>[] = []
    for (const driver of (Array.isArray(storeDrivers) ? storeDrivers : [])) {
      const key      = `${driver.id}|${tourDate}`
      const missions = (storePlans[key] || []).sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      if (missions.length === 0) continue
      const result = calcResults[driver.id]
      missions.forEach((m, idx) => {
        const step   = result?.steps[idx]
        const arr    = step?.arrivalMin ?? 0
        const hhmm   = step ? `${String(Math.floor(arr / 60)).padStart(2,'0')}:${String(arr % 60).padStart(2,'0')}` : ''
        rows.push({
          Chauffeur: `${driver.firstName} ${driver.lastName}`,
          Sequence: m.sequenceOrder,
          Type: m.type,
          Client: m.clientName || m.outletName || '',
          Adresse: m.address,
          Latitude: m.latitude,
          Longitude: m.longitude,
          Heure: hhmm,
          Duree_min: m.estimatedDurationMin + m.maneuverTimeMin,
          Notes_acces: m.accessNotes || '',
          Type_dechet: m.wasteTypeLabel || '',
          Taille_benne: m.binSize || '',
        })
      })
    }
    return rows
  }

  const TOUR_EXPORT_COLS: import('@/lib/exportUtils').ExportColumn[] = [
    { key: 'Chauffeur', header: 'Chauffeur' },
    { key: 'Sequence', header: 'Sequence' },
    { key: 'Type', header: 'Type' },
    { key: 'Client', header: 'Client' },
    { key: 'Adresse', header: 'Adresse' },
    { key: 'Latitude', header: 'Latitude' },
    { key: 'Longitude', header: 'Longitude' },
    { key: 'Heure', header: 'Heure' },
    { key: 'Duree_min', header: 'Duree_min' },
    { key: 'Notes_acces', header: 'Notes_acces' },
    { key: 'Type_dechet', header: 'Type_dechet' },
    { key: 'Taille_benne', header: 'Taille_benne' },
  ]

  function handleExportCSV() {
    const { exportCSV } = require('@/lib/exportUtils')
    exportCSV(TOUR_EXPORT_COLS, buildTourExportRows(), `tournees_${tourDate}`)
  }

  async function handleExportExcel() {
    const { exportExcel } = await import('@/lib/exportUtils')
    await exportExcel(TOUR_EXPORT_COLS, buildTourExportRows(), `tournees_${tourDate}`)
  }

  const plannedCount = ( Array.isArray(storeDrivers) ? storeDrivers : [] ).filter(d => (storePlans[`${d.id}|${tourDate}`] || []).length > 0).length
  const [showEmptyDrivers, setShowEmptyDrivers] = useState(false)
  const [expandedDriverIds, setExpandedDriverIds] = useState<Set<string>>(new Set())

  const filteredDrivers = useMemo(() => {
    const q = debouncedTourSearch.toLowerCase()
    return ( Array.isArray(storeDrivers) ? storeDrivers : [] ).filter(d => {
      if (q && !`${d.firstName} ${d.lastName} ${d.sector}`.toLowerCase().includes(q)) return false
      const hasPlan = (storePlans[`${d.id}|${tourDate}`] || []).length > 0
      if (tourFilter === 'with' && !hasPlan) return false
      if (tourFilter === 'without' && hasPlan) return false
      return true
    })
  }, [storeDrivers, storePlans, tourDate, debouncedTourSearch, tourFilter])

  const { driversWithPlan, driversWithoutPlan } = useMemo(() => {
    const withPlan: typeof filteredDrivers = []
    const withoutPlan: typeof filteredDrivers = []
    for (const d of filteredDrivers) {
      const plan = storePlans[`${d.id}|${tourDate}`]
      if (plan && plan.length > 0) withPlan.push(d)
      else withoutPlan.push(d)
    }
    return { driversWithPlan: withPlan, driversWithoutPlan: withoutPlan }
  }, [filteredDrivers, storePlans, tourDate])

  const driverListRef = useRef<HTMLDivElement>(null)
  const visibleDrivers = useMemo(
    () => [...driversWithPlan, ...(showEmptyDrivers ? driversWithoutPlan : [])],
    [driversWithPlan, driversWithoutPlan, showEmptyDrivers],
  )

  const LATE_THRESHOLD_MIN = 15
  const lateDriverAlerts = useMemo(() => {
    if (tourDate !== today()) return []
    return visibleDrivers.flatMap(driver => {
      const result = calcResults[driver.id]
      const livePos = livePositions.find(p => p.driverId === driver.id)
      if (!result || !livePos || (Date.now() - livePos.updatedAt) > 10 * 60_000) return []
      const delay = computeEtaDelayMin(result, livePos)
      if (delay === null || delay < LATE_THRESHOLD_MIN) return []
      return [{ driverId: driver.id, name: `${driver.firstName} ${driver.lastName}`, delayMin: delay }]
    })
  }, [visibleDrivers, calcResults, livePositions, tourDate])

  const driverVirtualizer = useVirtualizer({
    count: visibleDrivers.length,
    getScrollElement: () => driverListRef.current,
    estimateSize: useCallback((index: number) => {
      const d = visibleDrivers[index]

      return d && expandedDriverIds.has(d.id) ? 300 : 56
    }, [visibleDrivers, expandedDriverIds]),
    overscan: 5,
  })

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider hidden sm:inline">Tournées du</span>
        <DateNav dateStr={tourDate} setDate={setTourDate} />
        <span className="text-surface-400 text-xs capitalize hidden md:block">{displayFull(tourDate)}</span>
        <input value={tourSearch} onChange={e => setTourSearch(e.target.value)} placeholder="Rechercher chauffeur…"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-36 md:w-48" />
        <select value={tourFilter} onChange={e => setTourFilter(e.target.value as 'all' | 'with' | 'without')}
          title="Filtrer par statut de tournée"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous</option>
          <option value="with">Avec tournée</option>
          <option value="without">Sans tournée</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 md:gap-3 flex-wrap">
          {optimizeStats && !isOptimizing && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              ✓ {optimizeStats.assigned}/{optimizeStats.total} missions · score {optimizeStats.score}/100
            </span>
          )}
          {optimizeError && !isOptimizing && (
            <span className="text-xs text-red-400 truncate max-w-[200px]" title={optimizeError}>⚠ {optimizeError}</span>
          )}
          {autoSaveStatus !== 'idle' && (
            <span className={`text-[10px] flex items-center gap-1 ${
              autoSaveStatus === 'saved'   ? 'text-green-500' :
              autoSaveStatus === 'saving'  ? 'text-blue-400' : 'text-surface-400'
            }`}>
              {autoSaveStatus === 'saving'  && <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              {autoSaveStatus === 'saved'   && '✓'}
              {autoSaveStatus === 'pending' && '·'}
              {autoSaveStatus === 'saving'  ? 'Sauvegarde…' : autoSaveStatus === 'saved' ? 'Sauvegardé' : ''}
            </span>
          )}
          <button type="button" onClick={() => undo()} disabled={!canUndo()} title="Annuler la dernière action (Ctrl+Z)"
            className="px-1.5 md:px-2 py-1 rounded text-xs text-surface-400 hover:text-surface-900 hover:bg-surface-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors font-mono">↩ <span className="hidden sm:inline">Annuler</span></button>
          <button type="button" onClick={() => redo()} disabled={!canRedo()} title="Rétablir (Ctrl+Y)"
            className="px-1.5 md:px-2 py-1 rounded text-xs text-surface-400 hover:text-surface-900 hover:bg-surface-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors font-mono">↪ <span className="hidden sm:inline">Rétablir</span></button>
          {plannedCount > 0 && (
            <>
              <Btn onClick={handleExportCSV} variant="ghost" size="sm" title="Exporter en CSV">⬇ CSV</Btn>
              <Btn onClick={() => void handleExportExcel()} variant="ghost" size="sm" title="Exporter en Excel">⬇ Excel</Btn>
              <Btn onClick={handlePrintTours} variant="ghost" size="sm" title="Générer les feuilles de route pour tous les chauffeurs">🖨 Imprimer</Btn>
              <Btn onClick={() => void handleDownloadAllPdf()} variant="ghost" size="sm" title="Télécharger les feuilles de route en PDF (une par chauffeur)">⬇ PDF</Btn>
              <Btn onClick={() => clearAllPlansForDate(tourDate)} variant="ghost" size="sm">✕ Vider</Btn>
            </>
          )}
          <span className="text-surface-400 text-xs">{plannedCount}/{( Array.isArray(storeDrivers) ? storeDrivers : [] ).length} planifiés</span>
          <button type="button" onClick={() => setShowTTC(v => !v)} title={showTTC ? 'Afficher HT' : 'Afficher TTC'}
            className="px-2 py-1 rounded text-[10px] font-bold border border-surface-200 text-surface-500 hover:bg-surface-100 transition-colors">
            {showTTC ? 'TTC' : 'HT'}
          </button>
          {isOptimizing ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0055A4]/20 text-[#0055A4] border border-[#0055A4]/30 min-w-[160px]">
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>Optimisation… {optimizeElapsed}s</span>
                  <span className="ml-auto tabular-nums">{optimizeProgress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#0055A4]/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#0055A4] transition-all duration-500"
                    style={{ width: `${optimizeProgress}%` }}
                  />
                </div>
              </div>
              <button onClick={cancelOptimize}
                className="px-2 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors">Annuler</button>
            </div>
          ) : (
            <div className="relative flex items-center gap-2">
              <button onClick={() => setShowWeights(v => !v)} type="button" title="Parametres d'optimisation"
                className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${showWeights ? 'bg-brand-50 text-brand-500 border-brand-200' : 'bg-surface-50 text-surface-400 border-surface-200 hover:text-surface-600'}`}>
                ⚙
              </button>
              {plannedCount > 0 && (
                <button type="button" onClick={handleLiveOptimize} disabled={isLiveOptimizing}
                  title="Re-optimiser en temps reel depuis les positions GPS actuelles"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
                    isLiveOptimizing
                      ? 'bg-amber-50 text-amber-600 border-amber-200 cursor-wait'
                      : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 shadow-soft hover:shadow-elevated'
                  }`}>
                  {isLiveOptimizing ? (
                    <><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg> Live...</>
                  ) : (
                    <>📡 Live</>
                  )}
                </button>
              )}
              <button onClick={handleOptimize} disabled={!canOptimize}
                title={canOptimize ? undefined : 'Permission "Lancer une optimisation VRP" requise'}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-soft hover:shadow-elevated active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-500">
                Optimiser
              </button>
              {showWeights && (
                <>
                  {}
                  <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={() => setShowWeights(false)} />
                  {}
                  <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
                    <div className="bg-white border border-surface-200 rounded-2xl shadow-2xl p-6 w-80 pointer-events-auto">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-sm font-semibold text-surface-800">Priorites d&apos;optimisation</div>
                        <button onClick={() => setShowWeights(false)} type="button"
                          className="text-surface-400 hover:text-surface-600 text-lg leading-none">&times;</button>
                      </div>
                      {([
                        { key: 'distance' as const, label: 'Optimiser la distance', desc: 'Reduire les kilometres parcourus', icon: '📏' },
                        { key: 'punctuality' as const, label: 'Respecter les horaires', desc: 'Prioriser les fenetres horaires et urgences P1', icon: '⏰' },
                        { key: 'balance' as const, label: 'Equilibrer la charge', desc: 'Repartir equitablement le travail entre chauffeurs', icon: '⚖️' },
                        { key: 'stability' as const, label: 'Garder les habitudes', desc: 'Reassigner les chauffeurs a leurs sites habituels', icon: '🔄' },
                      ]).map(({ key, label, desc, icon }) => (
                        <button key={key} type="button"
                          onClick={() => setOptToggles(t => ({ ...t, [key]: !t[key] }))}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl mb-2 text-left transition-all border ${
                            optToggles[key]
                              ? 'bg-brand-50 border-brand-200 shadow-sm'
                              : 'bg-surface-50 border-surface-200 hover:bg-surface-100'
                          }`}>
                          <span className="text-lg shrink-0">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-semibold ${optToggles[key] ? 'text-brand-700' : 'text-surface-500'}`}>{label}</div>
                            <div className="text-[10px] text-surface-400 mt-0.5">{desc}</div>
                          </div>
                          <div className={`w-10 h-5 rounded-full shrink-0 transition-colors relative ${
                            optToggles[key] ? 'bg-brand-500' : 'bg-surface-300'
                          }`}>
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              optToggles[key] ? 'translate-x-5' : 'translate-x-0.5'
                            }`} />
                          </div>
                        </button>
                      ))}
                      <button type="button"
                        onClick={() => setUsePareto(v => !v)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl mb-2 text-left transition-all border ${
                          usePareto
                            ? 'bg-brand-50 border-brand-200 shadow-sm'
                            : 'bg-surface-50 border-surface-200 hover:bg-surface-100'
                        }`}>
                        <span className="text-lg shrink-0">🎯</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold ${usePareto ? 'text-brand-700' : 'text-surface-500'}`}>Mode Pareto</div>
                          <div className="text-[10px] text-surface-400 mt-0.5">Explorer les solutions non-dominées</div>
                        </div>
                        <div className={`w-10 h-5 rounded-full shrink-0 transition-colors relative ${usePareto ? 'bg-brand-500' : 'bg-surface-300'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${usePareto ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </div>
                      </button>
                      <div className="text-[10px] text-surface-400 mt-2 pt-2 border-t border-surface-100">
                        Activez ou desactivez les criteres pris en compte par l&apos;algorithme.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {lastParetoFront && lastParetoFront.length > 0 && (
        <ParetoSelector
          front={lastParetoFront}
          onApply={(weights) => applyParetoObjective(weights)}
          onDismiss={() => setLastParetoFront(null)}
        />
      )}

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
      <div ref={driverListRef} className="lg:w-1/2 overflow-y-auto px-2 md:px-4 py-3 md:py-4 border-b lg:border-b-0 lg:border-r border-surface-200 min-h-[300px] lg:min-h-0">
        {( Array.isArray(storeDrivers) ? storeDrivers : [] ).length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-surface-400 gap-2">
            <div className="text-3xl">🚛</div>
            <div className="text-sm">Aucun chauffeur enregistré</div>
          </div>
        )}
        {lateDriverAlerts.length > 0 && (
          <div className="mx-2 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-0.5">
            <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">🚨 Retards détectés</div>
            {lateDriverAlerts.map(a => (
              <div key={a.driverId} className="flex items-center gap-2 text-xs text-red-700">
                <span className="font-bold">{a.name}</span>
                <span>—</span>
                <span>+{a.delayMin} min estimés au prochain arrêt</span>
              </div>
            ))}
          </div>
        )}
        {plannedCount === 0 && ( Array.isArray(storeDrivers) ? storeDrivers : [] ).length > 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-surface-400 gap-2">
            <div className="text-3xl">📋</div>
            <div className="text-sm">Aucune tournée planifiée pour ce jour</div>
            <div className="text-xs text-surface-300">Cliquez sur « Lancer l&apos;optimisation » pour générer les tournées</div>
          </div>
        )}
        {}
        <div style={{ height: `${driverVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {driverVirtualizer.getVirtualItems().map(virtualRow => {
          const driver = visibleDrivers[virtualRow.index]
          if (!driver) return null
          return (
            <div key={driver.id}
              data-index={virtualRow.index}
              ref={driverVirtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)`, paddingBottom: '0.75rem' }}>
        {(() => {
          const key = `${driver.id}|${tourDate}`
          const plan = [...(storePlans[key] || [])].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          const startTime = storeStartTimes[key] || settings.defaultStartTime
          const result = calcResults[driver.id]
          const warnings = result?.warnings || []
          const hasError = warnings.some(w => w.severity === 'error')
          const hasWarn  = warnings.some(w => w.severity === 'warning')
          const initials = `${(driver.firstName || '?')[0]}`
          const isDropTarget = dropTarget === driver.id
          const isExpanded = expandedDriverIds.has(driver.id)
          const toggleExpand = () => {
            setExpandedDriverIds(prev => {
              const next = new Set(prev)
              if (next.has(driver.id)) next.delete(driver.id)
              else next.add(driver.id)
              return next
            })

            requestAnimationFrame(() => driverVirtualizer.measure())
          }

          return (
            <div
              onDragOver={e => handleDriverDragOver(e, driver.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => handleDriverDrop(e, driver.id)}
              className={`bg-white border rounded-xl overflow-hidden transition-colors
                ${isDropTarget
                  ? 'border-[#0055A4] ring-1 ring-[#0055A4]/30'
                  : hasError ? 'border-red-500/30' : hasWarn ? 'border-yellow-500/30' : 'border-surface-200'}`}>

              <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none hover:bg-surface-100 transition-colors"
                onClick={toggleExpand}>
                <span className={`text-surface-400 text-[10px] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0
                  ${hasError ? 'bg-red-600/20 text-red-400' : hasWarn ? 'bg-yellow-600/20 text-yellow-400' : 'bg-[#0055A4]/20 text-[#0055A4]'}`}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-surface-900 text-sm font-semibold truncate">{driver.firstName} {driver.lastName}</div>
                  <div className="text-surface-400 text-[10px] truncate">{driver.sector} · {startTime}</div>
                </div>
                {result ? (() => {
                  const costBreakdown: RouteCostBreakdown = computeRouteCostBreakdown({
                    distanceKm: result.totalRoadDistKm,
                    consumptionLPer100: settings.consumptionLPer100,
                    fuelCostPerLiter: settings.fuelCostPerLiter,
                    costPerKm: settings.costPerKm,
                  })
                  const costDisplay = showTTC ? costBreakdown.totalTTC : costBreakdown.totalHT
                  const livePos = livePositions.find(p => p.driverId === driver.id)
                  const etaDelay = computeEtaDelayMin(result, livePos)
                  return (
                  <div className="flex items-center gap-3 text-[11px] flex-shrink-0">
                    <span className="text-surface-900 font-bold">{formatDuration(result.totalDurationMin)}</span>
                    <span className="text-[#0055A4]">{Math.round(result.totalRoadDistKm * 10) / 10} km</span>
                    <span className="text-amber-500 font-semibold">{costDisplay.toFixed(0)}€</span>
                    <span className="text-green-400">{result.finishStr}</span>
                    <span className="text-surface-400">{plan.filter(m => !m.isSynthetic).length} {plan.filter(m => !m.isSynthetic).length === 1 ? 'mission' : 'missions'}</span>
                    {etaDelay !== null && (
                      <span title="ETA dynamique — retard estimé au prochain arrêt" className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        etaDelay > 10 ? 'bg-red-100 text-red-500' :
                        etaDelay > 0  ? 'bg-yellow-100 text-yellow-600' :
                        'bg-green-100 text-green-600'
                      }`}>
                        {etaDelay > 0 ? `+${etaDelay}min` : etaDelay < 0 ? `${etaDelay}min` : 'À l\'heure'}
                      </span>
                    )}
                    {warnings.length > 0 && (
                      <span className={`text-[10px] ${hasError ? 'text-red-400' : 'text-yellow-400'}`}>⚠ {warnings.length}</span>
                    )}
                  </div>)
                })()
                : (
                  <span className="text-surface-300 text-[11px] italic">Aucune mission</span>
                )}
              </div>

              {isExpanded && (
                <>
                  {result && (() => {
                    const cb = computeRouteCostBreakdown({
                      distanceKm: result.totalRoadDistKm,
                      consumptionLPer100: settings.consumptionLPer100,
                      fuelCostPerLiter: settings.fuelCostPerLiter,
                      costPerKm: settings.costPerKm,
                    })
                    return (
                    <div className="flex items-center gap-4 px-4 py-2 border-t border-surface-100 text-xs">
                      <div className="text-center"><div className="text-yellow-400 font-bold">{formatDuration(result.totalDrivingMin)}</div><div className="text-surface-400">Conduite</div></div>
                      <div className="text-center"><div className="text-surface-900 font-bold">{formatDuration(result.totalOnSiteMin)}</div><div className="text-surface-400">Sur site</div></div>
                      <div className="text-center"><div className="text-amber-500 font-bold">{cb.fuelCost.toFixed(1)}€</div><div className="text-surface-400">Carburant</div></div>
                      <div className="text-center"><div className="text-purple-400 font-bold">{cb.tollCost.toFixed(1)}€</div><div className="text-surface-400">Peages</div></div>
                      <div className="text-center"><div className="text-surface-600 font-bold">{cb.wearCost.toFixed(1)}€</div><div className="text-surface-400">Usure</div></div>
                      <div className="text-center border-l border-surface-200 pl-3"><div className="text-amber-500 font-bold">{(showTTC ? cb.totalTTC : cb.totalHT).toFixed(1)}€</div><div className="text-surface-400">{showTTC ? 'Total TTC' : 'Total HT'}</div></div>
                      <div className="flex-1" />
                      <div className="space-y-1 min-w-[150px]">
                        <LegalBar valueMin={result.totalDrivingMin} maxMin={LEGAL_MAX_DRIVING_MIN} label="Conduite (9h max)" />
                        <LegalBar valueMin={result.totalDurationMin} maxMin={LEGAL_MAX_WORK_MIN}   label="Travail (10h max)" />
                      </div>
                      <a href={`/driver/${driver.id}`} target="_blank" rel="noopener noreferrer"
                        title="Vue chauffeur mobile"
                        className="text-[10px] text-surface-400 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded border border-surface-200 hover:border-blue-700"
                        onClick={e => e.stopPropagation()}>📱</a>
                    </div>)
                  })()}

                  {result && result.steps.length > 0 && (
                    <div className="px-2 md:px-4 pt-1 pb-1 overflow-x-auto">
                      <div className="relative w-full min-w-[400px] h-5 bg-surface-100 rounded overflow-hidden">
                        {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(h => (
                          <div key={h} className="absolute top-0 bottom-0 border-l border-surface-200" style={{ left: tlLeft(h * 60) }}>
                            {h % 2 === 0 && <span className="absolute -top-0.5 left-0.5 text-[6px] md:text-[7px] text-surface-400 leading-none">{h}h</span>}
                          </div>
                        ))}
                        {result.steps.filter(s => !s.isSynthetic).map((step, si) => {
                          const arrMin = step.arrivalMin
                          const dur    = step.onSiteMin || step.mission.estimatedDurationMin || 5
                          const typeColor = MISSION_TYPE_HEX[step.mission.type] ?? '#6b7280'
                          const isP1  = step.mission.priority === 1
                          return (
                            <div key={si}
                              className="absolute top-0.5 bottom-0.5 rounded-sm cursor-pointer hover:opacity-100"
                              style={{
                                left: tlLeft(arrMin), width: tlWidth(dur), background: typeColor,
                                opacity: 0.85, border: isP1 ? '1px solid #fbbf24' : 'none',
                                zIndex: hoveredMissionId === step.mission.id ? 10 : 1,
                              }}
                              onMouseEnter={() => setHoveredMissionId(step.mission.id)}
                              onMouseLeave={() => setHoveredMissionId(null)}
                              title={`${step.arrivalStr}→${step.departureStr} ${mTitle(step.mission)}`}
                            />
                          )
                        })}
                        {(() => {
                          const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes()
                          if (nowMin < TL_START || nowMin > TL_END || tourDate !== today()) return null
                          return <div className="absolute top-0 bottom-0 w-px bg-red-500/60 z-20" style={{ left: tlLeft(nowMin) }} />
                        })()}
                      </div>
                    </div>
                  )}

                  {warnings.length > 0 && (
                    <div className="px-4 pt-2 pb-0 space-y-1">
                      {warnings.map((w, i) => (
                        <div key={i} className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-2
                          ${w.severity === 'error' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20'}`}>
                          <span>⚠</span><span>{w.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {plan.length > 0 && (
                    <div className="p-3 space-y-0">
                      {plan.map((pm, i) => {
                        const step = result?.steps[i]
                        const isSynthetic = !!pm.isSynthetic
                        const isDragSource = dndReorder?.missionId === pm.id
                        const showInsertBefore = dndReorder && dndReorder.driverId === driver.id && reorderOverIndex === i && dndReorder.fromIndex !== i && dndReorder.fromIndex !== i - 1
                        return (
                          <div key={pm.id}>
                            {showInsertBefore && (
                              <div className="h-0.5 mx-2 my-0.5 bg-[#0055A4] rounded-full transition-all" />
                            )}
                            <div onClick={() => onViewMission(pm)}
                              draggable={!isSynthetic}
                              onDragStart={e => { if (isSynthetic) { e.preventDefault(); return } e.stopPropagation(); handleMissionDragStart(pm.id, driver.id, i) }}
                              onDragEnd={() => { setDndTour(null); setDropTarget(null); setDndReorder(null); setReorderOverIndex(null) }}
                              onDragOver={e => handleReorderDragOver(e, driver.id, i)}
                              onDrop={e => handleReorderDrop(e, driver.id, i)}
                              onMouseEnter={() => setHoveredMissionId(pm.id)}
                              onMouseLeave={() => setHoveredMissionId(null)}
                              className={`flex items-center gap-3 rounded-lg px-3 py-2 group/row transition-colors mb-1
                                ${isSynthetic ? 'cursor-default opacity-60' : 'cursor-grab active:cursor-grabbing'}
                                ${isDragSource ? 'opacity-40 bg-surface-200' : 'bg-surface-100 hover:bg-surface-100/80'}`}>
                              <span className="w-5 h-5 rounded-full bg-surface-200 flex items-center justify-center text-surface-500 text-[10px] font-bold flex-shrink-0">{pm.sequenceOrder}</span>
                              <span style={{ color: MISSION_TYPE_HEX[pm.type] }} className="text-sm flex-shrink-0">{missionIcon(pm.type)}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-surface-900 text-xs font-semibold truncate">{mTitle(pm)}</span>
                                  {pm.priority === 1 && <P1Badge />}
                                  {pm.priority === 1 && p1RiskMap.get(pm.id) && (() => {
                                    const r = p1RiskMap.get(pm.id)!
                                    return (
                                      <span title={r.reason} className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap cursor-help ${
                                        r.risk === 'high'   ? 'bg-red-100 text-red-700 border border-red-300' :
                                        r.risk === 'medium' ? 'bg-amber-100 text-amber-700 border border-amber-300' :
                                        'bg-green-100 text-green-700 border border-green-300'
                                      }`}>
                                        {r.risk === 'high' ? '⚠ Retard probable' : r.risk === 'medium' ? '~ Risque modéré' : '✓ OK'}
                                      </span>
                                    )
                                  })()}
                                  {pm.priority === 2 && <span className="text-[9px] text-surface-500 font-bold">P2</span>}
                                  {pm.wasteTypeLabel && <span className="text-[9px] bg-surface-100 text-surface-500 rounded px-1 py-0.5">{pm.wasteTypeLabel}</span>}
                                  {pm.binSize && <span className="text-[9px] text-surface-400">{pm.binSize}</span>}
                                </div>
                                <div className="text-surface-400 text-[10px] truncate">{pm.address}</div>
                              </div>
                              {step && (
                                <div className="text-right flex-shrink-0 hidden sm:block">
                                  <div className="text-surface-600 text-xs font-mono">{step.arrivalStr} → {step.departureStr}</div>
                                  <div className="text-surface-400 text-[10px]">{formatDuration(step.onSiteMin)} · {Math.round(step.roadDistKm * 10) / 10} km</div>
                                </div>
                              )}
                              {pm.manualStartMin !== undefined && (
                                <span title="Heure forcée manuellement" className="text-yellow-500 text-[10px] flex-shrink-0">📌</span>
                              )}
                              <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0"
                                onClick={e => e.stopPropagation()}>
                                <button onClick={() => moveUp(pm.id, driver.id, tourDate)} title="Monter"
                                  className="w-5 h-5 flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded text-xs">↑</button>
                                <button onClick={() => moveDown(pm.id, driver.id, tourDate)} title="Descendre"
                                  className="w-5 h-5 flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded text-xs">↓</button>
                                <button onClick={() => onEditPlanned(pm, driver.id, tourDate)} title="Modifier"
                                  className="w-5 h-5 flex items-center justify-center text-surface-400 hover:text-blue-400 hover:bg-surface-100 rounded text-xs">✏</button>
                                <button onClick={() => handlePrintBonPassage(pm, driver, step)} title="Bon de passage"
                                  className="w-5 h-5 flex items-center justify-center text-surface-400 hover:text-yellow-400 hover:bg-surface-100 rounded text-xs">🧾</button>
                                <button onClick={() => unassignFromDriver(pm.id, driver.id, tourDate)} title="Retirer du plan"
                                  className="w-5 h-5 flex items-center justify-center text-surface-400 hover:text-red-400 hover:bg-surface-100 rounded text-xs">✕</button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {}
                      {dndReorder && dndReorder.driverId === driver.id && reorderOverIndex === plan.length && dndReorder.fromIndex !== plan.length - 1 && (
                        <div className="h-0.5 mx-2 my-0.5 bg-[#0055A4] rounded-full transition-all" />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}
            </div>
          )
        })}
        </div>
        {driversWithoutPlan.length > 0 && (
          <button type="button" onClick={() => setShowEmptyDrivers(v => !v)}
            className="w-full py-2 text-xs text-surface-400 hover:text-surface-500 border border-dashed border-surface-200 hover:border-surface-200 rounded-xl transition-colors mt-3">
            {showEmptyDrivers ? '▲ Masquer' : `▼ Afficher ${driversWithoutPlan.length} chauffeur(s) sans tournée`}
          </button>
        )}
      </div>

      <div className="lg:w-1/2 relative min-h-[250px] lg:min-h-0">
        {}
        {(() => {
          const src = optimizeStats?.routingSource ?? routingSource
          if (!src) return null
          const label = src.toLowerCase()
          const isValhalla = label.startsWith('valhalla')
          const isOsrm = label.startsWith('osrm')
          const isApi = label === 'api' || label === 'trimble' || label === 'here'
          return (
            <div className="absolute top-2 right-2 z-[500] pointer-events-none">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold shadow-sm border pointer-events-auto ${
                isValhalla ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : isOsrm   ? 'bg-blue-50 text-blue-700 border-blue-200'
                : isApi    ? 'bg-violet-50 text-violet-700 border-violet-200'
                : 'bg-surface-50 text-surface-600 border-surface-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  isValhalla ? 'bg-emerald-500'
                  : isOsrm   ? 'bg-blue-500'
                  : isApi    ? 'bg-violet-500'
                  : 'bg-surface-400'
                }`} />
                {isValhalla ? 'Valhalla'
                  : isOsrm ? 'OSRM'
                  : isApi  ? src.charAt(0).toUpperCase() + src.slice(1)
                  : label === 'haversine' ? 'Haversine'
                  : src}
              </span>
            </div>
          )
        })()}
        <ErrorBoundary
          key={mapResetKey}
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-surface-50 text-surface-400 min-h-[250px]">
              <div className="text-3xl">🗺️</div>
              <p className="text-sm text-surface-500">La carte n&apos;a pas pu s&apos;initialiser</p>
              <button
                type="button"
                onClick={() => setMapResetKey(k => k + 1)}
                className="px-3 py-1.5 bg-brand-500 text-white text-xs rounded-lg hover:bg-brand-600 transition-colors"
              >
                Recharger la carte
              </button>
            </div>
          }
        >
          <FleetMap
            drivers={driversWithPlan}
            calcResults={calcResults}
            exutoires={exutoires}
            hoveredMissionId={hoveredMissionId}
            livePositions={livePositions}
          />
        </ErrorBoundary>
      </div>

      </div>

      <TourOverrideModal
        state={tourOverride}
        onConfirm={confirmTourOverride}
        onCancel={() => setTourOverride(null)}
      />
    </div>
  )
}
