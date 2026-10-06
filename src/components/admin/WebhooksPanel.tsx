'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from './ui'

interface Endpoint { id: string; url: string; description: string; events: string[]; active: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; consecutiveFailures: number }
interface Delivery { id: string; eventId: string; eventType: string; status: string; attempts: number; lastStatusCode: number | null; lastError: string | null; createdAt: string }

const STATUS: Record<string, string> = { PENDING: 'En attente', SUCCESS: 'Livré', FAILED: 'Nouvel essai prévu', DEAD: 'Abandonné' }

/**
 * Outgoing webhooks: an ERP or BI tool subscribes to business events (mission done, invoice
 * issued, bin placed…). Signed (HMAC), retried with backoff, history and manual replay.
 */
export function WebhooksPanel() {
  const [list, setList] = useState<Endpoint[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [form, setForm] = useState({ url: '', description: '', events: [] as string[] })
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<{ id: string; rows: Delivery[] } | null>(null)

  const load = useCallback(async () => {
    const r = await apiRequest<{ data: Endpoint[]; events: string[] }>('/api/webhook-endpoints')
    if (r.ok) { setList(r.data.data); setEvents(r.data.events) } else setError(r.error)
  }, [])
  useEffect(() => { void load() }, [load])

  async function create() {
    setError('')
    const r = await apiRequest<{ secret: string }>('/api/webhook-endpoints', { method: 'POST', json: form })
    if (!r.ok) { setError(r.error); return }
    setSecret(r.data.secret); setForm({ url: '', description: '', events: [] }); void load()
  }
  async function showHistory(id: string) {
    const r = await apiRequest<{ data: Delivery[] }>(`/api/webhook-endpoints/${id}?limit=30`)
    if (r.ok) setHistory({ id, rows: r.data.data })
  }
  async function call(path: string, method: 'POST' | 'PUT' | 'DELETE', json?: unknown) {
    setError('')
    const r = await apiRequest<{ result?: string; status?: string; lastError?: string }>(path, { method, json })
    if (!r.ok) { setError(r.error); return }
    if (r.data?.result) setError(r.data.result === 'SUCCESS' ? '' : `Échec : ${r.data.lastError ?? r.data.status}`)
    void load()
    if (history) void showHistory(history.id)
  }

  return (
    <section aria-labelledby="webhooks-title" className="space-y-4">
      <div>
        <h3 id="webhooks-title" className="text-sm font-semibold text-surface-900">Webhooks sortants</h3>
        <p className="text-xs text-surface-500">Chaque envoi porte l&apos;en-tête <code>Pathelix-Signature</code> (HMAC-SHA256 de « horodatage.corps ») et <code>Pathelix-Event-Id</code> : le destinataire vérifie la signature et ignore un identifiant déjà reçu. Échecs relancés pendant 24 h.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {secret && (
        <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Secret de signature (affiché une seule fois) : <code className="select-all break-all font-mono">{secret}</code>
          <button type="button" className="ml-2 underline" onClick={() => setSecret(null)}>J&apos;ai copié le secret</button>
        </div>
      )}
      <ul className="divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200">
        {list.map(e => (
          <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all font-medium text-surface-900">{e.url}</span>
              {!e.active && <span className="rounded-full bg-surface-100 px-2 text-xs text-surface-600">désactivé</span>}
              {e.consecutiveFailures > 0 && <span className="rounded-full bg-red-50 px-2 text-xs text-red-700">{e.consecutiveFailures} échec(s) de suite</span>}
            </div>
            <div className="text-xs text-surface-500">{e.events.length ? e.events.join(', ') : 'Tous les événements'}{e.lastSuccessAt ? ` · dernier succès ${new Date(e.lastSuccessAt).toLocaleString('fr-FR')}` : ''}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Btn onClick={() => void call(`/api/webhook-endpoints/${e.id}/test`, 'POST')} variant="ghost" size="xs">Envoyer un test</Btn>
              <Btn onClick={() => void showHistory(e.id)} variant="ghost" size="xs">Historique</Btn>
              <Btn onClick={() => void call(`/api/webhook-endpoints/${e.id}`, 'PUT', { active: !e.active })} variant="ghost" size="xs">{e.active ? 'Désactiver' : 'Réactiver'}</Btn>
              <Btn onClick={() => { if (window.confirm('Supprimer ce webhook et son historique ?')) void call(`/api/webhook-endpoints/${e.id}`, 'DELETE') }} variant="danger" size="xs">Supprimer</Btn>
            </div>
            {history?.id === e.id && (
              <table className="mt-2 w-full text-xs">
                <tbody className="divide-y divide-surface-100">{history.rows.map(d => (
                  <tr key={d.id}>
                    <td className="py-1">{new Date(d.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{d.eventType}</td>
                    <td>{STATUS[d.status] ?? d.status}{d.lastStatusCode ? ` (HTTP ${d.lastStatusCode})` : ''}{d.lastError && d.status !== 'SUCCESS' ? ` — ${d.lastError}` : ''}</td>
                    <td className="text-right">{d.status !== 'SUCCESS' && <button type="button" className="text-brand-600 hover:underline" onClick={() => void call(`/api/webhook-deliveries/${d.id}/replay`, 'POST')}>Rejouer</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="px-4 py-4 text-sm text-surface-500">Aucun abonné.</li>}
      </ul>
      <div className="space-y-2 rounded-xl bg-surface-50 p-4">
        <input aria-label="URL du destinataire" className="w-full rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-sm" placeholder="https://erp.exemple.fr/pathelix/webhook" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
        <input aria-label="Description" className="w-full rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-sm" placeholder="Description (facultatif)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <legend className="mb-1 text-xs text-surface-600">Événements (aucun coché = tous)</legend>
          {events.map(ev => (
            <label key={ev} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={form.events.includes(ev)} onChange={e => setForm(f => ({ ...f, events: e.target.checked ? [...f.events, ev] : f.events.filter(x => x !== ev) }))} />{ev}</label>
          ))}
        </fieldset>
        <Btn onClick={() => void create()} size="sm" disabled={!form.url}>Ajouter le webhook</Btn>
      </div>
    </section>
  )
}
