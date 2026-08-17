'use client'

import { useState, useMemo, useEffect } from 'react'
import { Btn, SelectInput } from '../ui'
import { logErr, useDebounce } from '../hooks'

interface AuditEntry {
  id: string
  createdAt: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  changes?: Record<string, unknown> | null
}

const PAGE_SIZE = 25

const ACTION_TYPES = [
  { value: '', label: 'Toutes' },
  { value: 'create', label: 'Création' },
  { value: 'update', label: 'Modification' },
  { value: 'delete', label: 'Suppression' },
  { value: 'assign', label: 'Assignation' },
]

// Values must match the entityType strings actual auditAsync() call sites use (grep
// `auditAsync(req,` across src/app/api) — Prisma-model-cased ('Driver', not 'driver'). These
// never matched before, so filtering by any of these silently always returned 0 rows.
const ENTITY_TYPES = [
  { value: '', label: 'Tous les types' },
  { value: 'Mission', label: 'Mission' },
  { value: 'Driver', label: 'Chauffeur' },
  { value: 'Vehicle', label: 'Vehicule' },
  { value: 'User', label: 'Utilisateur' },
  { value: 'Integration', label: 'Integration' },
  { value: 'tenant', label: 'Tenant (superadmin)' },
]

function actionBadge(action: string) {
  const cfg: Record<string, { cls: string; label: string }> = {
    create: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Creation' },
    update: { cls: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Modification' },
    delete: { cls: 'bg-red-50 text-red-700 border-red-200', label: 'Suppression' },
    assign: { cls: 'bg-violet-50 text-violet-700 border-violet-200', label: 'Assignation' },
  }
  const c = cfg[action] || { cls: 'bg-surface-100 text-surface-500 border-surface-200', label: action }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${c.cls}`}>{c.label}</span>
}

export function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [entityFilter, setEntityFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  function load(pageNum: number, entity: string) {
    setLoading(true)
    // pageNum is 0-indexed (component state); the API's page param is 1-indexed.
    const params = new URLSearchParams({ page: String(pageNum + 1), limit: String(PAGE_SIZE) })
    if (entity) params.set('entityType', entity)
    fetch(`/api/audit?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d && Array.isArray(d.data)) {
          setEntries(d.data)
          setTotal(d.pagination?.total ?? d.data.length)
        } else if (Array.isArray(d)) {
          setEntries(d)
          setTotal(d.length)
        }
      })
      .catch(logErr('audit'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(page, entityFilter) }, [page, entityFilter])

  function handleFilterChange(v: string) {
    setEntityFilter(v)
    setPage(0)
  }

  function handleActionFilterChange(v: string) {
    setActionFilter(v)
    setPage(0)
  }

  const filteredEntries = useMemo(() => {
    let result = entries
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      result = result.filter(e => e.entityId.toLowerCase().includes(q) || e.action.toLowerCase().includes(q))
    }
    if (actionFilter) {
      result = result.filter(e => e.action === actionFilter)
    }
    if (dateStart) {
      result = result.filter(e => e.createdAt >= dateStart)
    }
    if (dateEnd) {
      result = result.filter(e => e.createdAt <= dateEnd + 'T23:59:59')
    }
    return result
  }, [entries, debouncedSearch, actionFilter, dateStart, dateEnd])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
          Journal d&apos;audit
        </span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher ID / action…"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-40 md:w-48" />
        <div className="w-36">
          <SelectInput value={entityFilter} onChange={handleFilterChange} options={ENTITY_TYPES} />
        </div>
        <div className="w-36">
          <SelectInput value={actionFilter} onChange={handleActionFilterChange} options={ACTION_TYPES} />
        </div>
        <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} title="Date debut"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4] w-36" />
        <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} title="Date fin"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4] w-36" />
        <div className="ml-auto flex items-center gap-2 text-xs text-surface-400">
          <span>{filteredEntries.length} / {total} entree{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-surface-400 text-sm">Chargement...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 gap-2">
            <div className="text-3xl">📋</div>
            <div className="text-sm">Aucune entree d&apos;audit</div>
          </div>
        ) : (
          <>
            {}
            <div className="md:hidden space-y-2 px-2 py-2">
              {filteredEntries.map(e => (
                <div key={e.id} className="bg-white border border-surface-200 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-surface-500 text-[10px]">{new Date(e.createdAt).toLocaleString('fr-FR')}</span>
                    {actionBadge(e.action)}
                  </div>
                  <div className="text-surface-900 text-sm">{e.userName}</div>
                  <div className="text-surface-400 text-xs">
                    {e.entityType} <span className="text-surface-300 font-mono">{e.entityId}</span>
                  </div>
                  {e.changes && <div className="text-surface-400 text-[10px] truncate">{JSON.stringify(e.changes)}</div>}
                </div>
              ))}
            </div>

            {}
            <table className="w-full text-sm border-collapse hidden md:table">
              <thead className="sticky top-0 bg-surface-50 z-10">
                <tr>
                  {['Date', 'Utilisateur', 'Action', 'Type entite', 'ID entite', 'Details'].map(h => (
                    <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map(e => (
                  <tr key={e.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors">
                    <td className="px-4 py-3 text-surface-500 text-xs whitespace-nowrap">{new Date(e.createdAt).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-surface-900 text-sm">{e.userName}</td>
                    <td className="px-4 py-3">{actionBadge(e.action)}</td>
                    <td className="px-4 py-3 text-surface-600 text-xs">{e.entityType}</td>
                    <td className="px-4 py-3 text-surface-400 text-[10px] font-mono">{e.entityId}</td>
                    <td className="px-4 py-3 text-surface-400 text-xs max-w-[250px] truncate">{e.changes ? JSON.stringify(e.changes) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-t border-surface-200 flex-shrink-0">
          <Btn onClick={() => setPage(p => Math.max(0, p - 1))} variant="ghost" size="xs" disabled={page === 0}>
            Precedent
          </Btn>
          <span className="text-surface-400 text-xs">
            Page {page + 1} / {totalPages}
          </span>
          <Btn onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} variant="ghost" size="xs" disabled={page >= totalPages - 1}>
            Suivant
          </Btn>
        </div>
      )}
    </div>
  )
}
