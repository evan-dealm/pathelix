'use client'

import { useState, useMemo, useRef, useEffect, useCallback, useTransition } from 'react'
import Image from 'next/image'
import { usePlanningStore } from '@/stores/planningStore'
import { Driver, Mission, PlannedMission } from '@/lib/types'
import { calcTour, TourResult } from '@/lib/algorithm'
import { exportTourSheetPdf } from '@/lib/exportPdf'

import {
  ViewMode, AppTab, MissionModalState, ConfirmOverrideState,
  SYNTHETIC_TYPES, blankMission, BLANK_DRIVER,
} from '@/components/admin/types'
import { today, displayShort, logErr, sleep } from '@/components/admin/hooks'
import { cachedFetch } from '@/lib/clientCache'
import type { SettingsApiResponse } from '@/lib/types'

import { MissionForm } from '@/components/admin/MissionForm'
import { DriverForm } from '@/components/admin/DriverForm'
import type { ParsedMissionFields } from '@/components/admin/NaturalMissionInput'

import { ConfirmOverrideModal } from '@/components/admin/modals/ConfirmOverrideModal'
import { MissionDetailModal } from '@/components/admin/modals/MissionDetailModal'
import { DriverDetailModal } from '@/components/admin/modals/DriverDetailModal'

import { DashboardKPIBar } from '@/components/admin/DashboardKPIBar'

import { TopPanel } from '@/components/admin/timeline/TopPanel'
import { BottomPanel } from '@/components/admin/timeline/BottomPanel'

import dynamic from 'next/dynamic'
const DynamicLoading = () => (
  <div className="p-6 space-y-4 animate-pulse">
    <div className="flex items-center gap-3 mb-6">
      <div className="h-7 bg-surface-200 rounded-lg w-40" />
      <div className="h-7 bg-surface-100 rounded-lg w-24" />
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-20 bg-surface-100 rounded-xl" />)}
    </div>
    <div className="h-64 bg-surface-100 rounded-xl" />
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-surface-100 rounded-lg" />)}
    </div>
  </div>
)
const DriversTab    = dynamic(() => import('@/components/admin/tabs/DriversTab').then(m => ({ default: m.DriversTab })),    { ssr: false, loading: DynamicLoading })
const MissionsTab   = dynamic(() => import('@/components/admin/tabs/MissionsTab').then(m => ({ default: m.MissionsTab })),   { ssr: false, loading: DynamicLoading })
const ExutoiresTab  = dynamic(() => import('@/components/admin/tabs/ExutoiresTab').then(m => ({ default: m.ExutoiresTab })), { ssr: false, loading: DynamicLoading })
const StatsTab      = dynamic(() => import('@/components/admin/tabs/StatsTab').then(m => ({ default: m.StatsTab })),         { ssr: false, loading: DynamicLoading })
const ToursTab      = dynamic(() => import('@/components/admin/tabs/ToursTab').then(m => ({ default: m.ToursTab })),         { ssr: false, loading: DynamicLoading })
const TemplatesTab  = dynamic(() => import('@/components/admin/tabs/TemplatesTab').then(m => ({ default: m.TemplatesTab })), { ssr: false, loading: DynamicLoading })
const HistoryTab    = dynamic(() => import('@/components/admin/tabs/HistoryTab').then(m => ({ default: m.HistoryTab })),     { ssr: false, loading: DynamicLoading })
const SettingsTab   = dynamic(() => import('@/components/admin/tabs/SettingsTab').then(m => ({ default: m.SettingsTab })),   { ssr: false, loading: DynamicLoading })
const UsersTab      = dynamic(() => import('@/components/admin/tabs/UsersTab').then(m => ({ default: m.UsersTab })),         { ssr: false, loading: DynamicLoading })
const VehiclesTab   = dynamic(() => import('@/components/admin/tabs/VehiclesTab').then(m => ({ default: m.VehiclesTab })),   { ssr: false, loading: DynamicLoading })
const AuditTab      = dynamic(() => import('@/components/admin/tabs/AuditTab').then(m => ({ default: m.AuditTab })),         { ssr: false, loading: DynamicLoading })
const TelematicsTab = dynamic(() => import('@/components/admin/tabs/TelematicsTab').then(m => ({ default: m.TelematicsTab })), { ssr: false, loading: DynamicLoading })
const CatalogueTab  = dynamic(() => import('@/components/admin/tabs/CatalogueTab').then(m => ({ default: m.CatalogueTab })), { ssr: false, loading: DynamicLoading })
const WeeklyPlanTab = dynamic(() => import('@/components/admin/tabs/WeeklyPlanTab').then(m => ({ default: m.WeeklyPlanTab })), { ssr: false, loading: DynamicLoading })
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { GlobalSearch } from '@/components/GlobalSearch'
import { useToast } from '@/components/ui/Toast'
import { useTrade } from '@/providers/TradeProvider'
import { OnboardingGuide } from '@/components/ui/OnboardingGuide'
import { usePermissions, hasPerm } from '@/hooks/usePermissions'

export default function AdminPage() {
  const { vocab } = useTrade()

  const drivers      = usePlanningStore(s => s.drivers)
  const missions     = usePlanningStore(s => s.missions)
  const plans        = usePlanningStore(s => s.plans)
  const startTimes   = usePlanningStore(s => s.startTimes)
  const speeds       = usePlanningStore(s => s.speeds)
  const _lockedPlans = usePlanningStore(s => s.lockedPlans)

  const addMission          = usePlanningStore(s => s.addMission)
  const updateMission       = usePlanningStore(s => s.updateMission)
  const removeMission       = usePlanningStore(s => s.removeMission)
  const addDriver           = usePlanningStore(s => s.addDriver)
  const updateDriver        = usePlanningStore(s => s.updateDriver)
  const removeDriver        = usePlanningStore(s => s.removeDriver)
  const assignToDriver      = usePlanningStore(s => s.assignToDriver)
  const unassignFromDriver  = usePlanningStore(s => s.unassignFromDriver)
  const updatePlannedMission = usePlanningStore(s => s.updatePlannedMission)
  const setManualStartMin   = usePlanningStore(s => s.setManualStartMin)
  const undo                = usePlanningStore(s => s.undo)
  const redo                = usePlanningStore(s => s.redo)
  const { success: toastSuccess, error: toastError } = useToast()
  const isUnavailable    = usePlanningStore(s => s.isUnavailable)
  const [userRole, setUserRole]           = useState<'admin' | 'dispatcher' | 'driver' | null>(null)
  const isAdmin = userRole !== 'dispatcher'
  const { permissions } = usePermissions()
  const [tenantSettings, setTenantSettings] = useState<{
    defaultSpeedKmh: number; defaultStartTime: string
    costPerKm: number; fuelCostPerLiter: number; consumptionLPer100: number
  }>({ defaultSpeedKmh: 50, defaultStartTime: '07:00', costPerKm: 0.35, fuelCostPerLiter: 1.65, consumptionLPer100: 30 })

  useEffect(() => {

    Promise.all([
      cachedFetch<SettingsApiResponse>('/api/settings', 120_000).catch(() => null as SettingsApiResponse | null),
      fetch('/api/auth/me', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([s, d]) => {
      if (s?.defaultSpeedKmh !== undefined) setTenantSettings(prev => ({ ...prev, ...(s ?? {}) }))
      if (d?.role === 'admin') setUserRole('admin')
      else if (d?.role === 'dispatcher') setUserRole('dispatcher')
    })
  }, [])

  async function handleSaveMission(data: Omit<Mission, 'id'>, existingId?: string) {
    if (existingId) {
      updateMission(existingId, data)
      fetch(`/api/missions/${existingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => {
        if (res.ok) toastSuccess('Mission mise \u00e0 jour')
        else res.json().then(e => toastError(e?.error ?? 'Erreur serveur')).catch(() => toastError('Erreur serveur'))
      }).catch(() => { logErr('api'); toastError('Erreur serveur') })
    } else {
      try {
        const res = await fetch('/api/missions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          const created = await res.json()
          addMission(data, created.id)
          toastSuccess('Mission cr\u00e9\u00e9e')
        } else {
          const errData = await res.json().catch(() => ({}))
          const errMsg = typeof errData?.error === 'string' ? errData.error
            : errData?.error?.formErrors?.length ? errData.error.formErrors.join(', ')
            : `Erreur ${res.status}`
          logErr('Mission POST')(errData)
          toastError(errMsg)
        }
      } catch {
        toastError('Erreur réseau — mission non sauvegardée')
      }
    }
  }

  async function handleImportMissionsCSV(missionsList: Array<Omit<Mission, 'id'>>) {
    let failed = 0
    for (const [i, data] of missionsList.entries()) {
      if (i > 0) await sleep(250)
      try {
        const res = await fetch('/api/missions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          const created = await res.json()
          addMission(data, created.id)
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }
    if (failed > 0) throw new Error(`${failed} sur ${missionsList.length} mission(s) n'ont pas pu être importées.`)
  }

  async function handleDeleteMission(id: string) {
    if (!confirm('Supprimer cette mission ? Cette action est irréversible.')) return
    removeMission(id)
    fetch(`/api/missions/${id}`, { method: 'DELETE' })
      .then(() => toastSuccess('Mission supprimée'))
      .catch(() => { logErr('api'); toastError('Erreur serveur') })
  }

  async function handleSaveDriver(data: Omit<Driver, 'id'>, existingId?: string) {
    if (existingId) {
      updateDriver(existingId, data)
      fetch(`/api/drivers/${existingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => {
        if (res.ok) toastSuccess(`${vocab.driver} mis \u00e0 jour`)
        else res.json().then(e => toastError(e?.error ?? 'Erreur serveur')).catch(() => toastError('Erreur serveur'))
      }).catch(() => { logErr('api'); toastError('Erreur serveur') })
    } else {
      try {
        const res = await fetch('/api/drivers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          const created = await res.json()
          addDriver(data, created.id)
          toastSuccess(`${vocab.driver} créé`)
        } else {
          const errData = await res.json().catch(() => ({}))
          toastError(typeof errData?.error === 'string' ? errData.error : 'Données invalides — vérifiez le formulaire')
        }
      } catch {
        toastError(`Erreur réseau — ${vocab.driver.toLowerCase()} non sauvegardé`)
      }
    }
  }

  async function handleImportDriversCSV(driversList: Array<Omit<Driver, 'id'>>) {
    let failed = 0
    for (const [i, data] of driversList.entries()) {
      if (i > 0) await sleep(250)
      try {
        const res = await fetch('/api/drivers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (res.ok) {
          const created = await res.json()
          addDriver(data, created.id)
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }
    if (failed > 0) throw new Error(`${failed} sur ${driversList.length} ${vocab.driver.toLowerCase()}(s) n'ont pas pu être importés.`)
  }

  async function handleDeleteDriver(id: string) {
    if (!confirm(`Supprimer ce ${vocab.driver.toLowerCase()} ? Cette action est irréversible.`)) return
    removeDriver(id)
    fetch(`/api/drivers/${id}`, { method: 'DELETE' })
      .then(() => toastSuccess(`${vocab.driver} supprimé`))
      .catch(() => { logErr('api'); toastError('Erreur serveur') })
  }

  async function handleDuplicateMission(id: string) {
    const m = ( Array.isArray(missions) ? missions : [] ).find(m => m.id === id)
    if (!m) return
    const { id: _id, ...data } = m
    await handleSaveMission(data)
  }

  const [activeTab, setActiveTabRaw] = useState<AppTab>('dashboard')
  const [_tabPending, startTabTransition] = useTransition()
  const prevTabRef = useRef<AppTab>('dashboard')
  const setActiveTab = useCallback((tab: AppTab) => {
    if (prevTabRef.current === 'settings' && tab !== 'settings') {
      cachedFetch<SettingsApiResponse>('/api/settings', 120_000).then(s => {
        if (s?.defaultSpeedKmh !== null) setTenantSettings(prev => ({ ...prev, ...s }))
      }).catch(() => {})
    }
    prevTabRef.current = tab
    startTabTransition(() => setActiveTabRaw(tab))
  }, [startTabTransition])

  const [poolView, setPoolView]   = useState<ViewMode>('week')
  const [poolDate, setPoolDate]   = useState<string>(today())

  const [planDate, setPlanDate]   = useState<string>(today())

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragSource, setDragSource] = useState<{ from: 'pool' } | { from: 'plan'; driverId: string; date: string } | null>(null)

  const [topHeight, setTopHeight] = useState(300)
  const isResizing = useRef(false)
  const resizeStartY = useRef(0)
  const resizeStartH = useRef(0)

  function onDividerMouseDown(e: React.MouseEvent) {
    isResizing.current = true
    resizeStartY.current = e.clientY
    resizeStartH.current = topHeight
    e.preventDefault()
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!isResizing.current) return
    const newH = Math.max(140, Math.min(620, resizeStartH.current + e.clientY - resizeStartY.current))
    setTopHeight(newH)
  }
  function onMouseUp() { isResizing.current = false }

  const [missionModal, setMissionModal]   = useState<MissionModalState>({ kind: 'none' })
  const [missionPrefill, setMissionPrefill] = useState<ParsedMissionFields | null>(null)
  const [driverModal, setDriverModal]     = useState<{ kind: 'new' } | { kind: 'edit'; driver: Driver } | null>(null)
  const [confirmOverride, setConfirmOverride] = useState<ConfirmOverrideState>(null)
  const [missionDetail, setMissionDetail] = useState<Mission | null>(null)
  const [driverDetail, setDriverDetail]   = useState<Driver | null>(null)

  const [showValidation, setShowValidation] = useState(false)

  const _calcCache = useRef<Record<string, { result: TourResult | null; hash: string }>>({})
  const driverMap = useMemo(() => {
    const m = new Map<string, Driver>()
    for (const d of (Array.isArray(drivers) ? drivers : [])) m.set(d.id, d)
    return m
  }, [drivers])
  const calcResults = useMemo(() => {
    const results: Record<string, TourResult | null> = {}
    const cache = _calcCache.current
    const suffix = `|${planDate}`

    for (const key of Object.keys(plans)) {
      if (!key.endsWith(suffix)) continue
      const missions = plans[key]
      if (!missions || missions.length === 0) continue
      const driverId = key.slice(0, key.length - suffix.length)
      const driver = driverMap.get(driverId)
      if (!driver) continue
      const st = startTimes[key] || tenantSettings.defaultStartTime
      const spd = speeds[driverId] || tenantSettings.defaultSpeedKmh
      const hash = `${missions.length}:${missions[0]?.id}:${missions[missions.length-1]?.id}:${st}:${spd}`
      if (cache[driverId]?.hash === hash) { results[driverId] = cache[driverId].result; continue }
      const sorted = [...missions].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      const result = calcTour(sorted, driver.depotLat, driver.depotLng, st, spd, undefined, {
        costPerKm: tenantSettings.costPerKm,
        fuelCostPerLiter: tenantSettings.fuelCostPerLiter,
        consumptionLPer100: tenantSettings.consumptionLPer100,
      })
      cache[driverId] = { result, hash }
      results[driverId] = result
    }
    return results
  }, [driverMap, plans, startTimes, speeds, planDate, tenantSettings])

  const dashboardStats = useMemo(() => {
    const mArr = Array.isArray(missions) ? missions : []
    const dArr = Array.isArray(drivers) ? drivers : []
    const planSuffix = `|${planDate}`
    const nonSyntheticActive = mArr.filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived)
    const poolTotal  = nonSyntheticActive.length
    const poolToday  = nonSyntheticActive.filter(m => m.date === planDate).length
    const p1Count    = nonSyntheticActive.filter(m => m.priority === 1).length
    const totalDrivers      = dArr.filter(d => !d.archived).length
    const driversWithPlan   = dArr.filter(d => !d.archived && (plans[`${d.id}${planSuffix}`] || []).length > 0).length
    const calcVals   = Object.values(calcResults)
    const totalKm    = Math.round(calcVals.reduce((s, r) => s + (r?.totalRoadDistKm ?? 0), 0) * 10) / 10
    const totalFuelEur = calcVals.reduce((s, r) => s + (r?.fuelCostEur ?? 0), 0)
    const active     = calcVals.filter(r => r && r.totalDurationMin > 0)
    const avgWorkMin = active.length > 0 ? Math.round(active.reduce((s, r) => s + (r?.totalDurationMin ?? 0), 0) / active.length) : 0
    const planEntries = Object.entries(plans).filter(([key]) => key.endsWith(planSuffix))
    const assignedForDate      = planEntries.flatMap(([, plan]) => plan.filter(m => !m.isSynthetic)).length
    const p1AssignedForDate    = planEntries.flatMap(([, plan]) => plan.filter(m => !m.isSynthetic && m.priority === 1)).length
    const driversWithPlanForDate = dArr.filter(d => (plans[`${d.id}${planSuffix}`] || []).length > 0).length
    return { poolTotal, poolToday, p1Count, driversWithPlan, totalDrivers, totalKm, totalFuelEur, avgWorkMin, assignedForDate, p1AssignedForDate, driversWithPlanForDate }
  }, [missions, drivers, plans, calcResults, planDate])

  type MissionStatus = 'todo' | 'doing' | 'done'
  const [driverStatuses, setDriverStatuses] = useState<Record<string, Record<string, MissionStatus>>>({})
  const [showAlerts, setShowAlerts] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    async function pollStatuses() {
      try {
        const res = await fetch(`/api/driver-status?date=${planDate}`, { signal: ctrl.signal })
        if (res.ok) {
          const data = await res.json()
          setDriverStatuses(data)
        }
      } catch (e) {
        if (e instanceof Error && e.name !== 'AbortError') {  }
      }
    }
    pollStatuses()
    const interval = setInterval(pollStatuses, 30_000)
    return () => { ctrl.abort(); clearInterval(interval) }
  }, [planDate])

  const alerts = useMemo(() => {
    const result: Array<{ id: string; level: 'error' | 'warning' | 'info'; message: string }> = []
    const todayStr = today()

    const assignedIds = new Set<string>()
    for (const plan of Object.values(plans)) {
      for (const pm of plan) assignedIds.add(pm.id)
    }

    const p1Unassigned = ( Array.isArray(missions) ? missions : [] ).filter(m =>
      m.priority === 1 &&
      m.date === todayStr &&
      !SYNTHETIC_TYPES.includes(m.type) &&
      !assignedIds.has(m.id)
    )
    if (p1Unassigned.length > 0) {
      result.push({
        id: 'p1-unassigned',
        level: 'error',
        message: `${p1Unassigned.length} mission${p1Unassigned.length > 1 ? 's' : ''} P1 urgente${p1Unassigned.length > 1 ? 's' : ''} non assignée${p1Unassigned.length > 1 ? 's' : ''} aujourd'hui`,
      })
    }

    const driversNoTour = ( Array.isArray(drivers) ? drivers : [] ).filter(d => {
      const key = `${d.id}|${todayStr}`
      return (plans[key] || []).filter(m => !m.isSynthetic).length === 0 && !isUnavailable(d.id, todayStr)
    })
    if (driversNoTour.length > 0) {
      result.push({
        id: 'no-tour',
        level: 'warning',
        message: `${driversNoTour.length} ${driversNoTour.length > 1 ? vocab.drivers.toLowerCase() : vocab.driver.toLowerCase()} sans tournée planifiée aujourd'hui`,
      })
    }

    for (const [driverId, res] of Object.entries(calcResults)) {
      if (!res) continue
      const driver = driverMap.get(driverId)
      if (!driver) continue
      const errors = res.warnings.filter(w => w.severity === 'error')
      if (errors.length > 0) {
        result.push({
          id: `legal-${driverId}`,
          level: 'error',
          message: `${driver.firstName} ${driver.lastName} : ${errors[0].message}`,
        })
      }
    }

    const noGps = ( Array.isArray(missions) ? missions : [] ).filter(m =>
      m.latitude === 0 && m.longitude === 0 && !SYNTHETIC_TYPES.includes(m.type)
    ).length
    if (noGps > 0) {
      result.push({
        id: 'no-gps',
        level: 'warning',
        message: `${noGps} mission${noGps > 1 ? 's' : ''} sans coordonnées GPS`,
      })
    }

    return result
  }, [missions, plans, drivers, driverMap, isUnavailable, calcResults, vocab.driver, vocab.drivers])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      if (e.key === 'Escape') {
        setMissionModal({ kind: 'none' })
        setDriverModal(null)
        setMissionDetail(null)
        setDriverDetail(null)
        setConfirmOverride(null)
        setShowValidation(false)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); undo(); return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); redo(); return
      }

      const hasModal =
        missionModal.kind !== 'none' ||
        driverModal !== null ||
        missionDetail !== null ||
        driverDetail !== null ||
        confirmOverride !== null ||
        showValidation
      if (hasModal) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setMissionModal({ kind: 'new', date: today() })
      }
      if (e.key === 't') {
        e.preventDefault()
        setActiveTab('tours')
      }
      if (e.key === 'd') {
        e.preventDefault()
        setActiveTab('dashboard')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [missionModal, driverModal, missionDetail, driverDetail, confirmOverride, showValidation, setActiveTab, undo, redo])

  function handleDrop(driverId: string) {
    if (!draggedId) return

    if (isUnavailable(driverId, planDate)) return

    if (dragSource?.from === 'plan' && dragSource.driverId !== driverId) {
      unassignFromDriver(draggedId, dragSource.driverId, dragSource.date)
    }

    if (dragSource?.from !== 'plan' || dragSource.driverId !== driverId) {
      assignToDriver(draggedId, driverId, planDate)
    }
    setDraggedId(null)
    setDragSource(null)
  }

  // Stable ref: passed as prop to TopPanel — useCallback prevents child re-render on unrelated state changes
  const handleDropOnPool = useCallback(() => {
    if (!draggedId || !dragSource || dragSource.from !== 'plan') return
    unassignFromDriver(draggedId, dragSource.driverId, dragSource.date)
    setDraggedId(null)
    setDragSource(null)
  }, [draggedId, dragSource, unassignFromDriver])

  // Stable ref: passed as prop to TopPanel
  const handleReschedule = useCallback((missionId: string, newDate: string) => {
    const mission = (Array.isArray(missions) ? missions : []).find(m => m.id === missionId)
    if (!mission || mission.date === newDate) return
    updateMission(missionId, { date: newDate })
    setDraggedId(null)
    setDragSource(null)
    fetch(`/api/missions/${missionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: newDate }),
    }).then(res => {
      if (res.ok) toastSuccess(`Mission déplacée au ${new Date(newDate + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}`)
      else res.json().then(e => toastError(e?.error ?? 'Erreur serveur')).catch(() => toastError('Erreur serveur'))
    }).catch(() => toastError('Erreur serveur'))
  }, [missions, updateMission, toastSuccess, toastError])

  // Stable ref: passed as prop to BottomPanel and ToursTab
  const handleEditPlanned = useCallback((m: PlannedMission, driverId: string, date: string) => {
    setMissionModal({ kind: 'edit-planned', mission: m, driverId, date })
  }, [])

  const missionCount = useMemo(
    () => (Array.isArray(missions) ? missions : []).filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived).length,
    [missions],
  )
  // NAV_ITEMS rebuilt only when vocab or mission badge changes — avoids re-creating JSX every render
  const NAV_ITEMS = useMemo<{ id: AppTab; label: string; icon: React.ReactNode; section?: string; adminOnly?: boolean; permission?: string; badge?: number }[]>(() => [

    { id: 'dashboard', label: 'Dashboard', section: 'Dispatch', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg> },
    { id: 'missions',  label: vocab.missions, badge: missionCount > 0 ? missionCount : undefined, icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 2v2M12 2v2M2.5 7h13M4 3.5h10a1.5 1.5 0 011.5 1.5v10a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 15V5A1.5 1.5 0 014 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id: 'tours',     label: vocab.tours, icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9a7 7 0 1114 0A7 7 0 012 9z" stroke="currentColor" strokeWidth="1.5"/><path d="M9 5.5V9l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id: 'stats',     label: 'Statistiques', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 13V9M9 13V5M13 13V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg> },
    { id: 'history',   label: 'Historique', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3v12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 12l3-4 3 2 3-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },

    { id: 'catalogue', label: 'Catalogue', section: 'Ressources', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 4h12M3 8h12M3 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="14" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M16 14l1.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id: 'drivers',   label: vocab.drivers, adminOnly: true, permission: 'manage_drivers', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M3 15.5c0-2.5 2.5-4.5 6-4.5s6 2 6 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id: 'vehicles',  label: vocab.vehicles, adminOnly: true, permission: 'manage_vehicles', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="5" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="5.5" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="12.5" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg> },
    { id: 'exutoires', label: vocab.exutoires, adminOnly: true, permission: 'manage_exutoires', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2L2 7v8a1 1 0 001 1h12a1 1 0 001-1V7L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg> },
    { id: 'templates', label: 'Recurrentes', adminOnly: true, permission: 'manage_missions', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9a6 6 0 1012 0A6 6 0 003 9z" stroke="currentColor" strokeWidth="1.5"/><path d="M9 6v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M1 9h2M15 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },

    { id: 'users',     label: 'Utilisateurs', section: 'Administration', adminOnly: true, permission: 'manage_users', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="13" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M1.5 15c0-2.2 2.2-4 5.5-4s5.5 1.8 5.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id: 'audit',     label: 'Audit', adminOnly: true, icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 3h8a2 2 0 012 2v10l-3-2-3 2-3-2-3 2V5a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5"/></svg> },
    { id: 'telematics',label: 'Telematique', adminOnly: true, permission: 'manage_integrations', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 15v-3M5 12l4 3 4-3M3 9l6 3 6-3M1 6l8 3 8-3-8-3-8 3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
    { id: 'settings',  label: 'Parametres', adminOnly: true, permission: 'manage_settings', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.4 3.4l1.4 1.4M13.2 13.2l1.4 1.4M3.4 14.6l1.4-1.4M13.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
    { id: 'weekly-plan', label: 'Planning semaine', section: 'Planification', adminOnly: true, permission: 'optimize', icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="3" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 2v2M12 2v2M2 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M5 11h2M8.5 11h2M12 11h1M5 13.5h2M8.5 13.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [vocab, missionCount])

  return (
    <>
    <OnboardingGuide mode="admin" />
    <main
      id="main-content"
      className="h-screen flex bg-surface-50 text-surface-900 overflow-hidden"
      onDragOver={e => { if (draggedId) e.preventDefault() }}
      onDrop={() => { setDraggedId(null) }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {}
      <aside className="sidebar flex-shrink-0 h-screen bg-white border-r border-surface-200 flex flex-col z-30 shadow-sidebar overflow-hidden">
        {}
        <div className="h-14 flex items-center gap-3 px-4 flex-shrink-0 border-b border-surface-100">
          <Image src="/logo%20seul.svg" alt="PATHÉLIX" width={32} height={32} className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="nav-label font-semibold text-surface-900 text-sm tracking-tight font-display">PATHÉLIX</span>
        </div>

        {}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" aria-label="Navigation principale">
          {NAV_ITEMS.filter(item => !item.adminOnly || isAdmin || (item.permission && hasPerm(permissions, item.permission))).map((item, i) => (
            <div key={item.id}>
              {item.section && (
                <div className={`nav-label text-[10px] font-semibold text-surface-400 uppercase tracking-wider px-3 ${i > 0 ? 'mt-5' : ''} mb-1.5`}>
                  {item.section}
                </div>
              )}
              <button
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${activeTab === item.id
                    ? 'bg-brand-50 text-brand-500'
                    : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700'}`}
              >
                <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">{item.icon}</span>
                <span className="nav-label flex-1">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="nav-label ml-auto bg-brand-100 text-brand-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none min-w-[20px] text-center">
                    {item.badge}
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>

        {}
        <div className="flex-shrink-0 border-t border-surface-100 p-2 space-y-1">
          <div className="nav-label flex items-center gap-2 px-2 py-1.5 text-[11px] text-surface-400">
            <span className="font-semibold text-surface-500">{( Array.isArray(drivers) ? drivers : [] ).length}</span> {vocab.drivers.toLowerCase()}
            <span className="text-surface-300">·</span>
            <span className="font-semibold text-surface-500">{( Array.isArray(missions) ? missions : [] ).filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived).length}</span> missions
          </div>
          <button type="button" title="Deconnexion" onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' })
            await usePlanningStore.persist.clearStorage()
            window.location.href = '/login'
          }}
            className="w-full flex items-center justify-center gap-2 px-2 py-2.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span className="nav-label">Deconnexion</span>
          </button>
        </div>
      </aside>

      {}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative ml-16 md:ml-16">

        {}
        <header className="h-14 flex-shrink-0 flex items-center gap-3 px-5 border-b border-surface-200 z-20 topbar-bg">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base font-semibold text-surface-900 capitalize truncate">
              {NAV_ITEMS.find(n => n.id === activeTab)?.label || 'Dashboard'}
            </h1>
            <span className="text-surface-300 text-sm">/</span>
            <span className="text-surface-400 text-sm truncate">
              {activeTab === 'dashboard' ? 'Vue d\'ensemble' :
               activeTab === 'missions' ? `${(Array.isArray(missions) ? missions : []).filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived).length} missions` :
               activeTab === 'tours' ? planDate :
               activeTab === 'drivers' ? `${(Array.isArray(drivers) ? drivers : []).filter(d => !d.archived).length} ${vocab.drivers.toLowerCase()}` :
               activeTab === 'catalogue' ? 'Clients, Sites, Produits' :
               activeTab === 'settings' ? 'Configuration' :
               ''}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {}
            <button type="button"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              title="Recherche globale (Ctrl+K)"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-surface-200 text-surface-400 hover:text-surface-600 hover:border-surface-300 text-xs transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M6 11A5 5 0 106 1a5 5 0 000 10zM12 12l-2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              <span>Ctrl+K</span>
            </button>
            {}
            <div className="relative">
              <button type="button" onClick={() => setShowAlerts(v => !v)} title="Alertes"
                aria-label={`Alertes${alerts.length > 0 ? ` (${alerts.length})` : ''}`}
                aria-expanded={showAlerts ? "true" : "false"}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-sm
                  ${alerts.length > 0 ? 'text-amber-500 hover:bg-amber-50' : 'text-surface-400 hover:text-surface-600 hover:bg-surface-100'}`}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7.5 15a1.5 1.5 0 003 0M9 2a5 5 0 00-5 5c0 2.5-1 4-1.5 4.5h13C15 11 14 9.5 14 7a5 5 0 00-5-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {alerts.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {alerts.filter(a => a.level === 'error').length || alerts.length}
                  </span>
                )}
              </button>
              {showAlerts && (
                <div className="absolute right-0 top-10 w-80 bg-white border border-surface-200 rounded-xl shadow-elevated z-50 overflow-hidden animate-fade-in" aria-live="polite">
                  <div className="px-4 py-2.5 border-b border-surface-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-surface-700">Alertes ({alerts.length})</span>
                    <button type="button" onClick={() => setShowAlerts(false)} title="Fermer" className="text-surface-400 hover:text-surface-600 text-xs">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 4L4 10M4 4l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  {alerts.length === 0 ? (
                    <div className="px-4 py-6 text-surface-400 text-xs text-center">Aucune alerte</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y divide-surface-100">
                      {alerts.map(a => (
                        <div key={a.id} className={`px-4 py-3 flex items-start gap-2.5 text-xs
                          ${a.level === 'error' ? 'text-red-600' : a.level === 'warning' ? 'text-amber-600' : 'text-blue-600'}`}>
                          <span className={`flex-shrink-0 mt-0.5 w-2 h-2 rounded-full ${a.level === 'error' ? 'bg-red-500' : a.level === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                          <span className="text-surface-600">{a.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {}
            <button type="button" onClick={() => setShowValidation(true)} title="Verifier le planning"
              className="w-8 h-8 flex items-center justify-center text-surface-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9l3.5 3.5L14 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {}
            <button type="button" onClick={() => window.location.reload()} title="Rafraichir"
              className="w-8 h-8 flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded-lg transition-colors">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9a6 6 0 0111.5-2.5M15 3v3.5h-3.5M15 9a6 6 0 01-11.5 2.5M3 15v-3.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <ThemeToggle />
          </div>
        </header>
        <GlobalSearch onNavigate={(tab) => setActiveTab(tab as Parameters<typeof setActiveTab>[0])} />

        {}
        {Object.keys(driverStatuses).length > 0 && (
          <div className="flex-shrink-0 flex items-center gap-3 px-5 py-1.5 border-b border-surface-100 bg-surface-50 overflow-x-auto">
            <span className="text-[10px] text-surface-400 uppercase tracking-wider font-semibold flex-shrink-0">En direct</span>
            {( Array.isArray(drivers) ? drivers : [] ).map(d => {
              const statuses = driverStatuses[d.id]
              if (!statuses) return null
              const plan = plans[`${d.id}|${planDate}`] || []
              const real = plan.filter(m => !m.isSynthetic)
              const done = real.filter(m => statuses[m.id] === 'done').length
              const doing = real.filter(m => statuses[m.id] === 'doing').length
              const total = real.length
              if (total === 0) return null
              return (
                <div key={d.id} className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[10px] text-surface-500 font-medium">{d.firstName}</span>
                  <div className="flex gap-0.5">
                    {real.map(m => (
                      <div key={m.id} className={`w-2 h-2 rounded-sm ${
                        statuses[m.id] === 'done' ? 'bg-emerald-500' :
                        statuses[m.id] === 'doing' ? 'bg-blue-500 animate-pulse' :
                        'bg-surface-200'
                      }`} />
                    ))}
                  </div>
                  <span className="text-[10px] text-surface-400">{done}/{total}</span>
                  {doing > 0 && <span className="text-[10px] text-blue-500 font-medium">en cours</span>}
                </div>
              )
            })}
          </div>
        )}

        {}

        {}

        {}
        {activeTab === 'dashboard' && <div role="tabpanel" id="tabpanel-dashboard" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60">
        <DashboardKPIBar
          poolTotal={dashboardStats.poolTotal}
          poolToday={dashboardStats.poolToday}
          driversWithPlan={dashboardStats.driversWithPlan}
          totalDrivers={dashboardStats.totalDrivers}
          p1Count={dashboardStats.p1Count}
          date={planDate}
          totalKm={dashboardStats.totalKm}
          totalFuelEur={dashboardStats.totalFuelEur}
          avgWorkMin={dashboardStats.avgWorkMin}
          unassignedCount={dashboardStats.poolToday}
        />

        {}
        <div className="flex-shrink-0 flex items-center gap-2 md:gap-3 px-3 md:px-5 py-2.5 border-b border-surface-100 bg-white overflow-x-auto">
          <span className="text-[10px] text-surface-400 uppercase tracking-widest font-semibold flex-shrink-0 hidden md:block capitalize">
            {displayShort(planDate)}
          </span>
          {[
            { label: 'Missions assignees',   value: dashboardStats.assignedForDate,         color: dashboardStats.assignedForDate > 0 ? 'text-emerald-600' : 'text-surface-300' },
            { label: 'Missions en pool',      value: dashboardStats.poolToday,              color: dashboardStats.poolToday > 0 ? 'text-brand-500' : 'text-surface-300' },
            { label: `${vocab.drivers} avec plan`,  value: `${dashboardStats.driversWithPlanForDate}/${dashboardStats.totalDrivers}`, color: dashboardStats.driversWithPlanForDate > 0 ? 'text-surface-900' : 'text-surface-300' },
            { label: 'P1 assignees',          value: dashboardStats.p1AssignedForDate,      color: dashboardStats.p1AssignedForDate > 0 ? 'text-emerald-600' : 'text-surface-300' },
          ].map(k => (
            <div key={k.label} className="flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-lg px-3 py-1.5 flex-shrink-0">
              <span className={`text-sm md:text-base font-bold tabular-nums leading-none ${k.color}`}>{k.value}</span>
              <span className="text-[8px] md:text-[9px] text-surface-400 uppercase tracking-wider whitespace-nowrap font-medium">{k.label}</span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setActiveTab('tours')}
            aria-label="Aller à l'onglet Tournées pour optimiser"
            className="ml-auto flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors shadow-sm"
          >
            <span>Optimiser les tournées</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <TopPanel
          poolDate={poolDate} setPoolDate={setPoolDate}
          view={poolView} setView={setPoolView}
          draggedId={draggedId}
          dragSource={dragSource}
          onDragStart={(id) => { setDraggedId(id); setDragSource({ from: 'pool' }) }}
          onDragEnd={() => { setDraggedId(null); setDragSource(null) }}
          onDropFromPlan={handleDropOnPool}
          onEditMission={(m) => setMissionModal({ kind: 'edit', mission: m })}
          onNewMission={(date) => { setMissionPrefill(null); setMissionModal({ kind: 'new', date }) }}
          onNewMissionWithPrefill={(date, fields) => { setMissionPrefill(fields); setMissionModal({ kind: 'new', date }) }}
          onViewMission={(m) => setMissionDetail(m)}
          onDeleteMission={(id) => handleDeleteMission(id).catch(()=>{})}
          onDuplicateMission={(id) => handleDuplicateMission(id).catch(()=>{})}
          topHeight={topHeight}
          drivers={(Array.isArray(drivers) ? drivers : [])}
          onBatchAssign={(ids, driverId) => { ids.forEach(id => assignToDriver(id, driverId, planDate)) }}
          onReschedule={handleReschedule}
        />

        <div onMouseDown={onDividerMouseDown}
          className="h-2 flex-shrink-0 flex items-center justify-center cursor-row-resize group bg-surface-100 hover:bg-surface-200 transition-colors">
          <div className="w-16 h-0.5 rounded-full bg-surface-300 group-hover:bg-brand-500 transition-colors" />
        </div>

        <BottomPanel
          planDate={planDate} setPlanDate={setPlanDate}
          draggedId={draggedId}
          onDrop={handleDrop}
          onDragStartFromPlan={(missionId, driverId) => { setDraggedId(missionId); setDragSource({ from: 'plan', driverId, date: planDate }) }}
          onDragEnd={() => { setDraggedId(null); setDragSource(null) }}
          calcResults={calcResults}
          onEditPlanned={handleEditPlanned}
          onExportPdf={() => {
            const tours = (Array.isArray(drivers) ? drivers : [])
              .filter(d => !d.archived && (plans[`${d.id}|${planDate}`] || []).length > 0)
              .map(d => ({
                driver: d,
                plan: plans[`${d.id}|${planDate}`] || [],
                result: calcResults[d.id] || null,
                date: planDate,
                startTime: startTimes[`${d.id}|${planDate}`] || tenantSettings.defaultStartTime,
              }))
            if (tours.length === 0) return
            exportTourSheetPdf(tours)
          }}
          onNewDriver={() => setDriverModal({ kind: 'new' })}
          onViewDriver={(d) => setDriverDetail(d)}
          onViewMission={(m) => setMissionDetail(m)}
          defaultStartTime={tenantSettings.defaultStartTime}
        />
      </div>}

      {activeTab === 'drivers' && (
        <div role="tabpanel" id="tabpanel-drivers" aria-labelledby="tab-drivers" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60">
        <DriversTab
          onEdit={(d) => setDriverModal({ kind: 'edit', driver: d })}
          onNew={() => setDriverModal({ kind: 'new' })}
          onDelete={(id) => handleDeleteDriver(id).catch(()=>{})}
          onImportDriversCSV={handleImportDriversCSV}
        />
        </div>
      )}

      {activeTab === 'missions' && (
        <div role="tabpanel" id="tabpanel-missions" aria-labelledby="tab-missions" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60">
        <MissionsTab
          onEdit={(m) => setMissionModal({ kind: 'edit', mission: m })}
          onNew={() => setMissionModal({ kind: 'new', date: today() })}
          onView={(m) => setMissionDetail(m)}
          onDelete={(id) => handleDeleteMission(id).catch(()=>{})}
          onDuplicate={(id) => handleDuplicateMission(id).catch(()=>{})}
          onImportCSV={handleImportMissionsCSV}
        />
        </div>
      )}

      {activeTab === 'tours' && (
        <div role="tabpanel" id="tabpanel-tours" aria-labelledby="tab-tours" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60">
        <ToursTab
          onEditPlanned={handleEditPlanned}
          onViewMission={(m) => setMissionDetail(m)}
        />
        </div>
      )}

      {activeTab === 'exutoires' && <div role="tabpanel" id="tabpanel-exutoires" aria-labelledby="tab-exutoires" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><ExutoiresTab /></div>}
      {activeTab === 'stats' && <div role="tabpanel" id="tabpanel-stats" aria-labelledby="tab-stats" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><StatsTab /></div>}
      {activeTab === 'templates' && (
        <div role="tabpanel" id="tabpanel-templates" aria-labelledby="tab-templates" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><TemplatesTab onGenerate={(missions) => missions.forEach(m => handleSaveMission(m).catch(logErr('api')))} /></div>
      )}
      {activeTab === 'vehicles' && <div role="tabpanel" id="tabpanel-vehicles" aria-labelledby="tab-vehicles" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><VehiclesTab /></div>}
      {activeTab === 'history' && <div role="tabpanel" id="tabpanel-history" aria-labelledby="tab-history" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><HistoryTab tourDate={planDate} /></div>}
      {activeTab === 'users' && <div role="tabpanel" id="tabpanel-users" aria-labelledby="tab-users" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><UsersTab /></div>}
      {activeTab === 'audit' && <div role="tabpanel" id="tabpanel-audit" aria-labelledby="tab-audit" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><AuditTab /></div>}
      {activeTab === 'telematics' && <div role="tabpanel" id="tabpanel-telematics" aria-labelledby="tab-telematics" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><TelematicsTab date={planDate} /></div>}
      {activeTab === 'catalogue' && <div role="tabpanel" id="tabpanel-catalogue" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><CatalogueTab readOnly={!isAdmin} /></div>}
      {activeTab === 'settings' && <div role="tabpanel" id="tabpanel-settings" aria-labelledby="tab-settings" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><SettingsTab /></div>}
      {activeTab === 'weekly-plan' && <div role="tabpanel" id="tabpanel-weekly-plan" aria-labelledby="tab-weekly-plan" className="flex-1 overflow-hidden flex flex-col relative z-10 bg-surface-50/60"><WeeklyPlanTab onNavigateToTours={(date) => { setPlanDate(date); setActiveTab('tours') }} /></div>}

      {}
      {missionModal.kind === 'new' && (
        <MissionForm title="Nouvelle mission"
          initial={{ ...blankMission(missionModal.date), ...(missionPrefill ?? {}) }}
          onSave={(data) => { handleSaveMission(data).catch(()=>{}); setMissionModal({ kind: 'none' }); setMissionPrefill(null) }}
          onClose={() => { setMissionModal({ kind: 'none' }); setMissionPrefill(null) }} />
      )}
      {missionModal.kind === 'edit' && (
        <MissionForm title="Modifier la mission" initial={missionModal.mission}
          onSave={(data) => { handleSaveMission(data, missionModal.mission.id).catch(()=>{}); setMissionModal({ kind: 'none' }) }}
          onClose={() => setMissionModal({ kind: 'none' })} />
      )}
      {missionModal.kind === 'edit-planned' && (
        <MissionForm title="Modifier la mission planifiée" initial={missionModal.mission}
          onSave={(data) => {
            updatePlannedMission(missionModal.mission.id, missionModal.driverId, missionModal.date, data)
            setMissionModal({ kind: 'none' })
          }}
          onClose={() => setMissionModal({ kind: 'none' })} />
      )}
      {driverModal?.kind === 'new' && (
        <DriverForm title={`Nouveau ${vocab.driver.toLowerCase()}`} initial={BLANK_DRIVER}
          onSave={(data) => { handleSaveDriver(data).catch(()=>{}); setDriverModal(null) }}
          onClose={() => setDriverModal(null)} />
      )}
      {driverModal?.kind === 'edit' && (
        <DriverForm title={`Modifier le ${vocab.driver.toLowerCase()}`} initial={driverModal.driver}
          onSave={(data) => { handleSaveDriver(data, driverModal.driver.id).catch(()=>{}); setDriverModal(null) }}
          onClose={() => setDriverModal(null)} />
      )}
      {missionDetail && (
        <MissionDetailModal
          mission={missionDetail}
          onEdit={() => { setMissionModal({ kind: 'edit', mission: missionDetail }); setMissionDetail(null) }}
          onDelete={() => {
            const id = missionDetail.id
            if (( Array.isArray(missions) ? missions : [] ).some(m => m.id === id)) {
              handleDeleteMission(id).catch(()=>{})
            } else {
              for (const [key, plan] of Object.entries(plans)) {
                if (plan.some(m => m.id === id)) {
                  const parts = key.split('|')
                  unassignFromDriver(id, parts[0], parts[1])
                  break
                }
              }
            }
            setMissionDetail(null)
          }}
          onDuplicate={() => { handleDuplicateMission(missionDetail.id).catch(()=>{}) }}
          onClose={() => setMissionDetail(null)}
          onAssign={(driverId, date) => {
            assignToDriver(missionDetail.id, driverId, date)
            setMissionDetail(null)
          }}
        />
      )}
      {driverDetail && (
        <DriverDetailModal
          driver={driverDetail}
          result={calcResults[driverDetail.id] || null}
          plan={plans[`${driverDetail.id}|${planDate}`] || []}
          planDate={planDate}
          onEdit={() => { setDriverModal({ kind: 'edit', driver: driverDetail }); setDriverDetail(null) }}
          onDelete={() => { handleDeleteDriver(driverDetail.id).catch(()=>{}); setDriverDetail(null) }}
          onClose={() => setDriverDetail(null)}
        />
      )}
      <ConfirmOverrideModal
        state={confirmOverride}
        onConfirm={() => {
          if (!confirmOverride) return
          setManualStartMin(confirmOverride.missionId, confirmOverride.driverId, confirmOverride.date, confirmOverride.pendingStartMin)
          setConfirmOverride(null)
        }}
        onCancel={() => setConfirmOverride(null)}
      />

      {}
      {showValidation && (() => {
        const todayStr = planDate
        const checks: Array<{ level: 'error' | 'warning' | 'ok'; message: string }> = []

        const p1Pool = (Array.isArray(missions) ? missions : []).filter(m =>
          m.priority === 1 && m.date === todayStr && !SYNTHETIC_TYPES.includes(m.type) && !m.archived &&
          !Object.values(plans).some(plan => plan.some(pm => pm.id === m.id))
        )
        checks.push(p1Pool.length > 0
          ? { level: 'error', message: `${p1Pool.length} mission${p1Pool.length > 1 ? 's' : ''} P1 non assignée${p1Pool.length > 1 ? 's' : ''}` }
          : { level: 'ok', message: 'Toutes les missions P1 sont assignées' })

        const driversEmpty = (Array.isArray(drivers) ? drivers : []).filter(d =>
          !d.archived && !isUnavailable(d.id, todayStr) &&
          (plans[`${d.id}|${todayStr}`] || []).filter(m => !m.isSynthetic).length === 0
        )
        checks.push(driversEmpty.length > 0
          ? { level: 'warning', message: `${driversEmpty.length} ${driversEmpty.length > 1 ? vocab.drivers.toLowerCase() : vocab.driver.toLowerCase()} disponible${driversEmpty.length > 1 ? 's' : ''} sans tournée` }
          : { level: 'ok', message: `Tous les ${vocab.drivers.toLowerCase()} disponibles ont une tournée` })

        const legalErrors = Object.entries(calcResults).filter(([, r]) => r?.warnings.some(w => w.severity === 'error'))
        checks.push(legalErrors.length > 0
          ? { level: 'error', message: `${legalErrors.length} ${legalErrors.length > 1 ? vocab.drivers.toLowerCase() : vocab.driver.toLowerCase()} avec violation${legalErrors.length > 1 ? 's' : ''} légale${legalErrors.length > 1 ? 's' : ''}` }
          : { level: 'ok', message: 'Aucune violation légale CE 561/2006' })

        const noGps = (Array.isArray(missions) ? missions : []).filter(m =>
          m.latitude === 0 && m.longitude === 0 && !SYNTHETIC_TYPES.includes(m.type) && !m.archived && m.date === todayStr
        )
        checks.push(noGps.length > 0
          ? { level: 'warning', message: `${noGps.length} mission${noGps.length > 1 ? 's' : ''} sans coordonnées GPS` }
          : { level: 'ok', message: 'Toutes les missions ont des coordonnées GPS' })

        const poolCount = (Array.isArray(missions) ? missions : []).filter(m =>
          !SYNTHETIC_TYPES.includes(m.type) && !m.archived && m.date === todayStr &&
          !Object.values(plans).some(plan => plan.some(pm => pm.id === m.id))
        ).length
        checks.push(poolCount > 0
          ? { level: 'warning', message: `${poolCount} mission${poolCount > 1 ? 's' : ''} encore dans le pool (non assignée${poolCount > 1 ? 's' : ''})` }
          : { level: 'ok', message: 'Toutes les missions du jour sont assignées' })

        const hasErrors = checks.some(c => c.level === 'error')
        const hasWarnings = checks.some(c => c.level === 'warning')

        return (
          <div className="fixed inset-0 bg-surface-900/30 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowValidation(false)}>
            <div className="bg-white border border-surface-200 rounded-2xl w-full max-w-md overflow-hidden shadow-modal" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100">
                <h2 className="text-surface-900 font-semibold text-base">
                  Validation — {displayShort(todayStr)}
                </h2>
                <button type="button" onClick={() => setShowValidation(false)} title="Fermer" className="text-surface-400 hover:text-surface-600 w-8 h-8 flex items-center justify-center hover:bg-surface-100 rounded-lg transition-colors">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 4L4 10M4 4l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div className="px-6 py-4 space-y-2">
                {checks.map((c, i) => (
                  <div key={i} className={`flex items-center gap-2.5 text-xs px-3 py-2.5 rounded-lg border
                    ${c.level === 'error' ? 'bg-red-50 text-red-700 border-red-200'
                    : c.level === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    <span className={`flex-shrink-0 w-2 h-2 rounded-full ${c.level === 'error' ? 'bg-red-500' : c.level === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                    <span>{c.message}</span>
                  </div>
                ))}
              </div>
              <div className={`px-6 py-3 border-t border-surface-100 text-center text-xs font-semibold
                ${hasErrors ? 'text-red-600' : hasWarnings ? 'text-amber-600' : 'text-emerald-600'}`}>
                {hasErrors ? 'Le planning necessite des corrections' : hasWarnings ? 'Le planning est pret avec quelques avertissements' : 'Le planning est parfait !'}
              </div>
            </div>
          </div>
        )
      })()}

      </div>{}

      {}
      <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 bg-white border-t border-surface-200 z-40 items-center justify-around px-1 py-1.5 safe-area-bottom">
        {[
          { id: 'dashboard' as AppTab, icon: '⬡', label: 'Home' },
          { id: 'missions' as AppTab, icon: '📋', label: 'Missions' },
          { id: 'tours' as AppTab, icon: '🗺', label: 'Tournees' },
          { id: 'stats' as AppTab, icon: '📊', label: 'Stats' },
          { id: 'catalogue' as AppTab, icon: '📦', label: 'Catalogue' },
        ].map(tab => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors min-w-[56px]
              ${activeTab === tab.id ? 'text-brand-500' : 'text-surface-400'}`}>
            <span className="text-lg leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </main>
    </>
  )
}
