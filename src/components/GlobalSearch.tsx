'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePlanningStore } from '@/stores/planningStore'
import type { Mission, Driver } from '@/lib/types'

interface SearchResult {
  type: 'mission' | 'driver' | 'vehicle'
  id: string
  label: string
  sub: string
  tab: string
}

interface Props {
  onNavigate: (_tab: string) => void
}

export function GlobalSearch({ onNavigate }: Props) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const missions = usePlanningStore(s => s.missions)
  const drivers  = usePlanningStore(s => s.drivers)

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
        setQuery('')
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setSelected(0)
    }
  }, [open])

  const results = useCallback((): SearchResult[] => {
    const q = query.toLowerCase().trim()
    if (!q) return []
    const out: SearchResult[] = []

    const ms = Array.isArray(missions) ? missions : []
    for (const m of ms as Mission[]) {
      if (m.archived) continue
      const text = `${m.address} ${m.clientName ?? ''} ${m.type}`.toLowerCase()
      if (text.includes(q)) {
        out.push({
          type: 'mission', id: m.id,
          label: m.address,
          sub: [m.type, m.clientName, m.date].filter(Boolean).join(' · '),
          tab: 'missions',
        })
        if (out.length >= 8) break
      }
    }

    const ds = Array.isArray(drivers) ? drivers : []
    for (const d of ds as Driver[]) {
      if (d.archived) continue
      const text = `${d.firstName} ${d.lastName} ${d.sector} ${d.depotName ?? ''}`.toLowerCase()
      if (text.includes(q)) {
        out.push({
          type: 'driver', id: d.id,
          label: `${d.firstName} ${d.lastName}`,
          sub: [d.sector, d.depotName].filter(Boolean).join(' · ') || '—',
          tab: 'drivers',
        })
        if (out.length >= 12) break
      }
    }

    return out.slice(0, 10)
  }, [query, missions, drivers])

  const items = results()

  function handleSelect(r: SearchResult) {
    onNavigate(r.tab)
    setOpen(false)
    setQuery('')
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && items[selected]) handleSelect(items[selected])
  }

  const TYPE_ICON: Record<string, string> = { mission: '📋', driver: '👤', vehicle: '🚛' }
  const TYPE_LABEL: Record<string, string> = { mission: 'Mission', driver: 'Chauffeur', vehicle: 'Véhicule' }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-surface-900/20 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche globale"
        className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-modal border border-surface-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-surface-400 shrink-0">
            <path d="M8 14A6 6 0 108 2a6 6 0 000 12zM16 16l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={onKey}
            placeholder="Rechercher mission, chauffeur…"
            className="flex-1 text-surface-900 text-sm placeholder-surface-400 outline-none bg-transparent"
          />
          <kbd className="text-[10px] text-surface-400 border border-surface-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {}
        {items.length > 0 ? (
          <ul className="py-1 max-h-[340px] overflow-y-auto">
            {items.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(r)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selected ? 'bg-brand-50' : 'hover:bg-surface-50'
                  }`}
                >
                  <span className="text-base shrink-0">{TYPE_ICON[r.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-surface-900 text-sm font-medium truncate">{r.label}</div>
                    <div className="text-surface-400 text-[11px] truncate">{r.sub}</div>
                  </div>
                  <span className="text-[10px] text-surface-400 shrink-0 bg-surface-100 px-1.5 py-0.5 rounded">
                    {TYPE_LABEL[r.type]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : query ? (
          <div className="px-4 py-8 text-center text-surface-400 text-sm">
            Aucun résultat pour « {query} »
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-surface-400 text-sm">
            Tapez pour rechercher une mission, un chauffeur…
          </div>
        )}

        <div className="px-4 py-2 border-t border-surface-100 flex items-center gap-3 text-[10px] text-surface-400">
          <span><kbd className="border border-surface-200 rounded px-1">↑↓</kbd> Naviguer</span>
          <span><kbd className="border border-surface-200 rounded px-1">↵</kbd> Ouvrir</span>
          <span className="ml-auto">Ctrl+K pour fermer</span>
        </div>
      </div>
    </div>
  )
}
