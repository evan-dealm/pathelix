'use client'

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Driver, PlannedMission } from '@/lib/types'
import { TourResult } from '@/lib/algorithm'
import { usePlanningStore } from '@/stores/planningStore'
import { TL_HOURS } from '../types'
import { Btn, DateNav } from '../ui'
import { displayFull, tlLeft } from '../hooks'
import { DriverRow } from './DriverRow'
import { GanttPanel } from './GanttPanel'
import { useToast } from '@/components/ui/Toast'

const LOCALSTORAGE_NOTES_KEY = 'pathelix_plan_notes'
const LOCALSTORAGE_MIGRATED_KEY = 'pathelix_plan_notes_migrated_v1'

interface PlanningNoteEntry { text: string; updatedAt: string | null }

type DriverFilter = 'all' | 'with-plan' | 'empty' | 'available'

export function BottomPanel({ planDate, setPlanDate, draggedId, onDrop, onDragStartFromPlan, onDragEnd, calcResults, onEditPlanned, onNewDriver, onViewDriver, onViewMission, onExportPdf, defaultStartTime }: {
  planDate: string
  setPlanDate: (_d: string) => void
  draggedId: string | null
  onDrop: (_driverId: string) => void
  onDragStartFromPlan: (_missionId: string, _driverId: string) => void
  onDragEnd: () => void
  calcResults: Record<string, TourResult | null>
  onEditPlanned: (_m: PlannedMission, _driverId: string, _date: string) => void
  onNewDriver: () => void
  onViewDriver: (_driver: Driver) => void
  onViewMission: (_m: PlannedMission) => void
  onExportPdf?: () => void
  defaultStartTime?: string
}) {
  const storeDrivers = usePlanningStore(s => s.drivers)
  const storePlans = usePlanningStore(s => s.plans)
  const storeStartTimes = usePlanningStore(s => s.startTimes)

  const isUnavailable = usePlanningStore(s => s.isUnavailable)
  const isPlanLocked = usePlanningStore(s => s.isPlanLocked)
  const togglePlanLock = usePlanningStore(s => s.togglePlanLock)
  const setStartTime = usePlanningStore(s => s.setStartTime)
  const unassignFromDriver = usePlanningStore(s => s.unassignFromDriver)
  const clearDriverPlan = usePlanningStore(s => s.clearDriverPlan)
  const moveUp = usePlanningStore(s => s.moveUp)
  const moveDown = usePlanningStore(s => s.moveDown)
  const assignToDriver = usePlanningStore(s => s.assignToDriver)
  const copyPlansToDate = usePlanningStore(s => s.copyPlansToDate)
  const [viewMode, setViewMode] = useState<'list' | 'gantt'>('list')
  const [overDriverId, setOverDriverId] = useState<string | null>(null)
  const [showCopyPicker, setShowCopyPicker] = useState(false)
  const [copyTargetDate, setCopyTargetDate] = useState('')

  const { error: toastError } = useToast()
  const [notes, setNotes] = useState<Record<string, PlanningNoteEntry>>({})
  const [showNotes, setShowNotes] = useState(false)
  const noteSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // One-time migration of pre-existing localStorage notes into the shared PlanningNote table —
  // they used to be per-browser only, silently unshared between dispatchers.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(LOCALSTORAGE_MIGRATED_KEY)) return
    let raw: Record<string, string> = {}
    try { raw = JSON.parse(localStorage.getItem(LOCALSTORAGE_NOTES_KEY) || '{}') } catch { /* ignore */ }
    const entries = Object.entries(raw).filter(([, text]) => text && text.trim())
    if (entries.length === 0) {
      localStorage.setItem(LOCALSTORAGE_MIGRATED_KEY, '1')
      return
    }
    void (async () => {
      for (const [date, text] of entries) {
        try {
          await fetch('/api/planning-notes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, text, expectedUpdatedAt: null }),
          })
        } catch { /* best-effort — leave localStorage in place if migration fails, retry next load */ }
      }
      localStorage.setItem(LOCALSTORAGE_MIGRATED_KEY, '1')
      localStorage.removeItem(LOCALSTORAGE_NOTES_KEY)
    })()
  }, [])

  const fetchedDatesRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (fetchedDatesRef.current.has(planDate)) return
    fetchedDatesRef.current.add(planDate)
    void (async () => {
      try {
        const res = await fetch(`/api/planning-notes?date=${planDate}`)
        if (!res.ok) return
        const data = await res.json() as { date: string; text: string; updatedAt: string | null }
        setNotes(prev => ({ ...prev, [planDate]: { text: data.text, updatedAt: data.updatedAt } }))
      } catch { /* keep whatever was cached locally, if anything */ }
    })()
  }, [showNotes, planDate])

  function updateNote(date: string, text: string) {
    const prevEntry = notes[date]
    setNotes(prev => ({ ...prev, [date]: { text, updatedAt: prevEntry?.updatedAt ?? null } }))

    const timers = noteSaveTimers.current
    const existingTimer = timers.get(date)
    if (existingTimer) clearTimeout(existingTimer)
    timers.set(date, setTimeout(async () => {
      timers.delete(date)
      try {
        const res = await fetch('/api/planning-notes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, text, expectedUpdatedAt: prevEntry?.updatedAt ?? null }),
        })
        if (res.status === 409) {
          const conflict = await res.json() as { current: PlanningNoteEntry }
          toastError('Note modifiée par un autre utilisateur — conservez votre texte avant de recharger')
          setNotes(prev => ({ ...prev, [date]: conflict.current }))
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const saved = await res.json() as { text: string; updatedAt: string | null }
        setNotes(prev => ({ ...prev, [date]: { text: saved.text, updatedAt: saved.updatedAt } }))
      } catch {
        toastError('Échec de la sauvegarde de la note')
      }
    }, 600))
  }

  const [driverFilter, setDriverFilter] = useState<DriverFilter>('all')

  const [groupBySector, setGroupBySector] = useState(false)

  const [compact, setCompact] = useState(false)

  const baseDrivers = useMemo(
    () => (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived),
    [storeDrivers],
  )

  const activeDrivers = useMemo(() => {

    if (driverFilter === 'all') return baseDrivers
    if (driverFilter === 'with-plan') {
      return baseDrivers.filter(d => (storePlans[`${d.id}|${planDate}`] || []).length > 0)
    }
    if (driverFilter === 'empty') {
      return baseDrivers.filter(d => (storePlans[`${d.id}|${planDate}`] || []).length === 0)
    }
    if (driverFilter === 'available') {
      return baseDrivers.filter(d => !isUnavailable(d.id, planDate))
    }
    return baseDrivers
  }, [baseDrivers, driverFilter, storePlans, planDate, isUnavailable])

  const sectorGroups = useMemo(() => {
    if (!groupBySector) return null
    const map = new Map<string, Driver[]>()
    for (const d of activeDrivers) {
      const sector = d.sector || 'Sans secteur'
      if (!map.has(sector)) map.set(sector, [])
      map.get(sector)!.push(d)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'fr'))
  }, [activeDrivers, groupBySector])

  function handleCopyPlans() {
    if (!copyTargetDate) return
    copyPlansToDate(planDate, copyTargetDate)
    setShowCopyPicker(false)
    setCopyTargetDate('')
  }

  type VirtualItem = { type: 'driver'; driver: Driver } | { type: 'sector'; sector: string; count: number }
  const virtualItems = useMemo<VirtualItem[]>(() => {
    if (sectorGroups) {
      const items: VirtualItem[] = []
      for (const [sector, driversInSector] of sectorGroups) {
        items.push({ type: 'sector', sector, count: driversInSector.length })
        for (const d of driversInSector) items.push({ type: 'driver', driver: d })
      }
      return items
    }
    return activeDrivers.map(d => ({ type: 'driver' as const, driver: d }))
  }, [activeDrivers, sectorGroups])

  const driverListRef = useRef<HTMLDivElement>(null)
  const driverVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => driverListRef.current,
    estimateSize: useCallback((index: number) => {
      const item = virtualItems[index]
      if (item.type === 'sector') return 32
      return compact ? 40 : 56
    }, [virtualItems, compact]),
    overscan: 8,
  })

  function renderDriverRow(driver: Driver) {
    const key = `${driver.id}|${planDate}`
    const plan = storePlans[key] || []
    const startTime = storeStartTimes[key] || defaultStartTime || '07:00'
    const result = calcResults[driver.id] || null
    return (
      <div key={driver.id}
        onDragEnter={() => { if (draggedId) setOverDriverId(driver.id) }}
        onDragLeave={() => setOverDriverId(null)}
      >
        <DriverRow
          driver={driver}
          result={result}
          plan={plan}
          startTime={startTime}
          onDrop={() => onDrop(driver.id)}
          isOver={overDriverId === driver.id && draggedId !== null}
          onSetStartTime={(t) => setStartTime(driver.id, planDate, t)}
          onUnassign={(mId) => unassignFromDriver(mId, driver.id, planDate)}
          onClearPlan={() => clearDriverPlan(driver.id, planDate)}
          onEditMission={(m) => onEditPlanned(m, driver.id, planDate)}
          onMoveUp={(mId) => moveUp(mId, driver.id, planDate)}
          onMoveDown={(mId) => moveDown(mId, driver.id, planDate)}
          onViewDriver={() => onViewDriver(driver)}
          onViewMission={(m) => onViewMission(m)}
          onDragStartMission={(mId) => onDragStartFromPlan(mId, driver.id)}
          onDragEndMission={onDragEnd}
          unavailable={isUnavailable(driver.id, planDate)}
          locked={isPlanLocked(driver.id, planDate)}
          onToggleLock={() => togglePlanLock(driver.id, planDate)}
          compact={compact}
          allDrivers={activeDrivers}
          onCopyPlanTo={(targetDriverId) => {
            const srcPlan = storePlans[`${driver.id}|${planDate}`] || []
            for (const pm of srcPlan) {
              if (!pm.isSynthetic) assignToDriver(pm.id, targetDriverId, planDate)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {}
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2 md:py-2.5 border-b border-surface-200 flex-shrink-0 bg-surface-50/60">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-xs font-bold text-surface-600 uppercase tracking-widest">Planning</span>
        </div>
        <DateNav dateStr={planDate} setDate={setPlanDate} />
        <span className="text-surface-400 text-xs hidden md:block capitalize">{displayFull(planDate)}</span>
        <div className="ml-auto flex items-center gap-2">
          {draggedId && (
            <span className="text-[#0055A4] text-xs font-semibold animate-pulse bg-[#0055A4]/10 border border-[#0055A4]/30 rounded-full px-3 py-0.5">
              ↓ Déposer sur un chauffeur
            </span>
          )}

          {}
          <button type="button" onClick={() => setViewMode(v => v === 'gantt' ? 'list' : 'gantt')}
            title="Basculer vue Gantt"
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border
              ${viewMode === 'gantt' ? 'bg-[#0055A4]/15 text-[#0055A4] border-[#0055A4]/40' : 'bg-surface-100 text-surface-400 border-surface-200 hover:text-surface-600'}`}>
            📊 Gantt
          </button>

          {}
          <select value={driverFilter} onChange={e => setDriverFilter(e.target.value as DriverFilter)}
            title="Filtrer les chauffeurs"
            className="bg-surface-100 border border-surface-200/60 rounded-lg px-2 py-1 text-[11px] text-surface-500 focus:outline-none focus:border-[#0055A4]">
            <option value="all">Tous ({(Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived).length})</option>
            <option value="with-plan">Avec plan</option>
            <option value="empty">Sans plan</option>
            <option value="available">Disponibles</option>
          </select>

          {}
          <button type="button" onClick={() => setGroupBySector(g => !g)}
            title="Grouper par secteur"
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border
              ${groupBySector ? 'bg-[#0055A4]/15 text-[#0055A4] border-[#0055A4]/40' : 'bg-surface-100 text-surface-400 border-surface-200 hover:text-surface-600'}`}>
            📍 Secteurs
          </button>

          {}
          <button type="button" onClick={() => setCompact(c => !c)}
            title={compact ? 'Vue étendue' : 'Vue compacte'}
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border
              ${compact ? 'bg-[#0055A4]/15 text-[#0055A4] border-[#0055A4]/40' : 'bg-surface-100 text-surface-400 border-surface-200 hover:text-surface-600'}`}>
            {compact ? '▤' : '▥'}
          </button>

          <div className="relative">
            <Btn onClick={() => setShowCopyPicker(v => !v)} variant="ghost" size="sm">Copier</Btn>
            {showCopyPicker && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-surface-200 rounded-xl shadow-2xl z-50 p-3 w-56">
                <div className="text-xs text-surface-500 mb-2 font-semibold">Copier le planning vers :</div>
                <input type="date" value={copyTargetDate} onChange={e => setCopyTargetDate(e.target.value)}
                  title="Date cible pour la copie"
                  className="w-full bg-surface-100 border border-surface-200 rounded-lg px-2 py-1.5 text-xs text-surface-600 focus:outline-none focus:border-[#0055A4] mb-2" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleCopyPlans} disabled={!copyTargetDate}
                    className="flex-1 bg-[#0055A4] hover:bg-[#004080] disabled:opacity-40 disabled:cursor-not-allowed text-surface-900 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                    Copier
                  </button>
                  <button type="button" onClick={() => { setShowCopyPicker(false); setCopyTargetDate('') }}
                    className="text-xs text-surface-400 hover:text-surface-600 transition-colors">
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
          {}
          <button type="button" onClick={() => setShowNotes(n => !n)}
            title="Notes de planification"
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border
              ${notes[planDate]?.text ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40' : 'bg-surface-100 text-surface-400 border-surface-200 hover:text-surface-600'}`}>
            📝{notes[planDate]?.text ? ' ●' : ''}
          </button>
          {onExportPdf && <Btn onClick={onExportPdf} variant="ghost" size="sm">PDF</Btn>}
          <Btn onClick={onNewDriver} variant="ghost" size="sm">+ Chauffeur</Btn>
        </div>
      </div>

      {}
      {viewMode === 'gantt' && (
        <GanttPanel
          planDate={planDate}
          setPlanDate={setPlanDate}
          calcResults={calcResults}
          onEditPlanned={onEditPlanned}
          defaultStartTime={defaultStartTime}
        />
      )}

      {viewMode === 'list' && (
      <>
      {}
      {showNotes && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-surface-200 bg-surface-50">
          <textarea
            value={notes[planDate]?.text || ''}
            onChange={e => updateNote(planDate, e.target.value)}
            placeholder="Notes pour cette date (ex: Jean absent, exutoire Bonneville fermé…)"
            title="Notes de planification"
            rows={2}
            className="w-full bg-surface-100 border border-surface-200 rounded-lg px-3 py-2 text-xs text-surface-600 placeholder-surface-400 focus:outline-none focus:border-[#0055A4] transition-colors resize-none"
          />
        </div>
      )}

      {}
      <div className="flex flex-shrink-0 border-b border-surface-200 bg-surface-50 overflow-x-auto">
        <div className="w-28 md:w-44 flex-shrink-0 border-r border-surface-200 px-2 md:px-3 py-1.5 flex items-center">
          <span className="text-[8px] md:text-[9px] text-surface-300 uppercase tracking-widest font-bold">Chauffeur</span>
        </div>
        <div className="flex-1 relative min-w-[400px]" style={{ height: '26px' }}>
          {TL_HOURS.map(h => (
            <div key={h} className="absolute top-0 flex flex-col items-center pointer-events-none" style={{ left: tlLeft(h * 60) }}>
              <div className="h-1.5 w-px bg-surface-200/60 mt-1" />
              <span className="text-[8px] md:text-[9px] text-surface-300 -translate-x-1/2 mt-0.5 font-medium">
                {String(h).padStart(2, '0')}h
              </span>
            </div>
          ))}
        </div>
        <div className="w-8 flex-shrink-0 border-l border-surface-200" />
      </div>

      {}
      <div ref={driverListRef} className="flex-1 overflow-y-auto">
        {activeDrivers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 text-sm gap-2">
            <div className="text-3xl">🚛</div>
            <div>{driverFilter !== 'all' ? 'Aucun chauffeur ne correspond au filtre' : 'Aucun chauffeur enregistré'}</div>
            {driverFilter !== 'all'
              ? <Btn onClick={() => setDriverFilter('all')} variant="ghost" size="sm">Afficher tous</Btn>
              : <Btn onClick={onNewDriver} variant="ghost" size="sm">Ajouter un chauffeur</Btn>}
          </div>
        ) : (
          <div style={{ height: `${driverVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {driverVirtualizer.getVirtualItems().map(virtualRow => {
              const item = virtualItems[virtualRow.index]
              return (
                <div key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={driverVirtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}>
                  {item.type === 'sector' ? (
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-white/90 border-b border-surface-200 backdrop-blur-sm">
                      <span className="text-[10px] font-bold text-[#0055A4] uppercase tracking-widest">📍 {item.sector}</span>
                      <span className="text-[10px] text-surface-400">{item.count} chauffeur{item.count > 1 ? 's' : ''}</span>
                    </div>
                  ) : (
                    renderDriverRow(item.driver)
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}
