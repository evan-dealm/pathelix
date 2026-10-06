'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest, fetchAllPages } from '@/lib/apiClient'
import type { ContainerStatus } from '@/lib/containers/lifecycle'
import { Btn } from '../ui'
import { STATUS_LABEL, STATUS_TONE, frDate, qrUrl, whereLabel } from './shared'
import { printQrLabels } from './qrPrint'

interface Detail {
  id: string
  number: string
  qrToken: string
  status: ContainerStatus
  condition: string
  locationLabel: string
  placedAt: string | null
  lastRotationAt: string | null
  purchaseDate: string | null
  purchaseCost: number | null
  notes: string
  daysOnSite: number | null
  rotations90: number
  allowedStatuses: ContainerStatus[]
  type: { name: string; capacityM3: number; tareKg: number | null; dailyRentalPrice: number | null }
  client: { id: string; name: string; phone: string } | null
  site: { id: string; name: string; address: string } | null
  events: Array<{ id: string; type: string; fromStatus: ContainerStatus | null; toStatus: ContainerStatus | null; at: string; notes: string; clientName: string | null; driverName: string | null; missionId: string | null }>
  missions: Array<{ id: string; type: string; date: string; clientName: string | null; address: string; completedAt: string | null }>
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Entrée au parc', RESERVED: 'Réservée pour une pose', RELEASED: 'Réservation annulée', LOADED: 'Chargée dans le camion',
  PLACED: 'Posée chez le client', PICKED_UP: 'Retirée', EMPTIED: 'Vidée à l\'exutoire', RETURNED: 'Retour au dépôt',
  STATUS: 'Changement de statut', RELOCATED: 'Emplacement corrigé', SCANNED: 'Scannée', NOTE: 'Note',
}
const CONDITION_LABEL: Record<string, string> = { good: 'Bon état', worn: 'Usée', damaged: 'Abîmée' }

interface Opt { id: string; name: string }

/** Side panel: where the bin is, its QR code, what can be done with it, and its whole history. */
export function ContainerDetail({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [qrSrc, setQrSrc] = useState('')
  const [relocating, setRelocating] = useState(false)
  const [clients, setClients] = useState<Array<Opt & { clientSites?: Array<{ site: Opt }> }>>([])
  const [reloc, setReloc] = useState({ clientId: '', siteId: '', placedAt: '' })
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const res = await apiRequest<Detail>(`/api/containers/${id}`)
    if (!res.ok) { setError(res.error); return }
    setD(res.data)
    const QRCode = (await import('qrcode')).default
    setQrSrc(await QRCode.toDataURL(qrUrl(res.data.qrToken), { margin: 0, width: 224 }))
  }, [id])
  useEffect(() => { setD(null); setError(''); void load() }, [load])
  useEffect(() => { closeRef.current?.focus() }, [id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function changeStatus(to: ContainerStatus) {
    if ((to === 'LOST' || to === 'ARCHIVED') && !window.confirm(`Passer la benne ${d?.number} en « ${STATUS_LABEL[to]} » ?`)) return
    const res = await apiRequest(`/api/containers/${id}/status`, { method: 'POST', json: { status: to } })
    if (!res.ok) { setError(res.error); return }
    void load(); onChanged()
  }

  async function openRelocate() {
    setRelocating(true)
    if (clients.length === 0) setClients(await fetchAllPages<Opt & { clientSites?: Array<{ site: Opt }> }>('/api/clients').catch(() => []))
  }

  async function saveRelocate(toDepot: boolean) {
    const res = await apiRequest(`/api/containers/${id}/relocate`, {
      method: 'POST',
      json: toDepot ? { locationLabel: 'Dépôt' } : { clientId: reloc.clientId || null, siteId: reloc.siteId || null, ...(reloc.placedAt ? { placedAt: reloc.placedAt } : {}) },
    })
    if (!res.ok) { setError(res.error); return }
    setRelocating(false); void load(); onChanged()
  }

  const sites = clients.find(c => c.id === reloc.clientId)?.clientSites?.map(cs => cs.site) ?? []

  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="container-detail-title"
      className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-md flex-col border-l border-surface-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-surface-200 px-5 py-4">
        <div>
          <h2 id="container-detail-title" className="font-display text-2xl font-semibold text-surface-900">{d?.number ?? '…'}</h2>
          {d && <p className="text-sm text-surface-500">{d.type.name} · {CONDITION_LABEL[d.condition] ?? d.condition}</p>}
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer le détail" className="rounded-lg p-2 text-surface-500 hover:bg-surface-100">✕</button>
      </div>
      {error && <p role="alert" className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {d && (
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section className="flex gap-4">
            {qrSrc
              // eslint-disable-next-line @next/next/no-img-element -- generated data: URL
              ? <img src={qrSrc} alt={`QR code de la benne ${d.number}`} className="h-28 w-28 shrink-0 rounded-lg bg-white p-1 ring-1 ring-surface-200" />
              : <div className="h-28 w-28 shrink-0 rounded-lg bg-surface-100" aria-hidden />}
            <dl className="min-w-0 space-y-1.5 text-sm">
              <div><dt className="sr-only">Statut</dt><dd><span className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ${STATUS_TONE[d.status].chip}`}>{STATUS_LABEL[d.status]}</span></dd></div>
              <div><dt className="text-xs text-surface-500">Où</dt><dd className="text-surface-900">{whereLabel(d)}</dd>{d.site?.address && <dd className="text-xs text-surface-500">{d.site.address}</dd>}</div>
              {d.daysOnSite !== null && <div><dt className="text-xs text-surface-500">Sur site depuis</dt><dd className="tabular-nums">{frDate(d.placedAt)} — {d.daysOnSite} jour{d.daysOnSite > 1 ? 's' : ''}</dd></div>}
              <div><dt className="text-xs text-surface-500">Rotations (90 j)</dt><dd className="tabular-nums">{d.rotations90} · dernière le {frDate(d.lastRotationAt)}</dd></div>
            </dl>
          </section>

          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => void printQrLabels([{ number: d.number, qrToken: d.qrToken, typeName: d.type.name }], '')} variant="ghost" size="sm">Imprimer l&apos;étiquette</Btn>
            {canManage && <Btn onClick={() => void openRelocate()} variant="ghost" size="sm">Corriger l&apos;emplacement</Btn>}
          </div>

          {canManage && d.allowedStatuses.length > 0 && (
            <section aria-labelledby="status-actions">
              <h3 id="status-actions" className="text-sm font-medium text-surface-800">Changer le statut</h3>
              <p className="text-xs text-surface-500">Les poses, retraits et vidages mettent la benne à jour seuls.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {d.allowedStatuses.map(s => (
                  <button key={s} type="button" onClick={() => void changeStatus(s)}
                    className={`rounded-full px-3 py-1 text-xs ring-1 hover:opacity-80 ${STATUS_TONE[s].chip}`}>{STATUS_LABEL[s]}</button>
                ))}
              </div>
            </section>
          )}

          {relocating && (
            <section aria-labelledby="relocate-title" className="space-y-2 rounded-xl bg-surface-50 p-3">
              <h3 id="relocate-title" className="text-sm font-medium text-surface-800">Où est cette benne ?</h3>
              <label className="block text-xs text-surface-600">Client
                <select value={reloc.clientId} onChange={e => setReloc({ clientId: e.target.value, siteId: '', placedAt: reloc.placedAt })} className="mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm">
                  <option value="">—</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              {sites.length > 0 && (
                <label className="block text-xs text-surface-600">Site
                  <select value={reloc.siteId} onChange={e => setReloc(r => ({ ...r, siteId: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm">
                    <option value="">—</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block text-xs text-surface-600">Posée le
                <input type="date" value={reloc.placedAt} onChange={e => setReloc(r => ({ ...r, placedAt: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm" />
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                <Btn onClick={() => void saveRelocate(false)} size="sm" disabled={!reloc.clientId && !reloc.siteId}>Enregistrer chez ce client</Btn>
                <Btn onClick={() => void saveRelocate(true)} variant="ghost" size="sm">Elle est au dépôt</Btn>
                <Btn onClick={() => setRelocating(false)} variant="ghost" size="sm">Annuler</Btn>
              </div>
            </section>
          )}

          <section aria-labelledby="history-title">
            <h3 id="history-title" className="text-sm font-medium text-surface-800">Historique</h3>
            <ol className="mt-2 space-y-3 border-l border-surface-200 pl-4">
              {d.events.map(e => (
                <li key={e.id} className="relative text-sm">
                  <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${e.toStatus ? STATUS_TONE[e.toStatus].bar : 'bg-surface-300'}`} aria-hidden />
                  <p className="text-surface-900">{EVENT_LABEL[e.type] ?? e.type}{e.toStatus && e.type === 'STATUS' ? ` : ${STATUS_LABEL[e.toStatus]}` : ''}</p>
                  <p className="text-xs text-surface-500">
                    {new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    {e.clientName ? ` · ${e.clientName}` : ''}{e.driverName ? ` · ${e.driverName}` : ''}
                  </p>
                  {e.notes && <p className="text-xs text-surface-600">{e.notes}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
  )
}
