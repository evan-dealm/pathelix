'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Mission, MissionType, MISSION_TYPE_HEX } from '@/lib/types'
import { formatDuration } from '@/lib/algorithm'
import { usePlanningStore } from '@/stores/planningStore'
import { SYNTHETIC_TYPES } from '../types'
import { useTrade } from '@/providers/TradeProvider'
import { Btn, TypeBadge } from '../ui'
import { useDebounce, today, displayShort, mTitle } from '../hooks'
import { ImportExportBar } from '../ImportExportBar'
import { MISSION_COLUMNS, parseMissionRows, missionExportData } from '@/lib/importExportColumns'
import { loadAllMissionsIntoStore } from '@/lib/loadAllMissions'
import { usePermissions } from '@/hooks/usePermissions'
import { PermissionGate } from '../PermissionGate'
import { apiRequest } from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

export function MissionsTab({ onEdit, onNew, onView, onDelete, onDuplicate, onImportCSV }: {
  onEdit: (_m: Mission) => void
  onNew: () => void
  onView: (_m: Mission) => void
  onDelete: (_id: string) => void
  onDuplicate: (_id: string) => void
  onImportCSV: (_missions: Array<Omit<Mission, 'id'>>) => Promise<void>
}) {
  const { missionIcon, missionLabel, enabledTypes, vocab } = useTrade()
  const { permissions } = usePermissions()

  const poolTypes = enabledTypes.filter(t => !SYNTHETIC_TYPES.includes(t))

  const missions = usePlanningStore(s => s.missions)
  // DataProvider only ever loads *today's* missions into the store (fast path for the
  // operational planning view). This tab is a full catalog (import/export/archive/kanban,
  // date-range filter below) — without this, dateFrom/dateTo silently filter an array that
  // can never contain anything but today, and opening the tab on a day with 0 missions shows
  // "Aucune mission" even when hundreds exist on other dates. Paginate the full history in
  // once, merging additively (addMissionsBulk never overwrites already-loaded missions, so
  // this can't stomp on live status updates to today's missions from the periodic refresh).
  useEffect(() => {
    const controller = { cancelled: false }
    loadAllMissionsIntoStore(controller)
    return () => { controller.cancelled = true }
  }, [])
  const drivers = usePlanningStore(s => s.drivers)
  const plans = usePlanningStore(s => s.plans)
  const archiveMissionLocal = usePlanningStore(s => s.archiveMission)
  const restoreMissionLocal = usePlanningStore(s => s.restoreMission)
  const updateMission = usePlanningStore(s => s.updateMission)
  const { success: toastSuccess, error: toastError } = useToast()

  /**
   * Persists a change made to the store: these actions used to update the local store only, so
   * archiving, restoring, re-dating or re-prioritising came back as before on the next reload.
   * Rolls back and explains when the server refuses.
   */
  const persistMissions = useCallback(async (
    ids: string[], patch: Omit<Partial<Mission>, 'priority'> & { priority?: 1 | 2 | 3 | null }, apply: (_id: string) => void, rollback: (_id: string) => void, done?: string,
  ) => {
    ids.forEach(apply)
    const results = await Promise.all(ids.map(id => apiRequest(`/api/missions/${id}`, { method: 'PUT', json: patch })))
    const failed = results.map((r, i) => ({ r, id: ids[i] })).filter(x => !x.r.ok)
    failed.forEach(x => rollback(x.id))
    if (failed.length > 0) {
      const first = failed[0].r
      toastError(`${failed.length} mission(s) non modifiée(s) : ${first.ok ? '' : first.error}`)
    } else if (done) {
      toastSuccess(done)
    }
  }, [toastError, toastSuccess])

  const archiveMission = useCallback((id: string) => {
    void persistMissions([id], { archived: true }, archiveMissionLocal, restoreMissionLocal)
  }, [persistMissions, archiveMissionLocal, restoreMissionLocal])
  const restoreMission = useCallback((id: string) => {
    void persistMissions([id], { archived: false }, restoreMissionLocal, archiveMissionLocal, 'Mission restaurée')
  }, [persistMissions, archiveMissionLocal, restoreMissionLocal])
  const assignToDriver = usePlanningStore(s => s.assignToDriver)
  const [search, setSearch]               = useState('')
  const [typeFilter, setTypeFilter]       = useState<MissionType | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<1 | 2 | 3 | 'all'>('all')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [sortKey, setSortKey]             = useState<'date' | 'type' | 'client' | 'priority'>('date')
  const [sortAsc, setSortAsc]             = useState(true)
  const debouncedSearch = useDebounce(search, 200)
  const [showArchives, setShowArchives]   = useState(false)
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [bulkDate, setBulkDate]           = useState(today())
  const [bulkPriority, setBulkPriority]   = useState<'' | '1' | '2' | '3'>('')
  const [bulkDriverId, setBulkDriverId]   = useState('')
  const [showFilters, setShowFilters]     = useState(false)
  const [viewMode, setViewMode]           = useState<'table' | 'kanban'>('table')

  const [missionPage, setMissionPage]     = useState(1)
  const MISSIONS_PER_PAGE = 100

  const assignmentMap = useMemo(() => {
    const map = new Map<string, { name: string; date: string }>()
    const driverMap = new Map<string, string>()
    for (const d of (Array.isArray(drivers) ? drivers : [])) {
      driverMap.set(d.id, `${d.firstName} ${d.lastName}`)
    }
    for (const [key, plan] of Object.entries(plans)) {
      const sep = key.indexOf('|')
      const driverId = key.slice(0, sep)
      const date = key.slice(sep + 1)
      const name = driverMap.get(driverId)
      if (!name) continue
      for (const m of plan) {
        if (!m.isSynthetic) map.set(m.id, { name, date })
      }
    }
    return map
  }, [plans, drivers])

  const archived = useMemo(() =>
    missions.filter(m => m.archived && !SYNTHETIC_TYPES.includes(m.type)),
    [missions]
  )

  const filtered = useMemo(() => {
    const arr = missions.filter(m => {
      if (SYNTHETIC_TYPES.includes(m.type)) return false
      if (m.archived) return false
      if (typeFilter !== 'all' && m.type !== typeFilter) return false
      if (priorityFilter !== 'all' && m.priority !== priorityFilter) return false
      if (dateFrom && m.date < dateFrom) return false
      if (dateTo && m.date > dateTo) return false
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        const assigned = assignmentMap.get(m.id)
        if (!`${m.clientName || ''} ${m.outletName || ''} ${m.address} ${m.wasteTypeLabel || ''} ${assigned?.name || ''}`.toLowerCase().includes(q)) return false
      }
      return true
    })
    return [...arr].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date')          cmp = a.date.localeCompare(b.date)
      else if (sortKey === 'type')     cmp = a.type.localeCompare(b.type)
      else if (sortKey === 'client')   cmp = mTitle(a).localeCompare(mTitle(b))
      else if (sortKey === 'priority') cmp = (a.priority ?? 99) - (b.priority ?? 99)
      return sortAsc ? cmp : -cmp
    })
  }, [missions, debouncedSearch, typeFilter, priorityFilter, dateFrom, dateTo, sortKey, sortAsc, assignmentMap])

  const totalPages = Math.ceil(filtered.length / MISSIONS_PER_PAGE)
  const paged = useMemo(() => {
    const start = (missionPage - 1) * MISSIONS_PER_PAGE
    return filtered.slice(start, start + MISSIONS_PER_PAGE)
  }, [filtered, missionPage])

  useEffect(() => { setMissionPage(1) }, [debouncedSearch, typeFilter, priorityFilter, dateFrom, dateTo])

  const p1Count = useMemo(() => missions.filter(m => m.priority === 1 && !SYNTHETIC_TYPES.includes(m.type) && !m.archived).length, [missions])

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortAsc(v => !v)
    else { setSortKey(k); setSortAsc(true) }
  }

  function SortTh({ k, label }: { k: typeof sortKey; label: string }) {
    return (
      <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">
        <button type="button" onClick={() => toggleSort(k)} className="flex items-center gap-0.5 hover:text-surface-600 transition-colors">
          {label}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(m => m.id)))
  }

  function bulkArchive() {
    const ids = [...selectedIds]
    if (ids.length > 1 && !confirm(`Archiver ${ids.length} missions ? Elles restent consultables et restaurables dans « Archives ».`)) return
    void persistMissions(ids, { archived: true }, archiveMissionLocal, restoreMissionLocal, `${ids.length} mission(s) archivée(s)`)
    setSelectedIds(new Set())
  }

  function bulkChangeDate() {
    if (!bulkDate) return
    const ids = [...selectedIds]
    const before = new Map(ids.map(id => [id, missions.find(m => m.id === id)?.date]))
    void persistMissions(ids, { date: bulkDate },
      id => updateMission(id, { date: bulkDate }),
      id => { const d = before.get(id); if (d) updateMission(id, { date: d }) },
      `${ids.length} mission(s) déplacée(s)`)
    setSelectedIds(new Set())
  }

  function bulkChangePriority() {
    if (!bulkPriority) return
    const p = parseInt(bulkPriority) as 1 | 2 | 3
    const ids = [...selectedIds]
    const before = new Map(ids.map(id => [id, missions.find(m => m.id === id)?.priority]))
    void persistMissions(ids, { priority: p },
      id => updateMission(id, { priority: p }),
      id => updateMission(id, { priority: before.get(id) }),
      `Priorité mise à jour (${ids.length})`)
    setSelectedIds(new Set())
    setBulkPriority('')
  }

  function bulkAssign() {
    if (!bulkDriverId || !bulkDate) return
    selectedIds.forEach(id => assignToDriver(id, bulkDriverId, bulkDate))
    setSelectedIds(new Set())
  }

  const cyclePriority = useCallback((m: Mission, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = m.priority === 1 ? 2 : m.priority === 2 ? 3 : m.priority === 3 ? null : 1
    const previous = m.priority
    // null (not undefined) clears the priority — an omitted key means "unchanged" to the API.
    void persistMissions([m.id], { priority: next },
      id => updateMission(id, { priority: next ?? undefined }),
      id => updateMission(id, { priority: previous }))
  }, [updateMission, persistMissions])

  const hasActiveFilters = typeFilter !== 'all' || priorityFilter !== 'all' || dateFrom || dateTo

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {}
      <div className="flex items-center gap-2 px-2 md:px-4 py-2 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">
          {filtered.length}<span className="text-surface-300">/{missions.filter(m => !SYNTHETIC_TYPES.includes(m.type) && !m.archived).length}</span>
        </span>
        {p1Count > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
            🔥 {p1Count}
          </span>
        )}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder={`Rechercher client, adresse, ${vocab.driver.toLowerCase()}…`}
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-40 md:w-60"
        />
        {}
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          title="Filtres avancés"
          className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all
            ${showFilters || hasActiveFilters
              ? 'bg-[#0055A4]/20 text-[#4da6ff] border-[#0055A4]/50'
              : 'bg-surface-100 hover:bg-surface-100 text-surface-600 border-surface-200'}`}
        >
          ≡ Filtres{hasActiveFilters ? ' •' : ''}
        </button>
        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
          <ImportExportBar
            columns={MISSION_COLUMNS}
            data={missionExportData(filtered)}
            filename="missions"
            parseRows={parseMissionRows}
            onImport={async (items) => { await onImportCSV(items as unknown as Array<Omit<Mission, 'id'>>) }}
            needsGeocode
          />
          <div className="flex bg-surface-100 rounded-lg p-0.5 gap-0.5 border border-surface-200">
            <button type="button" onClick={() => setViewMode('table')} title="Vue tableau"
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${viewMode === 'table' ? 'bg-white text-surface-900 shadow-soft' : 'text-surface-400 hover:text-surface-600'}`}>
              📋 Tableau
            </button>
            <button type="button" onClick={() => setViewMode('kanban')} title="Vue kanban"
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${viewMode === 'kanban' ? 'bg-white text-surface-900 shadow-soft' : 'text-surface-400 hover:text-surface-600'}`}>
              📊 Kanban
            </button>
          </div>
          <PermissionGate permissions={permissions} permission="manage_missions">
            {(allowed, title) => (
              <Btn onClick={onNew} variant="primary" size="sm" disabled={!allowed} title={title}>
                <span className="hidden sm:inline">+ Nouvelle mission</span>
                <span className="sm:hidden">+</span>
              </Btn>
            )}
          </PermissionGate>
        </div>
      </div>

      {}
      {showFilters && (
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-surface-200 flex-shrink-0 flex-wrap">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as MissionType | 'all')}
            title="Filtrer par type de mission"
            aria-label="Filtrer par type de mission"
            className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
            <option value="all">Tous types</option>
            {poolTypes.map(t => <option key={t} value={t}>{missionIcon(t)} {missionLabel(t)}</option>)}
          </select>
          <select value={String(priorityFilter)} onChange={e => setPriorityFilter(e.target.value === 'all' ? 'all' : Number(e.target.value) as 1 | 2 | 3)}
            title="Filtrer par priorité"
            aria-label="Filtrer par priorité"
            className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
            <option value="all">Toutes priorités</option>
            <option value="1">🔥 P1 Urgent</option>
            <option value="2">P2 Normal</option>
            <option value="3">P3 Flexible</option>
          </select>
          <div className="flex items-center gap-1.5">
            <span className="text-surface-400 text-xs">Du</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Date début"
              className="bg-surface-100 border border-surface-200 rounded px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-surface-400 text-xs">au</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Date fin"
              min={dateFrom || undefined}
              className="bg-surface-100 border border-surface-200 rounded px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
          </div>
          {hasActiveFilters && (
            <button type="button"
              onClick={() => { setTypeFilter('all'); setPriorityFilter('all'); setDateFrom(''); setDateTo('') }}
              className="text-xs text-surface-400 hover:text-red-400 transition-colors ml-1">
              ✕ Réinitialiser
            </button>
          )}
        </div>
      )}

      {}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#0055A4]/10 border-b border-[#0055A4]/30 flex-shrink-0 flex-wrap">
          <span className="text-[#0055A4] text-xs font-bold">{selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}</span>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-surface-400 hover:text-surface-600 text-xs">✕</button>
          <div className="w-px h-4 bg-surface-200 mx-1" />
          {}
          <div className="flex items-center gap-1.5">
            <span className="text-surface-400 text-xs">Date :</span>
            <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} title="Date pour action groupée"
              className="bg-surface-100 border border-surface-200 rounded px-2 py-0.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
            <Btn onClick={bulkChangeDate} variant="ghost" size="xs">Appliquer</Btn>
          </div>
          <div className="w-px h-4 bg-surface-200 mx-1" />
          {}
          <div className="flex items-center gap-1.5">
            <span className="text-surface-400 text-xs">Priorité :</span>
            <select value={bulkPriority} onChange={e => setBulkPriority(e.target.value as '' | '1' | '2' | '3')} title="Priorité groupée"
              className="bg-surface-100 border border-surface-200 rounded px-2 py-0.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
              <option value="">Choisir…</option>
              <option value="1">🔥 P1 Urgent</option>
              <option value="2">P2 Normal</option>
              <option value="3">P3 Flexible</option>
            </select>
            <Btn onClick={bulkChangePriority} variant="ghost" size="xs" disabled={!bulkPriority}>Appliquer</Btn>
          </div>
          <div className="w-px h-4 bg-surface-200 mx-1" />
          {}
          <div className="flex items-center gap-1.5">
            <span className="text-surface-400 text-xs">Assigner à :</span>
            <select value={bulkDriverId} onChange={e => setBulkDriverId(e.target.value)} title="Assigner à un chauffeur"
              className="bg-surface-100 border border-surface-200 rounded px-2 py-0.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
              <option value="">— {vocab.driver} —</option>
              {(Array.isArray(drivers) ? drivers : []).filter(d => !d.archived).map(d =>
                <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
              )}
            </select>
            <Btn onClick={bulkAssign} variant="success" size="xs" disabled={!bulkDriverId}>Assigner</Btn>
          </div>
          <div className="w-px h-4 bg-surface-200 mx-1" />
          <Btn onClick={bulkArchive} variant="warning" size="xs">📁 Archiver</Btn>

        </div>
      )}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 gap-2">
            <div className="text-3xl">📭</div>
            <div className="text-sm">Aucune mission</div>
          </div>
        ) : viewMode === 'kanban' ? (

          (() => {
            const assignedIds = new Set<string>()
            for (const plan of Object.values(plans)) {
              for (const pm of plan) {
                if (!pm.isSynthetic) assignedIds.add(pm.id)
              }
            }
            const poolMissions = filtered.filter(m => !assignedIds.has(m.id) && !m.archived)
            const assignedMissions = filtered.filter(m => assignedIds.has(m.id) && !m.archived)
            const doneMissions = missions.filter(m => m.archived && !SYNTHETIC_TYPES.includes(m.type))

            const columns = [
              { key: 'pool', label: 'Pool', color: 'border-blue-400', missions: poolMissions },
              { key: 'assigned', label: 'Assignées', color: 'border-amber-400', missions: assignedMissions },
              { key: 'done', label: 'Terminées', color: 'border-emerald-400', missions: doneMissions },
            ] as const

            return (
              <div className="h-full flex gap-3 p-3 overflow-x-auto">
                {columns.map(col => (
                  <div key={col.key} className={`flex-1 min-w-[260px] bg-surface-50 rounded-xl border-t-2 ${col.color} flex flex-col p-3`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-surface-600 uppercase tracking-wider">{col.label}</span>
                      <span className="text-[10px] font-bold text-surface-400 bg-surface-200 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{col.missions.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2">
                      {col.missions.map(m => {
                        const borderLeft = m.priority === 1
                          ? 'border-l-[3px] border-l-red-500'
                          : m.priority === 2
                          ? 'border-l-[3px] border-l-orange-400'
                          : ''
                        return (
                          <div key={m.id} onClick={() => onView(m)}
                            className={`bg-white border border-surface-200 rounded-lg p-3 shadow-sm mb-2 cursor-pointer hover:shadow-card transition-all group ${borderLeft}`}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <TypeBadge type={m.type} />
                              {m.priority === 1 && <span className="text-[9px] bg-red-50 text-red-600 border border-red-200 rounded px-1 font-bold">P1</span>}
                              {m.priority === 2 && <span className="text-[9px] bg-orange-50 text-orange-600 border border-orange-200 rounded px-1 font-bold">P2</span>}
                            </div>
                            <div className="text-sm font-medium text-surface-900 truncate">{m.clientName || m.outletName || '—'}</div>
                            <div className="text-[10px] text-surface-400 truncate mt-0.5" title={m.address}>{m.address.length > 40 ? m.address.slice(0, 40) + '…' : m.address}</div>
                            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-surface-400 flex-wrap">
                              <span>{displayShort(m.date)}</span>
                              {m.wasteTypeLabel && <span className="bg-surface-100 rounded px-1 py-0.5">{m.wasteTypeLabel}</span>}
                            </div>
                            {col.key === 'assigned' && assignmentMap.get(m.id) && (
                              <div className="text-[10px] text-green-500 font-semibold mt-1 truncate">{assignmentMap.get(m.id)!.name}</div>
                            )}
                            <div className="flex gap-1 mt-1.5 opacity-70 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              <button type="button" onClick={e => { e.stopPropagation(); onEdit(m) }} className="text-[10px] text-brand-500 hover:underline">Modifier</button>
                              <button type="button" onClick={e => { e.stopPropagation(); onDuplicate(m.id) }} className="text-[10px] text-surface-400 hover:underline">Dupliquer</button>
                            </div>
                          </div>
                        )
                      })}
                      {col.missions.length === 0 && (
                        <div className="text-center text-surface-300 text-xs py-6">Aucune mission</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()
        ) : (
          <>
          {}
          <div className="md:hidden space-y-2 px-2 py-2">
            {paged.map(m => {
              const isSelected = selectedIds.has(m.id)
              return (
                <div key={m.id} onClick={() => onView(m)}
                  className={`mobile-card cursor-pointer ${isSelected ? 'ring-1 ring-[#0055A4]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={isSelected} title="Sélectionner"
                      onChange={(e) => { e.stopPropagation(); toggleSelect(m.id) }}
                      onClick={e => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded accent-[#0055A4] cursor-pointer flex-shrink-0" />
                    {m.priority === 1 && <span className="text-red-400 text-sm">🔥</span>}
                    <TypeBadge type={m.type} />
                    <span className="text-surface-900 font-semibold text-xs truncate flex-1">{mTitle(m)}</span>
                    <span className="text-surface-400 text-[10px] capitalize flex-shrink-0">{displayShort(m.date)}</span>
                  </div>
                  <div className="text-surface-400 text-xs truncate">{m.address}</div>
                  <div className="flex items-center gap-3 text-[10px] text-surface-400">
                    <span>{formatDuration(m.estimatedDurationMin + m.maneuverTimeMin)}</span>
                    {m.wasteTypeLabel && <span>{m.wasteTypeLabel}</span>}
                    {m.binSize && <span>{m.binSize}</span>}
                  </div>
                  <div className="flex items-center gap-1 pt-1" onClick={e => e.stopPropagation()}>
                    <Btn onClick={() => onEdit(m)} variant="ghost" size="xs">✏</Btn>
                    <Btn onClick={() => onDuplicate(m.id)} variant="ghost" size="xs">⎘</Btn>
                    <Btn onClick={() => archiveMission(m.id)} variant="warning" size="xs">📁</Btn>
                    <Btn onClick={() => onDelete(m.id)} variant="danger" size="xs">✕</Btn>
                  </div>
                </div>
              )
            })}
          </div>
          {}
          <table className="w-full text-sm border-collapse hidden md:table">
            <thead className="sticky top-0 bg-surface-50 z-10">
              <tr>
                <th className="px-3 py-2.5 border-b border-surface-200 w-8">
                  <input type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="Sélectionner toutes les missions"
                    className="w-3.5 h-3.5 rounded accent-[#0055A4] cursor-pointer" />
                </th>
                <SortTh k="priority" label="P." />
                <SortTh k="type" label="Type" />
                <SortTh k="date" label="Date" />
                <SortTh k="client" label={`Client / ${vocab.exutoire}`} />
                <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal">Adresse</th>
                <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">GPS</th>
                <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">Durée</th>
                <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">Assigné à</th>
                <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal">{vocab.wasteType} / {vocab.binSize}</th>
                <th className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const hasCoords = m.latitude !== 0 || m.longitude !== 0
                const isSelected = selectedIds.has(m.id)
                const assigned = assignmentMap.get(m.id)
                return (
                  <tr key={m.id} onClick={() => onView(m)}
                    className={`border-b border-surface-100 hover:bg-surface-50 transition-colors cursor-pointer group ${isSelected ? 'bg-[#0055A4]/8' : ''}`}>
                    <td className="px-3 py-2.5" onClick={e => { e.stopPropagation(); toggleSelect(m.id) }}>
                      {/* The cell toggles too (larger target): without stopping the click here the
                          row was toggled twice and never ended up selected. */}
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(m.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Sélectionner mission ${mTitle(m)}`}
                        className="w-3.5 h-3.5 rounded accent-[#0055A4] cursor-pointer" />
                    </td>
                    {}
                    <td className="px-3 py-2.5 text-center" onClick={e => cyclePriority(m, e)}>
                      <button
                        type="button"
                        title="Cliquer pour changer la priorité"
                        className="w-7 h-5 flex items-center justify-center rounded hover:bg-surface-100/60 transition-colors"
                      >
                        {m.priority === 1 && <span className="text-red-400 text-sm leading-none">🔥</span>}
                        {m.priority === 2 && <span className="text-surface-500 text-[11px] font-bold">P2</span>}
                        {m.priority === 3 && <span className="text-surface-400 text-[11px]">P3</span>}
                        {!m.priority && <span className="text-surface-200 text-[11px]">—</span>}
                      </button>
                    </td>
                    <td className="px-4 py-2.5"><TypeBadge type={m.type} /></td>
                    <td className="px-4 py-2.5 text-surface-500 text-xs whitespace-nowrap capitalize">{displayShort(m.date)}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-surface-900 font-semibold text-xs truncate max-w-[160px]">{mTitle(m)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-surface-400 text-[10px] truncate max-w-[200px]" title={m.address}>{m.address || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-surface-400 text-[10px] font-mono whitespace-nowrap">
                      {hasCoords ? `${m.latitude.toFixed(3)}, ${m.longitude.toFixed(3)}` : <span className="text-yellow-500">⚠ manquant</span>}
                    </td>
                    <td className="px-4 py-2.5 text-surface-500 text-xs whitespace-nowrap">
                      {formatDuration(m.estimatedDurationMin + m.maneuverTimeMin)}
                    </td>
                    <td className="px-4 py-2.5">
                      {assigned ? (
                        <div>
                          <div className="text-green-400 text-[11px] font-semibold truncate max-w-[100px]">{assigned.name}</div>
                          <div className="text-surface-400 text-[10px] capitalize">{displayShort(assigned.date)}</div>
                        </div>
                      ) : (
                        <span className="text-surface-300 text-[11px]">Non assignée</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-surface-400 text-xs">
                      <div className="truncate max-w-[120px]">
                        {[m.wasteTypeLabel, m.binSize].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {m.binSizeM3 ? <div className="text-surface-300 text-[10px]">{m.binSizeM3} m³</div> : null}
                    </td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <Btn onClick={() => onEdit(m)} variant="ghost" size="xs" title="Modifier">✏</Btn>
                        <Btn onClick={() => onDuplicate(m.id)} variant="ghost" size="xs" title="Dupliquer">⎘</Btn>
                        <Btn onClick={() => archiveMission(m.id)} variant="warning" size="xs" title="Archiver">📁</Btn>
                        <Btn onClick={() => onDelete(m.id)} variant="danger" size="xs" title="Supprimer">✕</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-surface-200 bg-surface-50">
              <span className="text-xs text-surface-400">
                {(missionPage - 1) * MISSIONS_PER_PAGE + 1}-{Math.min(missionPage * MISSIONS_PER_PAGE, filtered.length)} sur {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setMissionPage(1)} disabled={missionPage <= 1}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'<<'}</button>
                <button type="button" onClick={() => setMissionPage(p => Math.max(1, p - 1))} disabled={missionPage <= 1}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'<'}</button>
                <span className="px-2 text-xs text-surface-600">{missionPage}/{totalPages}</span>
                <button type="button" onClick={() => setMissionPage(p => Math.min(totalPages, p + 1))} disabled={missionPage >= totalPages}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'>'}</button>
                <button type="button" onClick={() => setMissionPage(totalPages)} disabled={missionPage >= totalPages}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'>>'}</button>
              </div>
            </div>
          )}
          </>
        )}

        {archived.length > 0 && (
          <div className="border-t border-surface-200 px-4 py-2">
            <button type="button"
              onClick={() => setShowArchives(v => !v)}
              className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-600 transition-colors py-1">
              <span className={`transition-transform ${showArchives ? 'rotate-90' : ''}`}>▶</span>
              📁 Archives ({archived.length} mission{archived.length > 1 ? 's' : ''})
            </button>
            {showArchives && (
              <div className="mt-2 space-y-1">
                {archived.map(m => (
                  <div key={m.id} className="flex items-center gap-3 bg-surface-50 rounded-lg px-3 py-2 opacity-60">
                    <TypeBadge type={m.type} />
                    <span className="sr-only">{MISSION_TYPE_HEX[m.type]}</span>
                    <span className="text-xs text-surface-500 flex-1 truncate">{mTitle(m)}</span>
                    <span className="text-[10px] text-surface-400">{m.date}</span>
                    <Btn onClick={() => restoreMission(m.id)} variant="ghost" size="xs" title="Restaurer">↩ Restaurer</Btn>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
