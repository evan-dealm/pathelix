'use client'

import { useState, useMemo, useEffect } from 'react'
import { Exutoire } from '@/lib/types'
import { BLANK_EXUTOIRE, DAYS_FR } from '../types'
import { Btn, SelectInput } from '../ui'
import { minToHHMM, logErr, useDebounce, sleep } from '../hooks'
import { useToast } from '@/components/ui/Toast'
import { ExutoireForm } from '../ExutoireForm'
import { ImportExportBar } from '../ImportExportBar'
import { EXUTOIRE_COLUMNS, parseExutoireRows } from '@/lib/importExportColumns'
import { cachedFetch, invalidateClientCache } from '@/lib/clientCache'

const WASTE_TYPES = [
  { value: '', label: 'Tous les dechets' },
  { value: 'OM', label: 'OM' },
  { value: 'CS', label: 'CS' },
  { value: 'Verre', label: 'Verre' },
  { value: 'Carton', label: 'Carton' },
  { value: 'Encombrants', label: 'Encombrants' },
  { value: 'DIB', label: 'DIB' },
  { value: 'Gravats', label: 'Gravats' },
  { value: 'Bois', label: 'Bois' },
  { value: 'Ferraille', label: 'Ferraille' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'open', label: 'Ouverts maintenant' },
  { value: 'closed', label: 'Fermés' },
]

function isOpenNow(ex: Exutoire): boolean {
  const now = new Date()
  const dayOfWeek = now.getDay()
  if (ex.closedDays.includes(dayOfWeek)) return false
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return nowMin >= ex.openingHoursOpen && nowMin <= ex.openingHoursClose
}

export function ExutoiresTab() {
  const { error: toastError } = useToast()
  const [exutoires, setExutoires] = useState<Exutoire[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [wasteFilter, setWasteFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [modal, setModal]       = useState<{ kind: 'new' } | { kind: 'edit'; ex: Exutoire } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  function load() {
    setLoading(true)
    cachedFetch<Exutoire[] | { data?: Exutoire[] }>('/api/exutoires', 60_000).then(d => { setExutoires(Array.isArray(d) ? d : (d as { data?: Exutoire[] })?.data ?? []) }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function handleSave(data: Omit<Exutoire, 'id'>, id?: string) {
    try {
      const res = id
        ? await fetch(`/api/exutoires/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        : await fetch('/api/exutoires', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toastError((err as { error?: string }).error || 'Erreur lors de la sauvegarde')
        return
      }
      setModal(null)
      invalidateClientCache('/api/exutoires')
      load()
    } catch {
      toastError('Erreur réseau')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cet exutoire ?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/exutoires/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastError(data.error || 'Erreur lors de la suppression')
      }
    } catch {
      toastError('Erreur réseau')
    }
    setDeleting(null)
    invalidateClientCache('/api/exutoires')
    load()
  }

  const filtered = useMemo(() => {
    let result = exutoires
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      result = result.filter(e => `${e.name} ${e.address}`.toLowerCase().includes(q))
    }
    if (wasteFilter) {
      result = result.filter(e => e.acceptedWasteTypes.some(w => w.toLowerCase().includes(wasteFilter.toLowerCase())))
    }
    if (statusFilter === 'open') {
      result = result.filter(e => isOpenNow(e))
    } else if (statusFilter === 'closed') {
      result = result.filter(e => !isOpenNow(e))
    }
    return result
  }, [exutoires, debouncedSearch, wasteFilter, statusFilter])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
          {exutoires.length} exutoire{exutoires.length !== 1 ? 's' : ''}
        </span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-40 md:w-52" />
        <div className="w-40">
          <SelectInput value={wasteFilter} onChange={v => setWasteFilter(v)} options={WASTE_TYPES} />
        </div>
        <div className="w-40">
          <SelectInput value={statusFilter} onChange={v => setStatusFilter(v)} options={STATUS_OPTIONS} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ImportExportBar
            columns={EXUTOIRE_COLUMNS}
            data={filtered}
            filename="exutoires"
            parseRows={parseExutoireRows}
            needsGeocode
            onImport={async (items) => {
              let failed = 0
              for (const [i, e] of items.entries()) {
                if (i > 0) await sleep(250)
                const res = await fetch('/api/exutoires', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) })
                if (!res.ok) failed++
              }
              invalidateClientCache('/api/exutoires')
              load()
              if (failed > 0) throw new Error(`${failed} sur ${items.length} exutoire(s) n'ont pas pu être importés.`)
            }}
          />
          <Btn onClick={() => setModal({ kind: 'new' })} variant="primary" size="sm"><span className="hidden sm:inline">+ Nouvel exutoire</span><span className="sm:hidden">+</span></Btn>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-surface-400 text-sm">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 gap-2">
            <div className="text-3xl">♻️</div>
            <div className="text-sm">Aucun exutoire trouvé</div>
          </div>
        ) : (
          <>
          {}
          <div className="md:hidden space-y-2 px-2 py-2">
            {filtered.map(e => (
              <div key={e.id} className="mobile-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-surface-900 font-semibold text-sm">{e.name}</div>
                    <div className="text-surface-500 text-xs truncate">{e.address}</div>
                  </div>
                  <span className="text-surface-600 text-xs font-mono whitespace-nowrap flex-shrink-0">
                    {minToHHMM(e.openingHoursOpen)}–{minToHHMM(e.openingHoursClose)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {e.acceptedWasteTypes.slice(0, 4).map(w => (
                    <span key={w} className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] rounded px-1.5 py-0.5 font-medium">{w}</span>
                  ))}
                  {e.acceptedWasteTypes.length > 4 && (
                    <span className="text-surface-400 text-[9px]">+{e.acceptedWasteTypes.length - 4}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-surface-400">
                  <span>{e.serviceTimeMin} min service</span>
                  {e.closedDays.length > 0 && <span className="text-red-400">Fermé: {e.closedDays.map(d => DAYS_FR[d]).join(', ')}</span>}
                </div>
                <div className="flex items-center gap-1 pt-1">
                  <Btn onClick={() => setModal({ kind: 'edit', ex: e })} variant="ghost" size="xs">✏</Btn>
                  <Btn onClick={() => handleDelete(e.id)} variant="danger" size="xs" disabled={deleting === e.id}>
                    {deleting === e.id ? '…' : '✕'}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
          {}
          <table className="w-full text-sm border-collapse hidden md:table">
            <thead className="sticky top-0 bg-surface-50 z-10">
              <tr>
                {['Site', 'Adresse', 'GPS', 'Horaires', 'Jours fermés', 'Déchets acceptés', 'Service', 'Actions'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="text-surface-900 font-semibold text-sm">{e.name}</div>
                    <div className="text-surface-300 text-[10px] font-mono">{e.id}</div>
                  </td>
                  <td className="px-4 py-3 text-surface-500 text-xs max-w-[180px] truncate">{e.address}</td>
                  <td className="px-4 py-3">
                    {(e.lat !== 0 || e.lng !== 0) ? (
                      <div>
                        <span className="text-surface-400 font-mono text-xs">{e.lat.toFixed(3)}, {e.lng.toFixed(3)}</span>
                        <a href={`https://www.google.com/maps?q=${e.lat},${e.lng}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#0055A4] hover:underline text-[10px]">↗</a>
                      </div>
                    ) : <span className="text-yellow-500 text-xs">⚠ Manquant</span>}
                  </td>
                  <td className="px-4 py-3 text-surface-600 text-xs font-mono whitespace-nowrap">
                    {minToHHMM(e.openingHoursOpen)} – {minToHHMM(e.openingHoursClose)}
                  </td>
                  <td className="px-4 py-3">
                    {e.closedDays.length === 0 ? (
                      <span className="text-surface-400 text-xs">Ouvert 7j/7</span>
                    ) : (
                      <span className="text-red-400 text-xs">{e.closedDays.map(d => DAYS_FR[d]).join(', ')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {e.acceptedWasteTypes.slice(0, 3).map(w => (
                        <span key={w} className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] rounded px-1.5 py-0.5 font-medium">{w}</span>
                      ))}
                      {e.acceptedWasteTypes.length > 3 && (
                        <span className="text-surface-400 text-[9px]">+{e.acceptedWasteTypes.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-surface-500 text-xs whitespace-nowrap">{e.serviceTimeMin} min</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Btn onClick={() => setModal({ kind: 'edit', ex: e })} variant="ghost" size="xs">✏ Modifier</Btn>
                      <Btn onClick={() => handleDelete(e.id)} variant="danger" size="xs" disabled={deleting === e.id}>
                        {deleting === e.id ? '…' : '✕ Supprimer'}
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
      {modal?.kind === 'new' && (
        <ExutoireForm title="Nouvel exutoire" initial={BLANK_EXUTOIRE}
          onSave={(data) => handleSave(data).catch(logErr('api'))}
          onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'edit' && (
        <ExutoireForm title="Modifier l'exutoire" initial={modal.ex}
          onSave={(data) => handleSave(data, modal.ex.id).catch(logErr('api'))}
          onClose={() => setModal(null)} />
      )}
    </div>
  )
}
