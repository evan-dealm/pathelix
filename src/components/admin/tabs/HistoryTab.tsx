'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { fetchAllPages } from '@/lib/apiClient'
import { usePlanningStore } from '@/stores/planningStore'
import { HistoryEntry } from '../types'
import { Btn, DateNav } from '../ui'
import { displayFull, useDebounce, logErr } from '../hooks'
import { formatDuration } from '@/lib/algorithm'

export function HistoryTab({ tourDate }: { tourDate: string }) {
  const drivers = usePlanningStore(s => s.drivers)
  const plans = usePlanningStore(s => s.plans)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMock, setIsMock] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [showLabelInput, setShowLabelInput] = useState(false)
  const [browseDate, setBrowseDate] = useState(tourDate)

  const hasPlansForDate = ( Array.isArray(drivers) ? drivers : [] ).some(
    d => (plans[`${d.id}|${tourDate}`] || []).length > 0
  )

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries(await fetchAllPages('/api/history'))
    } catch {
      setError('Impossible de charger l\'historique.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadEntries() }, [loadEntries])

  const [histSearch, setHistSearch] = useState('')
  const debouncedHistSearch = useDebounce(histSearch, 200)

  const entriesForDate = useMemo(() => {
    const q = debouncedHistSearch.toLowerCase()
    return entries.filter(e => {
      if (e.date !== browseDate) return false
      if (q && !`${e.label} ${e.date}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, browseDate, debouncedHistSearch])

  const datesWithEntries = useMemo(() => {
    return new Set(entries.map(e => e.date))
  }, [entries])

  async function handleSave() {
    if (!labelInput.trim()) return
    setSaving(true)
    setError(null)
    try {
      const snapshot = (Array.isArray(drivers) ? drivers : [])
        .filter(d => (plans[`${d.id}|${tourDate}`] || []).length > 0)
        .map(d => {
          const key = `${d.id}|${tourDate}`
          const missions = plans[key] || []
          return {
            driverId: d.id,
            driverName: `${d.firstName} ${d.lastName}`,
            missions,
            missionCount: missions.filter(m => !m.isSynthetic).length,
          }
        })
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelInput.trim(), date: tourDate, snapshot }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = await res.json()
      if (created?.id?.startsWith('mock-')) setIsMock(true)
      setLabelInput('')
      setShowLabelInput(false)
      await loadEntries()
    } catch {
      setError('Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    try {
      const res = await fetch(`/api/history/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch {
      setError('Erreur lors de la suppression.')
    }
  }

  async function handleExpand(entry: HistoryEntry) {
    if (expandedId === entry.id) { setExpandedId(null); return }
    if (entry.snapshot && entry.snapshot.length > 0) { setExpandedId(entry.id); return }
    try {
      const res = await fetch(`/api/history?id=${entry.id}`)
      if (res.ok) {
        const data = await res.json()
        const snap = Array.isArray(data.snapshot) ? data.snapshot : []
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, snapshot: snap } : e))
      }
    } catch (err) {
      logErr('HistoryTab handleExpand')(err)
    }
    setExpandedId(entry.id)
  }

  function computeStats(snapshot: NonNullable<HistoryEntry['snapshot']>) {
    let totalMissions = 0
    let totalDurationMin = 0
    const driverCount = snapshot.length
    for (const d of snapshot) {
      totalMissions += d.missionCount
      for (const m of d.missions || []) {
        if (!m.isSynthetic) {
          totalDurationMin += m.estimatedDurationMin + (m.maneuverTimeMin || 0)
        }
      }
    }
    return { totalMissions, totalDurationMin, driverCount }
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {}
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
          Historique
        </span>
        <input value={histSearch} onChange={e => setHistSearch(e.target.value)} placeholder="Rechercher..."
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-36" />
        <div className="flex-1" />
        <DateNav dateStr={browseDate} setDate={setBrowseDate} label="Date :" />
        {datesWithEntries.has(browseDate) && (
          <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="Tournees enregistrees" />
        )}
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-surface-900 font-bold text-sm uppercase tracking-wider">
              Historique des tournees
            </h2>
            <p className="text-surface-400 text-xs mt-0.5 capitalize">{displayFull(browseDate)}</p>
          </div>
          {hasPlansForDate && !showLabelInput && (
            <Btn onClick={() => setShowLabelInput(true)} variant="primary" size="sm">
              Sauvegarder la tournee actuelle
            </Btn>
          )}
        </div>

        {isMock && (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-xs">
            <span>Mode mock — historique non persiste.</span>
          </div>
        )}

        {showLabelInput && (
          <div className="bg-white border border-surface-200 rounded-xl p-4 space-y-3">
            <div className="text-surface-500 text-xs font-semibold uppercase tracking-wider">Nom de la sauvegarde</div>
            <div className="flex gap-3">
              <input
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                placeholder={`Tournee du ${tourDate}...`}
                className="flex-1 bg-surface-100 border border-surface-200 rounded-lg px-3 py-2 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-[#0055A4] transition-colors"
                autoFocus
              />
              <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving || !labelInput.trim()}>
                {saving ? '...' : 'Sauvegarder'}
              </Btn>
              <Btn onClick={() => { setShowLabelInput(false); setLabelInput('') }} variant="ghost" size="sm">
                Annuler
              </Btn>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-surface-400 text-sm">Chargement...</div>
        ) : entriesForDate.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-surface-400 gap-2">
            <div className="text-sm">Aucune tournee enregistree pour cette date</div>
            <div className="text-xs text-surface-300">
              {entries.length === 0
                ? 'Sauvegardez une tournee planifiee pour la retrouver ici.'
                : 'Utilisez les fleches pour naviguer vers une date avec des donnees.'}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {entriesForDate.map(entry => {
              const isExpanded = expandedId === entry.id
              const savedDate = new Date(entry.createdAt)
              const savedLabel = isNaN(savedDate.getTime()) ? entry.createdAt : savedDate.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              const driversInSnap = entry.snapshot ?? []
              const hasSnapshot = driversInSnap.length > 0
              const stats = hasSnapshot ? computeStats(driversInSnap) : null

              return (
                <div key={entry.id} className="bg-white border border-surface-200 rounded-xl overflow-hidden">
                  {}
                  <div className="flex items-center gap-4 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleExpand(entry)}
                      className="flex-1 flex items-center gap-4 text-left min-w-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-surface-900 font-semibold text-sm truncate">{entry.label || '—'}</div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-surface-400 text-xs">Sauvegarde : {savedLabel}</span>
                        </div>
                      </div>
                      <span className={`text-surface-400 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    </button>
                    <Btn onClick={() => handleDelete(entry.id)} variant="danger" size="xs">Supprimer</Btn>
                  </div>

                  {}
                  {isExpanded && (
                    <div className="border-t border-surface-200 px-4 py-4 space-y-4 bg-surface-50/40">
                      {!hasSnapshot ? (
                        <div className="text-surface-400 text-xs text-center py-2">Detail non disponible</div>
                      ) : (
                        <>
                          {}
                          {stats && (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="bg-white border border-surface-200 rounded-xl px-4 py-3">
                                <div className="text-surface-400 text-[10px] font-medium uppercase tracking-wider">Missions</div>
                                <div className="text-surface-900 text-lg font-bold mt-0.5">{stats.totalMissions}</div>
                              </div>
                              <div className="bg-white border border-surface-200 rounded-xl px-4 py-3">
                                <div className="text-surface-400 text-[10px] font-medium uppercase tracking-wider">Chauffeurs</div>
                                <div className="text-surface-900 text-lg font-bold mt-0.5">{stats.driverCount}</div>
                              </div>
                              <div className="bg-white border border-surface-200 rounded-xl px-4 py-3">
                                <div className="text-surface-400 text-[10px] font-medium uppercase tracking-wider">Duree totale</div>
                                <div className="text-surface-900 text-lg font-bold mt-0.5">{formatDuration(stats.totalDurationMin)}</div>
                              </div>
                            </div>
                          )}

                          {}
                          <div className="space-y-2">
                            <div className="text-surface-500 text-[10px] font-semibold uppercase tracking-wider">Detail par chauffeur</div>
                            {driversInSnap.map(d => {
                              const driverDuration = (d.missions || [])
                                .filter(m => !m.isSynthetic)
                                .reduce((sum, m) => sum + m.estimatedDurationMin + (m.maneuverTimeMin || 0), 0)
                              return (
                                <div key={d.driverId} className="flex items-center gap-3 bg-white border border-surface-200 rounded-xl px-4 py-3">
                                  <div className="w-8 h-8 rounded-full bg-[#0055A4]/10 text-[#0055A4] flex items-center justify-center font-bold text-xs flex-shrink-0">
                                    {d.driverName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-surface-900 text-sm font-semibold truncate">{d.driverName}</div>
                                  </div>
                                  <div className="flex items-center gap-4 flex-shrink-0">
                                    <div className="text-right">
                                      <div className="text-surface-400 text-[10px] font-medium uppercase tracking-wider">Missions</div>
                                      <div className="text-surface-900 text-sm font-semibold">{d.missionCount}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-surface-400 text-[10px] font-medium uppercase tracking-wider">Duree</div>
                                      <div className="text-surface-900 text-sm font-semibold">{formatDuration(driverDuration)}</div>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
