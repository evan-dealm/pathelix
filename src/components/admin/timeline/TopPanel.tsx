'use client'

import { useMemo, useState, useCallback } from 'react'
import { Mission, Driver, MissionType } from '@/lib/types'
import { usePlanningStore } from '@/stores/planningStore'
import { ViewMode, SYNTHETIC_TYPES } from '../types'
import { useTrade } from '@/providers/TradeProvider'
import { Btn, DateNav } from '../ui'
import { today, addDays, displayFull, displayShort, displayMonth, getWeekDays, getMonthWeeks, sameMonth, parseDate, useDebounce } from '../hooks'
import { MissionCard } from './MissionCard'
import { NaturalMissionInput, type ParsedMissionFields } from '../NaturalMissionInput'

type PoolSortKey = 'default' | 'priority' | 'timeWindow' | 'duration' | 'address'
const SORT_OPTIONS: { value: PoolSortKey; label: string }[] = [
  { value: 'default',    label: 'Par défaut' },
  { value: 'priority',   label: 'Priorité (P1 d\'abord)' },
  { value: 'timeWindow', label: 'Fenêtre horaire (serrée d\'abord)' },
  { value: 'duration',   label: 'Durée (longue d\'abord)' },
  { value: 'address',    label: 'Adresse (A→Z)' },
]

export function TopPanel({ poolDate, setPoolDate, view, setView, draggedId, dragSource, onDragStart, onDragEnd, onDropFromPlan, onEditMission, onNewMission, onNewMissionWithPrefill, onViewMission, onDeleteMission, onDuplicateMission, topHeight, onBatchAssign, onReschedule, drivers }: {
  poolDate: string
  setPoolDate: (_d: string) => void
  view: ViewMode
  setView: (_v: ViewMode) => void
  draggedId: string | null
  dragSource: { from: 'pool' } | { from: 'plan'; driverId: string; date: string } | null
  onDragStart: (_id: string) => void
  onDragEnd: () => void
  onDropFromPlan: () => void
  onEditMission: (_m: Mission) => void
  onNewMission: (_date: string) => void
  onNewMissionWithPrefill?: (_date: string, _fields: ParsedMissionFields) => void
  onViewMission: (_m: Mission) => void
  onDeleteMission: (_id: string) => void
  onDuplicateMission: (_id: string) => void
  topHeight: number
  onBatchAssign?: (_missionIds: string[], _driverId: string) => void
  onReschedule?: (_missionId: string, _newDate: string) => void
  drivers?: Driver[]
}) {
  const { missionIcon, missionLabel, enabledTypes } = useTrade()
  const poolTypes = useMemo(() => enabledTypes.filter(t => !SYNTHETIC_TYPES.includes(t)), [enabledTypes])
  const missions = usePlanningStore(s => s.missions)

  const assignedIds = usePlanningStore(
    useCallback((s: ReturnType<typeof usePlanningStore.getState>) => {
      const ids = new Set<string>()
      for (const plan of Object.values(s.plans)) {
        for (const pm of plan) ids.add(pm.id)
      }
      return ids
    }, []),

    (prev, next) => {
      if (prev.size !== next.size) return false
      for (const id of prev) if (!next.has(id)) return false
      return true
    },
  )
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchDropdown, setShowBatchDropdown] = useState(false)
  const [showNaturalInput, setShowNaturalInput] = useState(false)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

  function handleNaturalParsed(fields: ParsedMissionFields) {
    setShowNaturalInput(false)
    if (onNewMissionWithPrefill) {
      onNewMissionWithPrefill(poolDate, fields)
    } else {
      onNewMission(poolDate)
    }
  }

  const [filterType, setFilterType] = useState<MissionType | ''>('')
  const [filterPriority, setFilterPriority] = useState<'' | '1' | '2' | '3'>('')
  const [showFilters, setShowFilters] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 200)

  const [sortKey, setSortKey] = useState<PoolSortKey>('default')

  type GroupKey = '' | 'type' | 'priority'
  const [groupBy, setGroupBy] = useState<GroupKey>('')

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleBatchAssign(driverId: string) {
    if (onBatchAssign && selectedIds.size > 0) {
      onBatchAssign(Array.from(selectedIds), driverId)
    }
    setSelectedIds(new Set())
    setBatchMode(false)
    setShowBatchDropdown(false)
  }

  function cancelBatch() {
    setSelectedIds(new Set())
    setBatchMode(false)
    setShowBatchDropdown(false)
  }

  const weekDays = useMemo(() => getWeekDays(poolDate), [poolDate])
  const monthWeeks = useMemo(() => getMonthWeeks(poolDate), [poolDate])

  const rawPoolByDate = useMemo(() => {
    const map: Record<string, Mission[]> = {}
    missions
      .filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived && !assignedIds.has(m.id))
      .forEach(m => {
        if (!map[m.date]) map[m.date] = []
        map[m.date].push(m)
      })
    return map
  }, [missions, assignedIds])

  const missionsByDate = useMemo(() => {
    const map: Record<string, Mission[]> = {}
    const q = debouncedSearch.toLowerCase().trim()

    for (const [date, ms] of Object.entries(rawPoolByDate)) {
      let filtered = ms

      if (filterType) filtered = filtered.filter(m => m.type === filterType)

      if (filterPriority) {
        const p = Number(filterPriority)
        filtered = filtered.filter(m => m.priority === p)
      }

      if (q) {
        filtered = filtered.filter(m =>
          (m.clientName?.toLowerCase().includes(q)) ||
          (m.outletName?.toLowerCase().includes(q)) ||
          m.address.toLowerCase().includes(q) ||
          (m.wasteTypeLabel?.toLowerCase().includes(q)) ||
          (m.accessNotes?.toLowerCase().includes(q))
        )
      }

      if (sortKey !== 'default') {
        filtered = [...filtered].sort((a, b) => {
          switch (sortKey) {
            case 'priority':
              return (a.priority ?? 9) - (b.priority ?? 9)
            case 'timeWindow':
              return (a.timeWindow ? a.timeWindow.closeMin - a.timeWindow.openMin : 9999)
                   - (b.timeWindow ? b.timeWindow.closeMin - b.timeWindow.openMin : 9999)
            case 'duration':
              return (b.estimatedDurationMin + (b.maneuverTimeMin ?? 0))
                   - (a.estimatedDurationMin + (a.maneuverTimeMin ?? 0))
            case 'address':
              return a.address.localeCompare(b.address, 'fr')
            default: return 0
          }
        })
      }

      if (filtered.length > 0) map[date] = filtered
    }
    return map
  }, [rawPoolByDate, filterType, filterPriority, debouncedSearch, sortKey])

  const dayMissions = missionsByDate[poolDate] || []
  const hasActiveFilters = !!filterType || !!filterPriority || !!debouncedSearch

  const weekNavDate = useMemo(() => {
    const days = getWeekDays(poolDate)
    return days[0]
  }, [poolDate])

  return (
    <div
      className={`flex flex-col border-b border-surface-200 transition-colors ${dragSource?.from === 'plan' ? 'ring-2 ring-inset ring-[#0055A4]/40 bg-[#0055A4]/5' : ''}`}
      style={{ height: topHeight }}
      onDragOver={e => { if (dragSource?.from === 'plan') e.preventDefault() }}
      onDrop={e => { if (dragSource?.from === 'plan') { e.preventDefault(); e.stopPropagation(); onDropFromPlan() } }}
    >
      {}
      {dragSource?.from === 'plan' && (
        <div className="flex-shrink-0 text-center py-1 bg-[#0055A4]/10 border-b border-[#0055A4]/30 text-[#0055A4] text-xs font-semibold animate-pulse">
          ↑ Déposer ici pour retirer du planning
        </div>
      )}
      {}
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2 md:py-2.5 border-b border-surface-200 flex-shrink-0 bg-surface-50/60 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0055A4]" />
          <span className="text-xs font-bold text-surface-600 uppercase tracking-widest">Pool</span>
        </div>

        <div className="flex bg-surface-100/80 rounded-lg p-0.5 gap-0.5 border border-surface-200">
          {(['day', 'week', 'month'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${view === v ? 'bg-[#0055A4] text-surface-900 shadow-sm' : 'text-surface-400 hover:text-surface-600'}`}>
              {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : 'Mois'}
            </button>
          ))}
        </div>

        {view === 'day' && (
          <div className="flex items-center gap-2">
            <DateNav dateStr={poolDate} setDate={setPoolDate} />
            <span className="text-surface-400 text-xs hidden md:block capitalize">{displayFull(poolDate)}</span>
          </div>
        )}
        {view === 'week' && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPoolDate(addDays(weekNavDate, -7))}
              className="w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-colors text-sm">‹</button>
            <span className="text-surface-500 text-xs font-medium">
              {displayShort(weekDays[0])} — {displayShort(weekDays[6])}
            </span>
            <button onClick={() => setPoolDate(addDays(weekNavDate, 7))}
              className="w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-colors text-sm">›</button>
          </div>
        )}
        {view === 'month' && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPoolDate(addDays(poolDate, -28))}
              className="w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-colors text-sm">‹</button>
            <span className="text-surface-500 text-xs font-medium capitalize">{displayMonth(poolDate)}</span>
            <button onClick={() => setPoolDate(addDays(poolDate, 28))}
              className="w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-colors text-sm">›</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher…"
              className="w-36 md:w-44 bg-surface-100/80 border border-surface-200/60 rounded-lg pl-7 pr-2 py-1 text-xs text-surface-600 placeholder-surface-400 focus:outline-none focus:border-[#0055A4] transition-colors"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-surface-400 text-[10px] pointer-events-none">🔍</span>
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 text-[10px]">✕</button>
            )}
          </div>

          {}
          <button type="button" onClick={() => setShowFilters(f => !f)}
            className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors border
              ${showFilters || hasActiveFilters
                ? 'bg-[#0055A4]/15 text-[#0055A4] border-[#0055A4]/40'
                : 'bg-surface-100 text-surface-400 border-surface-200 hover:text-surface-600'}`}>
            ⚡ Filtres{hasActiveFilters ? ' ●' : ''}
          </button>

          {missions.filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived).length > 0 && (
            <span className="text-surface-400 text-xs bg-surface-100 border border-surface-200 rounded-full px-2.5 py-0.5 hidden md:block">
              {dayMissions.length}{hasActiveFilters ? ` / ${(rawPoolByDate[poolDate] || []).length}` : ''} {dayMissions.length === 1 ? 'mission' : 'missions'}
            </span>
          )}
          {onBatchAssign && drivers && drivers.length > 0 && (
            <Btn onClick={() => { setBatchMode(b => !b); setSelectedIds(new Set()); setShowBatchDropdown(false) }}
              variant={batchMode ? 'primary' : 'ghost'} size="sm">
              {batchMode ? '✓ Sélection' : 'Sélection'}
            </Btn>
          )}
          <Btn onClick={() => onNewMission(poolDate)} variant="primary" size="sm">+ Mission</Btn>
          <Btn onClick={() => setShowNaturalInput(true)} variant="ghost" size="sm" title="Saisie rapide par IA locale (Ollama)">✨ IA</Btn>
        </div>
      </div>

      {}
      {showNaturalInput && (
        <NaturalMissionInput
          date={poolDate}
          onParsed={handleNaturalParsed}
          onClose={() => setShowNaturalInput(false)}
        />
      )}

      {}
      {showFilters && (
        <div className="flex items-center gap-2 px-2 md:px-4 py-1.5 border-b border-surface-200 flex-shrink-0 bg-surface-50 flex-wrap">
          <span className="text-[9px] text-surface-400 uppercase tracking-wider font-bold">Filtrer</span>
          <select value={filterType} onChange={e => setFilterType(e.target.value as MissionType | '')}
            title="Filtrer par type de mission"
            className="bg-surface-100 border border-surface-200/60 rounded-lg px-2 py-0.5 text-xs text-surface-600 focus:outline-none focus:border-[#0055A4]">
            <option value="">Tous les types</option>
            {poolTypes.map(t => (
              <option key={t} value={t}>{missionIcon(t)} {missionLabel(t)}</option>
            ))}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as '' | '1' | '2' | '3')}
            title="Filtrer par priorité"
            className="bg-surface-100 border border-surface-200/60 rounded-lg px-2 py-0.5 text-xs text-surface-600 focus:outline-none focus:border-[#0055A4]">
            <option value="">Toutes priorités</option>
            <option value="1">🔥 P1 — Urgent</option>
            <option value="2">P2 — Normal</option>
            <option value="3">P3 — Faible</option>
          </select>

          <span className="text-surface-300 text-[9px]">│</span>
          <span className="text-[9px] text-surface-400 uppercase tracking-wider font-bold">Trier</span>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as PoolSortKey)}
            title="Trier les missions"
            className="bg-surface-100 border border-surface-200/60 rounded-lg px-2 py-0.5 text-xs text-surface-600 focus:outline-none focus:border-[#0055A4]">
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <span className="text-surface-300 text-[9px]">│</span>
          <span className="text-[9px] text-surface-400 uppercase tracking-wider font-bold">Grouper</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupKey)}
            title="Grouper les missions"
            className="bg-surface-100 border border-surface-200/60 rounded-lg px-2 py-0.5 text-xs text-surface-600 focus:outline-none focus:border-[#0055A4]">
            <option value="">Aucun</option>
            <option value="type">Par type</option>
            <option value="priority">Par priorité</option>
          </select>

          {(hasActiveFilters || groupBy) && (
            <button type="button" onClick={() => { setFilterType(''); setFilterPriority(''); setSearchQuery(''); setSortKey('default'); setGroupBy('') }}
              className="text-[10px] text-surface-400 hover:text-red-400 transition-colors ml-auto">
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {}
      <div className="flex-1 overflow-hidden">

        {}
        {view === 'day' && (
          <div className="h-full overflow-y-auto px-4 py-3">
            {dayMissions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-surface-400 text-sm">
                <div className="text-2xl mb-2">📭</div>
                <div>{hasActiveFilters ? 'Aucune mission ne correspond aux filtres' : 'Aucune mission pour ce jour'}</div>
                {hasActiveFilters
                  ? <button type="button" onClick={() => { setFilterType(''); setFilterPriority(''); setSearchQuery('') }} className="mt-2 text-[#0055A4] hover:underline text-xs">Réinitialiser les filtres</button>
                  : <button type="button" onClick={() => onNewMission(poolDate)} className="mt-2 text-[#0055A4] hover:underline text-xs">Créer une mission</button>}
              </div>
            ) : groupBy ? (

              (() => {
                const groups = new Map<string, Mission[]>()
                for (const m of dayMissions) {
                  const key = groupBy === 'type'
                    ? m.type
                    : m.priority ? `P${m.priority}` : 'Sans priorité'
                  if (!groups.has(key)) groups.set(key, [])
                  groups.get(key)!.push(m)
                }
                return (
                  <div className="space-y-4">
                    {Array.from(groups.entries()).map(([groupLabel, groupMissions]) => (
                      <div key={groupLabel}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold text-[#0055A4] uppercase tracking-widest">
                            {groupBy === 'type' ? `${missionIcon(groupLabel as MissionType)} ${missionLabel(groupLabel as MissionType) || groupLabel}` : groupLabel}
                          </span>
                          <span className="text-[10px] text-surface-400">{groupMissions.length}</span>
                          <div className="flex-1 h-px bg-surface-100" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                          {groupMissions.map(m => (
                            <MissionCard key={m.id} mission={m}
                              onView={() => onViewMission(m)} onEdit={() => onEditMission(m)}
                              onDelete={() => onDeleteMission(m.id)} onDuplicate={() => onDuplicateMission(m.id)}
                              dragging={draggedId === m.id} onDragStart={() => onDragStart(m.id)} onDragEnd={onDragEnd}
                              selectable={batchMode} selected={selectedIds.has(m.id)} onToggleSelect={() => toggleSelect(m.id)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {dayMissions.map(m => (
                  <MissionCard key={m.id} mission={m}
                    onView={() => onViewMission(m)}
                    onEdit={() => onEditMission(m)}
                    onDelete={() => onDeleteMission(m.id)}
                    onDuplicate={() => onDuplicateMission(m.id)}
                    dragging={draggedId === m.id}
                    onDragStart={() => onDragStart(m.id)}
                    onDragEnd={onDragEnd}
                    selectable={batchMode}
                    selected={selectedIds.has(m.id)}
                    onToggleSelect={() => toggleSelect(m.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {}
        {view === 'week' && (
          <div className="h-full overflow-x-auto">
            <div className="flex h-full" style={{ minWidth: `${weekDays.length * 175}px` }}>
              {weekDays.map(day => {
                const dayMs = missionsByDate[day] || []
                const isToday = day === today()
                const isWeekend = [0, 6].includes(parseDate(day).getDay())
                const isPast = day < today()
                const isDragTarget = draggedId && dragSource?.from === 'pool' && !isPast
                const isDragOver = dragOverDay === day
                const draggedMissionDate = draggedId ? missions.find(m => m.id === draggedId)?.date : undefined
                const isSameDay = draggedMissionDate === day
                return (
                  <div key={day}
                    className={`flex-1 min-w-[155px] border-r border-surface-200 last:border-r-0 flex flex-col transition-colors
                      ${isWeekend && !isDragOver ? 'bg-surface-50/60' : ''}
                      ${isDragOver && isDragTarget && !isSameDay ? 'bg-[#0055A4]/10 ring-2 ring-inset ring-[#0055A4]/40' : ''}
                      ${draggedId && dragSource?.from === 'pool' && isPast ? 'opacity-40' : ''}`}
                    onDragOver={e => {
                      if (isDragTarget && !isSameDay) { e.preventDefault(); setDragOverDay(day) }
                    }}
                    onDragLeave={() => setDragOverDay(null)}
                    onDrop={e => {
                      e.preventDefault()
                      setDragOverDay(null)
                      if (isDragTarget && !isSameDay && draggedId && onReschedule) {
                        onReschedule(draggedId, day)
                      }
                    }}
                  >

                    {}
                    <div className={`px-3 pt-2.5 pb-2 border-b flex-shrink-0
                      ${isToday ? 'border-[#0055A4]/40 bg-[#0055A4]/8' : 'border-surface-200'}
                      ${isDragOver && isDragTarget && !isSameDay ? 'bg-[#0055A4]/15' : ''}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className={`text-[9px] uppercase tracking-[0.12em] font-bold mb-0.5
                            ${isToday ? 'text-[#0055A4]' : isWeekend ? 'text-surface-300' : 'text-surface-400'}`}>
                            {parseDate(day).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}
                          </div>
                          <div className={`text-2xl font-black leading-none
                            ${isToday ? 'text-surface-900' : isWeekend ? 'text-surface-300' : 'text-surface-500'}`}>
                            {parseDate(day).getDate()}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 pt-0.5">
                          {dayMs.length > 0 && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none
                              ${isToday ? 'bg-[#0055A4]/25 text-[#0055A4]' : 'bg-surface-100 text-surface-400'}`}>
                              {dayMs.length}
                            </span>
                          )}
                          <button onClick={() => onNewMission(day)} title="Nouvelle mission"
                            className="w-5 h-5 flex items-center justify-center text-surface-300 hover:text-[#0055A4] hover:bg-surface-100/80 rounded-full text-base font-light transition-all leading-none">+</button>
                        </div>
                      </div>
                    </div>

                    {}
                    <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-1.5">
                      {isDragOver && isDragTarget && !isSameDay && (
                        <div className="flex items-center justify-center py-2 text-[#0055A4] text-[11px] font-semibold animate-pulse">
                          ↓ Déplacer ici
                        </div>
                      )}
                      {dayMs.length === 0 && !(isDragOver && isDragTarget && !isSameDay) ? (
                        <div className="flex items-center justify-center h-full text-surface-200 text-lg select-none">—</div>
                      ) : dayMs.length > 0 ? (
                        dayMs.map(m => (
                          <MissionCard key={m.id} mission={m}
                            onView={() => onViewMission(m)}
                            onEdit={() => onEditMission(m)}
                            onDelete={() => onDeleteMission(m.id)}
                            onDuplicate={() => onDuplicateMission(m.id)}
                            dragging={draggedId === m.id}
                            onDragStart={() => onDragStart(m.id)}
                            onDragEnd={onDragEnd}
                            selectable={batchMode}
                            selected={selectedIds.has(m.id)}
                            onToggleSelect={() => toggleSelect(m.id)}
                          />
                        ))
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {}
        {view === 'month' && (
          <div className="h-full overflow-y-auto px-4 py-2">
            <div className="grid grid-cols-7 gap-px bg-surface-100 rounded-lg overflow-hidden">
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => (
                <div key={d} className="bg-surface-50 text-center text-[11px] font-semibold text-surface-400 py-1">{d}</div>
              ))}
              {monthWeeks.flat().map(day => {
                const count = (missionsByDate[day] || []).length
                const inMonth = sameMonth(day, poolDate)
                const isToday = day === today()
                return (
                  <button key={day} onClick={() => { setView('day'); setPoolDate(day) }}
                    className={`bg-white p-1.5 text-left transition-colors hover:bg-surface-100 min-h-[40px]
                      ${!inMonth ? 'opacity-30' : ''}
                      ${isToday ? 'ring-1 ring-[#0055A4] ring-inset' : ''}`}
                  >
                    <div className={`text-xs font-bold ${isToday ? 'text-[#0055A4]' : 'text-surface-500'}`}>
                      {parseDate(day).getDate()}
                    </div>
                    {count > 0 && (
                      <div className="mt-0.5 inline-flex items-center justify-center bg-[#0055A4]/20 text-[#0055A4] rounded px-1 text-[10px] font-semibold">
                        {count}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

      </div>

      {}
      {batchMode && selectedIds.size > 0 && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-t border-surface-200/60">
          <span className="text-xs text-surface-900 font-semibold">{selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}</span>
          <div className="relative">
            <button onClick={() => setShowBatchDropdown(v => !v)}
              className="flex items-center gap-1 bg-[#0055A4] hover:bg-[#004080] text-surface-900 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              Assigner à <span className="text-[10px]">&#9662;</span>
            </button>
            {showBatchDropdown && drivers && (
              <div className="absolute bottom-full mb-1 left-0 w-56 bg-white border border-surface-200 rounded-xl shadow-2xl z-50 overflow-hidden max-h-48 overflow-y-auto">
                {drivers.filter(d => !d.archived).map(d => (
                  <button key={d.id} onClick={() => handleBatchAssign(d.id)}
                    className="w-full text-left px-3 py-2 text-xs text-surface-600 hover:bg-surface-100 hover:text-surface-900 transition-colors flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#0055A4]/20 text-[#0055A4] flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                      {(d.firstName || '?')[0]}
                    </span>
                    {d.firstName} {d.lastName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={cancelBatch} className="text-xs text-surface-400 hover:text-surface-600 transition-colors">Annuler</button>
        </div>
      )}
    </div>
  )
}
