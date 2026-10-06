'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'

interface Notification { id: string; kind: string; severity: string; title: string; body: string; link: string; readAt: string | null; createdAt: string }
interface Pref { kind: string; label: string; severity: string; inApp: boolean; email: boolean }

const POLL_MS = 60_000
const SEVERITY_DOT: Record<string, string> = { critical: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-sky-500' }

/**
 * The notification centre: what needs attention (P1, incidents, unplanned missions, overdue
 * invoices, long bin stays…), grouped server-side so it never floods. Clicking opens the tab.
 */
export function NotificationBell({ onNavigate }: { onNavigate: (_tab: string) => void }) {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<{ emailAvailable: boolean; prefs: Pref[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const r = await apiRequest<{ data: Notification[]; unread: number }>('/api/notifications')
    if (r.ok) { setItems(r.data.data); setUnread(r.data.unread) }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function markAll() {
    await apiRequest('/api/notifications/read', { method: 'POST', json: { all: true } })
    void load()
  }
  async function openItem(n: Notification) {
    if (!n.readAt) await apiRequest('/api/notifications/read', { method: 'POST', json: { ids: [n.id] } })
    setOpen(false)
    if (n.link) onNavigate(n.link)
    void load()
  }
  async function loadPrefs() {
    const r = await apiRequest<{ emailAvailable: boolean; prefs: Pref[] }>('/api/notifications/preferences')
    if (r.ok) setPrefs(r.data)
  }
  async function savePref(p: Pref) {
    if (!prefs) return
    const next = prefs.prefs.map(x => (x.kind === p.kind ? p : x))
    setPrefs({ ...prefs, prefs: next })
    await apiRequest('/api/notifications/preferences', { method: 'PUT', json: { prefs: next.map(x => ({ kind: x.kind, inApp: x.inApp, email: x.email })) } })
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications : ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications'}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden><path d="M9 2.5a4.5 4.5 0 00-4.5 4.5v2.4L3 12.5h12l-1.5-3.1V7A4.5 4.5 0 009 2.5zM7.2 14.5a1.9 1.9 0 003.6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-10 z-[70] w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-surface-200">
          <div className="flex items-center justify-between border-b border-surface-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-surface-900">Notifications</h2>
            <div className="flex gap-3 text-xs">
              {unread > 0 && <button type="button" onClick={() => void markAll()} className="text-brand-600 hover:underline">Tout marquer comme lu</button>}
              <button type="button" onClick={() => (prefs ? setPrefs(null) : void loadPrefs())} className="text-surface-500 hover:text-surface-800">{prefs ? 'Retour' : 'Préférences'}</button>
            </div>
          </div>
          {prefs ? (
            <div className="max-h-96 overflow-y-auto px-4 py-2">
              {!prefs.emailAvailable && <p className="pb-2 text-xs text-surface-500">L&apos;envoi d&apos;e-mails n&apos;est pas configuré sur ce serveur : seules les notifications dans l&apos;application sont actives.</p>}
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-surface-500"><tr><th className="py-1 font-medium">Sujet</th><th className="text-center font-medium">Appli</th><th className="text-center font-medium">E-mail</th></tr></thead>
                <tbody>{prefs.prefs.map(p => (
                  <tr key={p.kind}>
                    <td className="py-1.5">{p.label}</td>
                    <td className="text-center"><input type="checkbox" aria-label={`${p.label} dans l'application`} checked={p.inApp || p.severity === 'critical'} disabled={p.severity === 'critical'} onChange={e => void savePref({ ...p, inApp: e.target.checked })} /></td>
                    <td className="text-center"><input type="checkbox" aria-label={`${p.label} par e-mail`} checked={p.email} disabled={!prefs.emailAvailable} onChange={e => void savePref({ ...p, email: e.target.checked })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-surface-100 overflow-y-auto">
              {items.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => void openItem(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-50 ${n.readAt ? '' : 'bg-brand-50/40'}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity] ?? 'bg-surface-300'}`} aria-hidden />
                    <span className="min-w-0">
                      <span className={`block text-sm ${n.readAt ? 'text-surface-700' : 'font-medium text-surface-900'}`}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-surface-500">{n.body}</span>}
                      <span className="block text-[11px] text-surface-400">{new Date(n.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </span>
                  </button>
                </li>
              ))}
              {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-surface-500">Rien à signaler.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
