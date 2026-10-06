'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { apiRequest } from '@/lib/apiClient'

interface Hit { kind: string; id: string; label: string; sub: string; tab: string }
interface Command { id: string; label: string; tab: string }

interface Props {
  onNavigate: (_tab: string) => void
  /** Screens the user may open (label + tab) — offered as "Aller à …" commands. */
  commands?: Command[]
}

const KIND_LABEL: Record<string, string> = {
  mission: 'Mission', client: 'Client', site: 'Site', container: 'Benne', driver: 'Chauffeur', vehicle: 'Camion',
  quote: 'Devis', order: 'Commande', invoice: 'Facture', command: 'Aller à',
}

/**
 * Ctrl/Cmd+K: search across the whole account (server side, each family only if the user may see
 * it) and jump to any screen. Keyboard: ↑↓ to move, Enter to open, Esc to close.
 */
export function GlobalSearch({ onNavigate, commands = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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
    if (open) { setTimeout(() => inputRef.current?.focus(), 30); setSelected(0) }
  }, [open])

  // Debounced server search; a late answer for an older query is ignored.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setHits([]); setLoading(false); return }
    const id = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await apiRequest<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(q)}`)
      if (id !== seq.current) return
      setHits(r.ok ? r.data.hits : [])
      setLoading(false)
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  const items = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    const cmd = commands
      .filter(c => !q || c.label.toLowerCase().includes(q))
      .slice(0, q ? 4 : 8)
      .map(c => ({ kind: 'command', id: `cmd-${c.id}`, label: c.label, sub: '', tab: c.tab }))
    return [...hits, ...cmd]
  }, [hits, commands, query])

  function handleSelect(r: Hit) {
    onNavigate(r.tab)
    setOpen(false)
    setQuery('')
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && items[selected]) handleSelect(items[selected])
  }

  if (!open) return null
  const activeId = items[selected] ? `gs-${items[selected].id}` : undefined

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-surface-900/20 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label="Recherche globale" className="relative mx-4 w-full max-w-xl overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-surface-200 px-4 py-3">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0 text-surface-400" aria-hidden>
            <path d="M8 14A6 6 0 108 2a6 6 0 000 12zM16 16l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="gs-list"
            aria-activedescendant={activeId}
            aria-label="Rechercher"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={onKey}
            placeholder="Client, site, benne, mission, devis, facture, camion… ou un écran"
            className="flex-1 bg-transparent text-sm text-surface-900 placeholder-surface-400 outline-none"
          />
          {loading && <span role="status" className="text-xs text-surface-400">Recherche…</span>}
          <kbd className="rounded border border-surface-200 px-1.5 py-0.5 text-[10px] text-surface-400">Esc</kbd>
        </div>

        {items.length > 0 ? (
          <ul id="gs-list" role="listbox" aria-label="Résultats" className="max-h-[360px] overflow-y-auto py-1">
            {items.map((r, i) => (
              <li key={r.id} id={`gs-${r.id}`} role="option" aria-selected={i === selected}
                onClick={() => handleSelect(r)} onMouseEnter={() => setSelected(i)}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${i === selected ? 'bg-brand-50' : 'hover:bg-surface-50'}`}>
                <span className="w-20 shrink-0 text-[11px] text-surface-500">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-surface-900">{r.label}</div>
                  {r.sub && <div className="truncate text-[11px] text-surface-500">{r.sub}</div>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-surface-500">
            {query.trim().length >= 2 && !loading ? `Aucun résultat pour « ${query.trim()} »` : 'Tapez au moins 2 caractères'}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-surface-100 px-4 py-2 text-[10px] text-surface-500">
          <span><kbd className="rounded border border-surface-200 px-1">↑↓</kbd> Naviguer</span>
          <span><kbd className="rounded border border-surface-200 px-1">↵</kbd> Ouvrir</span>
          <span className="ml-auto">Ctrl+K pour fermer</span>
        </div>
      </div>
    </div>
  )
}
