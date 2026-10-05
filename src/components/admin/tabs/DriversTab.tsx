'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Driver } from '@/lib/types'
import { usePlanningStore } from '@/stores/planningStore'
import { Btn, Modal, Field } from '../ui'
import { useDebounce, today, getWeekDays } from '../hooks'
import { ImportExportBar } from '../ImportExportBar'
import { DRIVER_COLUMNS, parseDriverRows } from '@/lib/importExportColumns'
import { cachedFetch } from '@/lib/clientCache'
import { loadPlansForDate } from '@/lib/loadPlansForDate'

const REASON_LABELS: Record<string, string> = {
  conge: 'Congé',
  maladie: 'Maladie',
  formation: 'Formation',
  autre: 'Autre',
}

export function DriversTab({ onEdit, onNew, onDelete, onImportDriversCSV }: {
  onEdit: (_d: Driver) => void
  onNew: () => void
  onDelete: (_id: string) => void
  onImportDriversCSV: (_drivers: Array<Omit<Driver, 'id'>>) => Promise<void>
}) {
  const drivers = usePlanningStore(s => s.drivers)
  const { error: toastError } = useToast()
  const setSpeed = usePlanningStore(s => s.setSpeed)
  const speeds = usePlanningStore(s => s.speeds)
  const plans = usePlanningStore(s => s.plans)
  const toggleUnavailable = usePlanningStore(s => s.toggleUnavailable)
  const isUnavailable = usePlanningStore(s => s.isUnavailable)
  const archiveDriver = usePlanningStore(s => s.archiveDriver)
  const restoreDriver = usePlanningStore(s => s.restoreDriver)
  const [availDate, setAvailDate] = useState(today())

  const [dbUnavailIds, setDbUnavailIds] = useState<Map<string, string>>(new Map())
  const [unavailModal, setUnavailModal] = useState<{ driverId: string; driverName: string } | null>(null)
  const [unavailForm, setUnavailForm] = useState({ reason: 'conge', endDate: '', notes: '' })
  const [unavailLoading, setUnavailLoading] = useState(false)

  const fetchUnavailabilities = useCallback(async (date: string) => {
    try {
      const data = await cachedFetch<{ data?: Array<{ id: string; driverId: string; startDate: string; endDate: string }> }>(`/api/driver-unavailability?limit=500`, 30_000)
      const map = new Map<string, string>()
      for (const rec of (data.data ?? [])) {
        if (rec.startDate <= date && rec.endDate >= date) {
          map.set(rec.driverId, rec.id)
        }
      }
      setDbUnavailIds(map)

      map.forEach((_, driverId) => {
        if (!isUnavailable(driverId, date)) toggleUnavailable(driverId, date)
      })
    } catch {  }
  }, [isUnavailable, toggleUnavailable])

  useEffect(() => { void fetchUnavailabilities(availDate) }, [availDate, fetchUnavailabilities])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showArchives, setShowArchives] = useState(false)

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(d => d.id)))
  }
  function bulkArchive() {
    selectedIds.forEach(id => archiveDriver(id))
    setSelectedIds(new Set())
  }
  function bulkDelete() {
    if (!confirm(`Supprimer définitivement ${selectedIds.size} chauffeur(s) ? Cette action est irréversible.`)) return
    selectedIds.forEach(id => onDelete(id))
    setSelectedIds(new Set())
  }
  async function bulkSetUnavailable() {

    const ids = [...selectedIds].filter(id => !isUnavailable(id, availDate) && !dbUnavailIds.has(id))
    for (const id of ids) {
      const driver = drivers.find(d => d.id === id)
      if (!driver) continue
      const res = await fetch('/api/driver-unavailability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: id, startDate: availDate, endDate: availDate, reason: 'autre' }),
      })
      if (res.ok) {
        const rec = await res.json()
        setDbUnavailIds(prev => new Map(prev).set(id, rec.id))
        if (!isUnavailable(id, availDate)) toggleUnavailable(id, availDate)
      }
    }
    setSelectedIds(new Set())
  }
  async function bulkSetAvailable() {
    const ids = [...selectedIds].filter(id => isUnavailable(id, availDate) || dbUnavailIds.has(id))
    for (const id of ids) {
      const recId = dbUnavailIds.get(id)
      if (recId) {
        const res = await apiRequest(`/api/driver-unavailability/${recId}`, { method: 'DELETE' })
        // Local state must follow the server: on failure the driver stays unavailable.
        if (!res.ok) { toastError(res.error); continue }
        setDbUnavailIds(prev => { const m = new Map(prev); m.delete(id); return m })
      }
      if (isUnavailable(id, availDate)) toggleUnavailable(id, availDate)
    }
    setSelectedIds(new Set())
  }

  const [compliance, setCompliance] = useState<{
    licenseAlerts: Array<{ driverId: string; name: string; expiry: string; daysLeft: number; level: string }>
    hoursAlerts:   Array<{ driverId: string; name: string; totalHours: number; maxHours: number; pct: number; level: string }>
  }>({ licenseAlerts: [], hoursAlerts: [] })

  useEffect(() => {
    cachedFetch<typeof compliance>('/api/drivers/compliance', 60_000)
      .then(d => { setCompliance(d) })
      .catch(() => {})
  }, [])

  const weekDays = useMemo(() => getWeekDays(today()), [])

  // storePlans only ever holds *today's* plans from DataProvider's initial load. The weekly
  // workload bar/percentage below (checked against weeklyHoursMax / CE 561/2006 compliance)
  // sums plans across every day of the current week — without this, any day but today
  // silently contributed 0 minutes, understating a driver's real weekly workload.
  useEffect(() => {
    for (const day of weekDays) loadPlansForDate(day)
  }, [weekDays])

  const weeklyWorkMins = useMemo(() => {
    const result: Record<string, number> = {}
    for (const driver of drivers) {
      let totalMin = 0
      for (const day of weekDays) {
        const key = `${driver.id}|${day}`
        const dayPlan = plans[key] || []
        totalMin += dayPlan.reduce((s, m) => s + m.estimatedDurationMin + m.maneuverTimeMin, 0)
      }
      result[driver.id] = totalMin
    }
    return result
  }, [drivers, plans, weekDays])

  const [sectorFilter, setSectorFilter] = useState('all')
  const [depotFilter, setDepotFilter] = useState('all')
  const driverSectors = useMemo(() => [...new Set(drivers.filter(d => !d.archived).map(d => d.sector).filter(Boolean))].sort(), [drivers])
  const driverDepots = useMemo(() => [...new Set(drivers.filter(d => !d.archived).map(d => d.depotName).filter(Boolean))].sort(), [drivers])

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return drivers.filter(d => {
      if (d.archived) return false
      if (q && !`${d.firstName} ${d.lastName} ${d.sector} ${d.depotName}`.toLowerCase().includes(q)) return false
      if (sectorFilter !== 'all' && d.sector !== sectorFilter) return false
      if (depotFilter !== 'all' && d.depotName !== depotFilter) return false
      return true
    })
  }, [drivers, debouncedSearch, sectorFilter, depotFilter])

  const archived = useMemo(() => drivers.filter(d => d.archived), [drivers])

  const DRIVERS_PER_PAGE = 100
  const [driverPage, setDriverPage] = useState(1)
  const driverTotalPages = Math.ceil(filtered.length / DRIVERS_PER_PAGE)
  const pagedDrivers = useMemo(() => {
    const start = (driverPage - 1) * DRIVERS_PER_PAGE
    return filtered.slice(start, start + DRIVERS_PER_PAGE)
  }, [filtered, driverPage])
  useEffect(() => { setDriverPage(1) }, [debouncedSearch])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-2 md:px-4 py-2 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">
          {filtered.length}<span className="text-surface-300">/{drivers.filter(d => !d.archived).length}</span>
        </span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-32" />
        <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} title="Filtrer par secteur"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous secteurs</option>
          {driverSectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={depotFilter} onChange={e => setDepotFilter(e.target.value)} title="Filtrer par dépôt"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous dépôts</option>
          {driverDepots.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="hidden md:flex items-center gap-2">
          <span className="text-surface-400 text-xs">Dispo le :</span>
          <input type="date" value={availDate} onChange={e => setAvailDate(e.target.value)}
            title="Date de disponibilité"
            aria-label="Date de vérification de disponibilité"
            className="bg-surface-100 border border-surface-200 rounded px-2 py-0.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ImportExportBar
            columns={DRIVER_COLUMNS}
            data={filtered}
            filename="chauffeurs"
            parseRows={parseDriverRows}
            onImport={async (items) => { await onImportDriversCSV(items as unknown as Array<Omit<Driver, 'id'>>) }}
            needsGeocode
          />
          <Btn onClick={onNew} variant="primary" size="sm"><span className="hidden sm:inline">+ Nouveau chauffeur</span><span className="sm:hidden">+</span></Btn>
        </div>
      </div>

      {}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#0055A4]/10 border-b border-[#0055A4]/30 flex-shrink-0 flex-wrap">
          <span className="text-[#0055A4] text-xs font-bold">{selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-surface-400 hover:text-surface-600 text-xs">✕</button>
          <div className="w-px h-4 bg-surface-200 mx-1" />
          <span className="text-surface-400 text-xs">Le {availDate} :</span>
          <Btn onClick={bulkSetUnavailable} variant="warning" size="xs">🔴 Marquer indisponibles</Btn>
          <Btn onClick={bulkSetAvailable} variant="success" size="xs">🟢 Marquer disponibles</Btn>
          <div className="w-px h-4 bg-surface-200 mx-1" />
          <Btn onClick={bulkArchive} variant="warning" size="xs">📁 Archiver</Btn>
          <Btn onClick={bulkDelete} variant="danger" size="xs">✕ Supprimer</Btn>
        </div>
      )}
      {}
      {(compliance.licenseAlerts.length > 0 || compliance.hoursAlerts.length > 0) && (
        <div className="px-4 py-2 border-b border-surface-200 flex-shrink-0 space-y-1">
          {compliance.licenseAlerts.map(a => (
            <div key={a.driverId} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg font-medium ${
              a.level === 'expired'  ? 'bg-red-50 border border-red-200 text-red-700' :
              a.level === 'urgent'   ? 'bg-red-50 border border-red-200 text-red-600' :
              a.level === 'warning'  ? 'bg-amber-50 border border-amber-200 text-amber-700' :
                                       'bg-blue-50 border border-blue-200 text-blue-700'
            }`}>
              <span>{a.level === 'expired' ? '🚫' : a.level === 'urgent' ? '🔴' : '⚠️'}</span>
              <span className="font-bold">{a.name}</span>
              <span>—</span>
              <span>
                {a.level === 'expired'
                  ? `Permis expiré le ${a.expiry}`
                  : `Permis expire le ${a.expiry} (J-${a.daysLeft})`}
              </span>
            </div>
          ))}
          {compliance.hoursAlerts.map(a => (
            <div key={a.driverId} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg font-medium ${
              a.level === 'exceeded' ? 'bg-red-50 border border-red-200 text-red-700' :
                                       'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              <span>{a.level === 'exceeded' ? '🚫' : '⚠️'}</span>
              <span className="font-bold">{a.name}</span>
              <span>—</span>
              <span>
                {a.totalHours}h / {a.maxHours}h cette semaine ({a.pct}%
                {a.level === 'exceeded' ? ' — DÉPASSÉ' : ' — approche limite'})
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 gap-2">
            <div className="text-3xl">👤</div>
            <div className="text-sm">Aucun chauffeur trouvé</div>
          </div>
        ) : (
          <>
          {}
          <div className="md:hidden space-y-2 px-2 py-2">
            {pagedDrivers.map(d => {
              const spd = speeds[d.id] || 50
              const maxH     = d.weeklyHoursMax ?? 48
              const weekMin  = weeklyWorkMins[d.id] || 0
              const weekH    = (weekMin / 60).toFixed(1)
              const pct      = weekMin / (maxH * 60)
              const valCls   = pct >= 0.95 ? 'text-red-400' : pct >= 0.80 ? 'text-orange-400' : 'text-gray-200'
              const barCls   = pct >= 0.95 ? 'bg-red-500'   : pct >= 0.80 ? 'bg-orange-400'   : 'bg-green-500'
              const widthPct = Math.min(100, pct * 100)
              return (
                <div key={d.id} className="mobile-card">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#0055A4]/20 text-[#0055A4] flex items-center justify-center font-bold text-xs flex-shrink-0">
                      {(d.firstName || '?')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-surface-900 font-semibold text-sm">{d.firstName} {d.lastName}</div>
                      <div className="text-surface-400 text-xs">{[d.sector, d.depotName].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    <span className={`text-xs font-bold tabular-nums ${valCls}`}>{weekH}h</span>
                  </div>
                  <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barCls}`} style={{ width: `${widthPct}%` }} />
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="text-surface-400 font-mono">{spd} km/h</span>
                    <span className="text-surface-300">·</span>
                    <span className="text-surface-400">{d.vehicleCapacity ? `${d.vehicleCapacity} benne${d.vehicleCapacity > 1 ? 's' : ''}` : '—'}{d.maxBinSizeM3 ? ` · ${d.maxBinSizeM3}m³` : ''}</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a href={`/driver/${d.id}`} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-1 rounded text-[11px] font-medium text-blue-400 hover:bg-blue-50">🚛 Vue</a>
                    <Btn onClick={() => onEdit(d)} variant="ghost" size="xs">✏</Btn>
                    <Btn onClick={() => onDelete(d.id)} variant="danger" size="xs">✕</Btn>
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
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="Sélectionner tous les chauffeurs"
                    className="w-3.5 h-3.5 rounded accent-[#0055A4] cursor-pointer"
                  />
                </th>
                {['Chauffeur', 'Téléphone', 'Secteur', 'Dépôt', 'Capacité', 'Vitesse', 'Heures semaine', 'Disponibilité', 'Actions'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedDrivers.map(d => {
                const spd = speeds[d.id] || 50
                const isSelected = selectedIds.has(d.id)
                return (
                  <tr key={d.id} className={`border-b border-surface-100 hover:bg-surface-50 transition-colors group ${isSelected ? 'bg-[#0055A4]/8' : ''}`}>
                    <td className="px-3 py-3" onClick={e => { e.stopPropagation(); toggleSelect(d.id) }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(d.id)}
                        aria-label={`Sélectionner ${d.firstName} ${d.lastName}`}
                        className="w-3.5 h-3.5 rounded accent-[#0055A4] cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#0055A4]/20 text-[#0055A4] flex items-center justify-center font-bold text-xs flex-shrink-0">
                          {(d.firstName || '?')[0]}
                        </div>
                        <div>
                          <div className="text-surface-900 font-semibold">{d.firstName} {d.lastName}</div>
                          <div className="text-surface-400 text-[10px]">{d.depotName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-surface-500 text-xs">{d.phone || '—'}</td>
                    <td className="px-4 py-3 text-surface-600 text-xs">{d.sector}</td>
                    <td className="px-4 py-3">
                      <div className="text-surface-600 text-xs">{d.depotName}</div>
                      <div className="text-surface-300 text-[10px] font-mono">{d.depotLat.toFixed(2)}, {d.depotLng.toFixed(2)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        {d.vehicleCapacity ? (
                          <span className="bg-surface-100 border border-surface-200 rounded-md px-1.5 py-0.5 text-surface-600 font-mono">
                            {d.vehicleCapacity} benne{d.vehicleCapacity > 1 ? 's' : ''}
                          </span>
                        ) : <span className="text-surface-300">—</span>}
                        {d.maxBinSizeM3 ? (
                          <span className="text-surface-400">{d.maxBinSizeM3}m³</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <input type="number" value={spd} min="20" max="130" title="Vitesse km/h"
                          onChange={e => setSpeed(d.id, parseInt(e.target.value) || 50)}
                          className="w-14 bg-surface-100 border border-surface-200 rounded px-1.5 py-0.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4] text-center" />
                        <span className="text-surface-300 text-[10px]">km/h</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const maxH     = d.weeklyHoursMax ?? 48
                        const weekMin  = weeklyWorkMins[d.id] || 0
                        const weekH    = (weekMin / 60).toFixed(1)
                        const pct      = weekMin / (maxH * 60)
                        const valCls   = pct >= 0.95 ? 'text-red-400'    : pct >= 0.80 ? 'text-orange-400' : 'text-gray-200'
                        const barCls   = pct >= 0.95 ? 'bg-red-500'      : pct >= 0.80 ? 'bg-orange-400'   : 'bg-green-500'
                        const widthPct = Math.min(100, pct * 100)
                        return (
                          <div className="min-w-[100px]">
                            <div className="flex items-baseline gap-1 mb-1">
                              <span className={`text-sm font-bold tabular-nums ${valCls}`}>{weekH}h</span>
                              <span className="text-surface-400 text-[10px]">/ {maxH}h</span>
                              {pct >= 0.95 && <span className="text-red-400 text-[10px] font-bold ml-1">⛔ Limite</span>}
                              {pct >= 0.80 && pct < 0.95 && <span className="text-orange-400 text-[10px] ml-1">⚠ Proche</span>}
                            </div>
                            <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barCls}`} style={{ width: `${widthPct}%` }} />
                            </div>
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const unavail = isUnavailable(d.id, availDate) || dbUnavailIds.has(d.id)
                        return (
                          <button
                            type="button"
                            onClick={async () => {
                              if (unavail) {
                                const recId = dbUnavailIds.get(d.id)
                                if (recId) {
                                  await fetch(`/api/driver-unavailability/${recId}`, { method: 'DELETE' })
                                  setDbUnavailIds(prev => { const m = new Map(prev); m.delete(d.id); return m })
                                }
                                if (isUnavailable(d.id, availDate)) toggleUnavailable(d.id, availDate)
                              } else {
                                setUnavailForm({ reason: 'conge', endDate: availDate, notes: '' })
                                setUnavailModal({ driverId: d.id, driverName: `${d.firstName} ${d.lastName}` })
                              }
                            }}
                            title={`Marquer ${d.firstName} comme ${unavail ? 'disponible' : 'indisponible'} le ${availDate}`}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                              unavail
                                ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            {unavail ? '🔴 Indisponible' : '🟢 Disponible'}
                          </button>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a
                          href={`/driver/${d.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-50 transition-colors"
                          title="Ouvrir la vue mobile du chauffeur"
                        >
                          🚛 Vue
                        </a>
                        <Btn onClick={() => onEdit(d)} variant="ghost" size="xs">✏ Modifier</Btn>
                        <Btn onClick={() => archiveDriver(d.id)} variant="warning" size="xs" title="Archiver">📁</Btn>
                        <Btn onClick={() => onDelete(d.id)} variant="danger" size="xs">✕ Supprimer</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {}
          {driverTotalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-surface-200 bg-surface-50">
              <span className="text-xs text-surface-400">
                {(driverPage - 1) * DRIVERS_PER_PAGE + 1}-{Math.min(driverPage * DRIVERS_PER_PAGE, filtered.length)} sur {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setDriverPage(1)} disabled={driverPage <= 1}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'<<'}</button>
                <button type="button" onClick={() => setDriverPage(p => Math.max(1, p - 1))} disabled={driverPage <= 1}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'<'}</button>
                <span className="px-2 text-xs text-surface-600">{driverPage}/{driverTotalPages}</span>
                <button type="button" onClick={() => setDriverPage(p => Math.min(driverTotalPages, p + 1))} disabled={driverPage >= driverTotalPages}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'>'}</button>
                <button type="button" onClick={() => setDriverPage(driverTotalPages)} disabled={driverPage >= driverTotalPages}
                  className="px-2 py-1 text-xs rounded border border-surface-200 hover:bg-surface-100 disabled:opacity-30">{'>>'}</button>
              </div>
            </div>
          )}
          </>
        )}

        {}
        {archived.length > 0 && (
          <div className="border-t border-surface-200 px-4 py-2">
            <button type="button"
              onClick={() => setShowArchives(v => !v)}
              className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-600 transition-colors py-1">
              <span className={`transition-transform ${showArchives ? 'rotate-90' : ''}`}>▶</span>
              📁 Archives ({archived.length} chauffeur{archived.length > 1 ? 's' : ''})
            </button>
            {showArchives && (
              <div className="mt-2 space-y-1 pb-2">
                {archived.map(d => (
                  <div key={d.id} className="flex items-center gap-3 bg-surface-50 rounded-lg px-3 py-2 opacity-60">
                    <div className="w-7 h-7 rounded-full bg-surface-200/40 text-surface-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                      {(d.firstName || '?')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-surface-500 text-xs font-semibold">{d.firstName} {d.lastName}</div>
                      <div className="text-surface-400 text-[10px]">{[d.sector, d.depotName].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    <Btn onClick={() => restoreDriver(d.id)} variant="ghost" size="xs" title="Restaurer">↩ Restaurer</Btn>
                    <Btn onClick={() => onDelete(d.id)} variant="danger" size="xs" title="Supprimer définitivement">✕</Btn>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {}
      {unavailModal && (
        <Modal title={`Indisponibilité — ${unavailModal.driverName}`} onClose={() => setUnavailModal(null)}>
          <Field label="Motif">
            <select
              value={unavailForm.reason}
              onChange={e => setUnavailForm(p => ({ ...p, reason: e.target.value }))}
              className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {Object.entries(REASON_LABELS).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date début">
              <input type="date" value={availDate} readOnly
                className="w-full rounded-lg border border-surface-200 bg-surface-100 px-3 py-2 text-sm text-surface-500" />
            </Field>
            <Field label="Date fin">
              <input type="date" value={unavailForm.endDate} min={availDate}
                onChange={e => setUnavailForm(p => ({ ...p, endDate: e.target.value }))}
                className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </Field>
          </div>
          <Field label="Notes (optionnel)">
            <input type="text" value={unavailForm.notes}
              placeholder="Détails complémentaires…"
              onChange={e => setUnavailForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </Field>
          <div className="flex gap-3 pt-1">
            <Btn
              disabled={unavailLoading}
              onClick={async () => {
                setUnavailLoading(true)
                try {
                  const res = await fetch('/api/driver-unavailability', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      driverId:  unavailModal.driverId,
                      startDate: availDate,
                      endDate:   unavailForm.endDate || availDate,
                      reason:    unavailForm.reason,
                      notes:     unavailForm.notes || undefined,
                    }),
                  })
                  if (res.ok) {
                    const rec = await res.json()
                    setDbUnavailIds(prev => new Map(prev).set(unavailModal.driverId, rec.id))
                    if (!isUnavailable(unavailModal.driverId, availDate)) {
                      toggleUnavailable(unavailModal.driverId, availDate)
                    }
                    setUnavailModal(null)
                  }
                } finally {
                  setUnavailLoading(false)
                }
              }}
              variant="primary"
            >
              {unavailLoading ? 'Enregistrement…' : 'Confirmer'}
            </Btn>
            <Btn onClick={() => setUnavailModal(null)} variant="ghost">Annuler</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
