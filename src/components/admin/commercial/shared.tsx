'use client'

import { useEffect, useRef, type ReactNode } from 'react'

export const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
export const frDay = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '—')
export const todayIso = () => new Date().toISOString().slice(0, 10)

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet'
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-100 text-surface-700 ring-surface-200',
  blue:    'bg-sky-50 text-sky-800 ring-sky-200',
  green:   'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber:   'bg-amber-50 text-amber-800 ring-amber-200',
  red:     'bg-red-50 text-red-700 ring-red-200',
  violet:  'bg-violet-50 text-violet-700 ring-violet-200',
}

export const QUOTE_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Brouillon', 'neutral'], SENT: ['Envoyé', 'blue'], ACCEPTED: ['Accepté', 'green'], REFUSED: ['Refusé', 'red'],
  EXPIRED: ['Expiré', 'amber'], CONVERTED: ['En commande', 'violet'],
}
export const ORDER_STATUS: Record<string, [string, Tone]> = {
  CONFIRMED: ['Confirmée', 'blue'], IN_PROGRESS: ['En cours', 'violet'], COMPLETED: ['Terminée', 'green'], CANCELLED: ['Annulée', 'neutral'],
}
export const INVOICE_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Brouillon', 'neutral'], ISSUED: ['Émise', 'blue'], SENT: ['Envoyée', 'blue'], PARTIALLY_PAID: ['Payée en partie', 'amber'],
  PAID: ['Payée', 'green'], OVERDUE: ['En retard', 'red'], CANCELLED: ['Annulée', 'neutral'],
}
export const CONTRACT_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Brouillon', 'neutral'], ACTIVE: ['Actif', 'green'], SUSPENDED: ['Suspendu', 'amber'], ENDED: ['Terminé', 'neutral'],
}

export function StatusChip({ map, status }: { map: Record<string, [string, Tone]>; status: string }) {
  const [label, tone] = map[status] ?? [status, 'neutral' as Tone]
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs ring-1 ${TONE[tone]}`}>{label}</span>
}

/**
 * Right-hand panel for a record (quote, invoice, customer…): keeps the list visible, closes on
 * Escape, takes the focus when it opens. The list stays the way back.
 */
export function SidePanel({ title, subtitle, onClose, children, actions, wide }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <aside role="dialog" aria-modal="false" aria-label={typeof title === 'string' ? title : undefined}
      className={`fixed inset-y-0 right-0 z-[60] flex w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} flex-col border-l border-surface-200 bg-white shadow-2xl`}>
      <div className="flex items-start justify-between gap-3 border-b border-surface-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-semibold text-surface-900">{title}</h2>
          {subtitle && <div className="mt-0.5 text-sm text-surface-500">{subtitle}</div>}
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg p-2 text-surface-500 hover:bg-surface-100">✕</button>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 border-b border-surface-100 px-5 py-2.5">{actions}</div>}
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  )
}

export function SubTabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<[T, string]>; value: T; onChange: (_v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1">
      {tabs.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`rounded-lg px-3 py-1.5 text-sm ${value === id ? 'bg-brand-50 font-medium text-brand-700' : 'text-surface-500 hover:bg-surface-100 hover:text-surface-800'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-6 py-14 text-center">
      <h3 className="font-display text-lg font-semibold text-surface-900">{title}</h3>
      {children && <p className="mt-2 text-sm text-surface-600">{children}</p>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Opens the printable HTML of a quote/invoice (prints, or saves as PDF from the browser). */
export function openPrintable(kind: 'quote' | 'invoice', id: string) {
  window.open(`/api/sales-documents/${kind}/${id}`, '_blank', 'noopener')
}

export async function downloadPdf(kind: 'quote' | 'invoice', id: string): Promise<string | null> {
  const res = await fetch(`/api/sales-documents/${kind}/${id}?format=pdf`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    return body.error ?? 'PDF indisponible'
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'document.pdf'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return null
}

export const inputCls = 'w-full rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-sm text-surface-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'
