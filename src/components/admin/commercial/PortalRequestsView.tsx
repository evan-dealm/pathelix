'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { Empty, frDay, inputCls, todayIso } from './shared'

interface PortalRequest {
  id: string; kind: string; status: string; preferredDate: string | null; message: string; response: string; createdAt: string; missionId: string | null
  client: { id: string; name: string }
  container: { id: string; number: string; type: { name: string } } | null
  site: { id: string; name: string; address: string } | null
}

const KIND: Record<string, string> = { ROTATION: 'Rotation', PICKUP: 'Retrait', NEW_CONTAINER: 'Benne supplémentaire', ISSUE: 'Problème signalé', OTHER: 'Autre demande' }
const STATUS: Record<string, string> = { NEW: 'Nouvelle', ACCEPTED: 'Planifiée', DONE: 'Traitée', REJECTED: 'Refusée' }
/** The mission a request naturally turns into (null: needs a human decision). */
const MISSION_FOR: Record<string, 'ECHANGER' | 'RETIRER' | 'POSER' | null> = { ROTATION: 'ECHANGER', PICKUP: 'RETIRER', NEW_CONTAINER: 'POSER', ISSUE: null, OTHER: null }

/** Requests sent by customers from their portal; accepting can create the mission directly. */
export function PortalRequestsView() {
  const [filter, setFilter] = useState<'NEW' | 'ALL'>('NEW')
  const [rows, setRows] = useState<PortalRequest[]>([])
  const [error, setError] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const r = await apiRequest<{ data: PortalRequest[] }>(`/api/portal-requests?status=${filter}`)
    if (r.ok) setRows(r.data.data); else setError(r.error)
  }, [filter])
  useEffect(() => { void load() }, [load])

  async function handle(req: PortalRequest, status: 'ACCEPTED' | 'DONE' | 'REJECTED', withMission: boolean) {
    const type = MISSION_FOR[req.kind]
    const date = dates[req.id] || req.preferredDate || todayIso()
    const r = await apiRequest(`/api/portal-requests/${req.id}`, {
      method: 'PUT',
      json: { status, response: answers[req.id] || undefined, createMission: withMission && type ? { type, date } : undefined },
    })
    if (!r.ok) { setError(r.error); return }
    setError(''); void load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-2"><input type="radio" checked={filter === 'NEW'} onChange={() => setFilter('NEW')} />À traiter</label>
        <label className="inline-flex items-center gap-2"><input type="radio" checked={filter === 'ALL'} onChange={() => setFilter('ALL')} />Toutes</label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows.length === 0 ? <Empty title="Aucune demande client">Les demandes envoyées depuis l&apos;espace client arrivent ici.</Empty> : (
        <ul className="divide-y divide-surface-100 rounded-xl bg-white ring-1 ring-surface-200">
          {rows.map(req => {
            const type = MISSION_FOR[req.kind]
            return (
              <li key={req.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><strong>{KIND[req.kind] ?? req.kind}</strong> · {req.client.name}{req.container ? ` · benne ${req.container.number} (${req.container.type.name})` : ''}</span>
                  <span className="text-xs text-surface-500">{STATUS[req.status] ?? req.status} · reçue le {frDay(req.createdAt.slice(0, 10))}</span>
                </div>
                <p className="text-surface-600">{req.site ? `${req.site.name} — ${req.site.address}` : 'Site non précisé'}{req.preferredDate ? ` · souhaitée le ${frDay(req.preferredDate)}` : ''}</p>
                {req.message && <p className="text-surface-800">« {req.message} »</p>}
                {req.response && <p className="text-xs text-surface-500">Réponse : {req.response}</p>}
                {req.status === 'NEW' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <input aria-label="Réponse au client" className={`${inputCls} max-w-xs`} placeholder="Réponse visible par le client" value={answers[req.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [req.id]: e.target.value }))} />
                    {type && req.site && <>
                      <input type="date" aria-label="Date de l'intervention" className={`${inputCls} w-40`} value={dates[req.id] ?? req.preferredDate ?? todayIso()} onChange={e => setDates(d => ({ ...d, [req.id]: e.target.value }))} />
                      <Btn size="sm" onClick={() => void handle(req, 'ACCEPTED', true)}>Planifier la mission</Btn>
                    </>}
                    <Btn size="sm" variant="ghost" onClick={() => void handle(req, 'DONE', false)}>Marquer traitée</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => void handle(req, 'REJECTED', false)}>Refuser</Btn>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
