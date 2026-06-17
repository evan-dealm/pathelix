'use client'

import { useRef, useEffect } from 'react'
import { MissionType } from '@/lib/types'
import { useTrade } from '@/providers/TradeProvider'
import { formatDuration } from '@/lib/algorithm'
import { addDays, today, displayShort } from './hooks'

export function Btn({ onClick, variant = 'primary', size = 'md', children, disabled, title }: {
  onClick: () => void; variant?: 'primary' | 'danger' | 'ghost' | 'success' | 'warning'
  size?: 'xs' | 'sm' | 'md'; children: React.ReactNode; disabled?: boolean; title?: string
}) {
  const cls = {
    primary: 'bg-brand-500 hover:bg-brand-600 text-white shadow-soft hover:shadow-elevated',
    danger:  'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-950 dark:hover:bg-red-900 dark:text-red-400 dark:border-red-800',
    ghost:   'bg-surface-50 hover:bg-surface-100 text-surface-600 border border-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 dark:text-surface-300 dark:border-surface-700',
    success: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-400 dark:border-emerald-800',
    warning: 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900 dark:text-amber-400 dark:border-amber-800',
  }[variant]
  const sz = { xs: 'px-2 py-1 text-[11px]', sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }[size]
  return (
    <button onClick={onClick} disabled={disabled} title={title} type="button"
      className={`font-medium rounded-lg transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${cls} ${sz}`}>
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-surface-500 dark:text-surface-400 text-[11px] font-medium uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export function Input({ value, onChange, placeholder, type = 'text', min, max, step }: {
  value: string; onChange: (_v: string) => void; placeholder?: string
  type?: string; min?: string; max?: string; step?: string
}) {
  return (
    <input type={type} value={value} min={min} max={max} step={step}
      onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-all duration-200" />
  )
}

export function SelectInput({ value, onChange, options, label }: {
  value: string; onChange: (_v: string) => void; options: { value: string; label: string }[]; label?: string
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      aria-label={label} title={label}
      className="w-full bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-surface-900 dark:text-surface-100 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-all duration-200">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (_v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 transition-all duration-200 resize-none" />
  )
}

export function Modal({ title, onClose, children, size = 'md' }: {
  title: string; onClose: () => void; children: React.ReactNode; size?: 'lg' | 'md' | 'sm'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    first?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      const panel = panelRef.current
      if (!panel || e.key !== 'Tab') return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 bg-surface-900/30 dark:bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-2xl max-h-[90vh] overflow-y-auto shadow-modal ${size === 'sm' ? 'w-full max-w-sm' : size === 'lg' ? 'w-full max-w-4xl' : 'w-full max-w-lg'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h2 id="modal-title" className="text-surface-900 dark:text-surface-100 font-semibold text-base">{title}</h2>
          <button type="button" onClick={onClose} title="Fermer" aria-label="Fermer" className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 w-8 h-8 flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

export function TypeBadge({ type }: { type: MissionType }) {
  const { missionIcon, missionLabel } = useTrade()
  const colors: Record<string, string> = {
    POSER:    'bg-blue-50 text-blue-700 border-blue-200',
    RETIRER:  'bg-amber-50 text-amber-700 border-amber-200',
    ECHANGER: 'bg-violet-50 text-violet-700 border-violet-200',
    VIDER:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    PAUSE:    'bg-surface-100 text-surface-500 border-surface-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${colors[type] || colors.PAUSE}`}>
      {missionIcon(type)} {missionLabel(type)}
    </span>
  )
}

export function P1Badge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 whitespace-nowrap leading-none">
      P1 URGENT
    </span>
  )
}

export function LegalBar({ valueMin, maxMin, label }: { valueMin: number; maxMin: number; label: string }) {
  const pct    = Math.min(110, (valueMin / maxMin) * 100)
  const barCls = pct >= 100 ? 'bg-red-500'     : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-500'
  const valCls = pct >= 100 ? 'text-red-600'   : pct >= 75 ? 'text-amber-600' : 'text-surface-500'
  const widthPct = Math.min(100, pct)
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-surface-400 text-[9px] uppercase tracking-wide font-medium">{label}</span>
        <span className={`text-[10px] font-semibold tabular-nums ${valCls}`}>
          {formatDuration(valueMin)} / {formatDuration(maxMin)}
        </span>
      </div>
      <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barCls}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  )
}

export function DateNav({ dateStr, setDate, label }: { dateStr: string; setDate: (_d: string) => void; label?: string }) {
  return (
    <div className="flex items-center gap-1">
      {label && <span className="text-surface-400 text-xs mr-1 font-medium">{label}</span>}
      <button type="button" onClick={() => setDate(addDays(dateStr, -1))} title="Jour precedent" aria-label="Jour precedent"
        className="w-7 h-7 flex items-center justify-center text-surface-400 hover:text-surface-700 hover:bg-surface-100 rounded-lg transition-colors text-sm">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 3.5L5 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button type="button" onClick={() => setDate(today())}
        className="px-2.5 py-1 text-xs text-surface-600 hover:text-surface-900 hover:bg-surface-100 rounded-lg transition-colors whitespace-nowrap font-medium">
        {dateStr === today() ? "Aujourd'hui" : displayShort(dateStr)}
      </button>
      <button type="button" onClick={() => setDate(addDays(dateStr, 1))} title="Jour suivant" aria-label="Jour suivant"
        className="w-7 h-7 flex items-center justify-center text-surface-400 hover:text-surface-700 hover:bg-surface-100 rounded-lg transition-colors text-sm">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 3.5L9 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  )
}
