'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { API_SCOPES } from '@/lib/apiScopes'

interface ApiKeyRow {
  id:         string
  name:       string
  prefix:     string
  scopes:     string[]
  lastUsedAt: string | null
  expiresAt:  string | null
  createdAt:  string
}

const SCOPE_LABELS: Record<string, string> = {
  'missions:read':  'Missions — lecture',
  'missions:write': 'Missions — écriture',
  'drivers:read':   'Chauffeurs — lecture',
  'drivers:write':  'Chauffeurs — écriture',
  'vehicles:read':  'Véhicules — lecture',
  'vehicles:write': 'Véhicules — écriture',
  'clients:read':   'Clients — lecture',
  'clients:write':  'Clients — écriture',
  'sites:read':     'Sites — lecture',
  'sites:write':    'Sites — écriture',
  'plans:read':     'Tournées — lecture',
  'plans:write':    'Tournées — écriture',
  'optimize':       'Lancer une optimisation',
  'reports:read':   'Rapports — lecture',
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')

/**
 * Admin → Paramètres → Accès API: create, list and revoke the tenant's API keys. A key is shown
 * in full once, at creation; it authenticates `X-API-Key` requests limited to its scopes.
 */
export function ApiKeysPanel() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<string>>(new Set(['missions:read']))
  const [expiresInDays, setExpiresInDays] = useState<number | ''>(365)
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiRequest<ApiKeyRow[]>('/api/api-keys', { cache: 'no-store' })
    if (res.ok) { setKeys(res.data); setForbidden(false) }
    else if (res.status === 403) setForbidden(true)
    else toastError(res.error)
    setLoading(false)
  }, [toastError])

  useEffect(() => { void load() }, [load])

  function toggleScope(s: string) {
    setScopes(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  async function create() {
    if (!name.trim() || scopes.size === 0) return
    setCreating(true)
    const res = await apiRequest<ApiKeyRow & { token: string }>('/api/api-keys', {
      method: 'POST',
      json: { name: name.trim(), scopes: [...scopes], ...(expiresInDays ? { expiresInDays } : {}) },
    })
    setCreating(false)
    if (!res.ok) { toastError(res.error); return }
    setNewToken(res.data.token)
    setName('')
    void load()
  }

  async function revoke(key: ApiKeyRow) {
    if (!confirm(`Révoquer la clé « ${key.name} » ? Les intégrations qui l'utilisent cesseront de fonctionner.`)) return
    const res = await apiRequest(`/api/api-keys?id=${encodeURIComponent(key.id)}`, { method: 'DELETE' })
    if (!res.ok) { toastError(res.error); return }
    toastSuccess('Clé révoquée')
    setKeys(prev => prev.filter(k => k.id !== key.id))
  }

  async function copyToken() {
    if (!newToken) return
    try { await navigator.clipboard.writeText(newToken); toastSuccess('Clé copiée') }
    catch { toastError('Copie impossible — sélectionnez la clé manuellement') }
  }

  const card = 'bg-white border border-surface-200 rounded-xl p-4'
  const inp = 'w-full bg-surface-100 border border-surface-200 rounded-lg px-2.5 py-1.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4] focus:ring-1 focus:ring-[#0055A4]'

  if (forbidden) {
    return <div className={card}><p className="text-xs text-surface-500">La permission « Accès API » est nécessaire pour gérer les clés API.</p></div>
  }

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className={card}>
        <h3 className="text-surface-900 font-semibold text-sm mb-1">Clés API</h3>
        <p className="text-xs text-surface-500 mb-3">
          Pour connecter un ERP ou un outil interne : envoyez la clé dans l&apos;en-tête <code className="px-1 bg-surface-100 rounded">X-API-Key</code>.
          Une clé n&apos;accède qu&apos;aux opérations cochées, avec les droits d&apos;un exploitant. Documentation : <a className="text-[#0055A4] underline" href="/api/docs" target="_blank" rel="noreferrer">/api/docs</a>.
        </p>

        {newToken && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">Copiez cette clé maintenant — elle ne sera plus jamais affichée.</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 text-[11px] break-all bg-white border border-amber-200 rounded px-2 py-1 select-all">{newToken}</code>
              <button type="button" onClick={copyToken} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#0055A4] text-white">Copier</button>
              <button type="button" onClick={() => setNewToken(null)} className="px-2.5 py-1 text-xs rounded-lg border border-surface-200">Fermer</button>
            </div>
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-[1fr_140px]">
          <div>
            <label className="block text-surface-400 text-[10px] mb-0.5" htmlFor="apikey-name">Nom (ex. « ERP Sage »)</label>
            <input id="apikey-name" className={inp} value={name} maxLength={100} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-surface-400 text-[10px] mb-0.5" htmlFor="apikey-exp">Expiration</label>
            <select id="apikey-exp" className={inp} value={expiresInDays} onChange={e => setExpiresInDays(e.target.value ? Number(e.target.value) : '')}>
              <option value={30}>30 jours</option>
              <option value={90}>90 jours</option>
              <option value={365}>1 an</option>
              <option value="">Jamais</option>
            </select>
          </div>
        </div>
        <fieldset className="mt-2">
          <legend className="text-surface-400 text-[10px] mb-1">Opérations autorisées</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {API_SCOPES.map(s => (
              <label key={s} className="flex items-center gap-2 text-xs text-surface-700 cursor-pointer">
                <input type="checkbox" checked={scopes.has(s)} onChange={() => toggleScope(s)} />
                {SCOPE_LABELS[s] ?? s}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="button" onClick={create} disabled={creating || !name.trim() || scopes.size === 0}
          className="mt-3 px-3 py-1.5 bg-[#0055A4] hover:bg-[#0066c4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
          {creating ? 'Création…' : 'Créer la clé'}
        </button>
      </div>

      <div className={card}>
        <h3 className="text-surface-900 font-semibold text-sm mb-2">Clés actives</h3>
        {loading ? (
          <p className="text-xs text-surface-400">Chargement…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-surface-400">Aucune clé active.</p>
        ) : (
          <ul className="divide-y divide-surface-100">
            {keys.map(k => (
              <li key={k.id} className="py-2 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-surface-900">{k.name} <code className="ml-1 text-[10px] text-surface-400">{k.prefix}…</code></p>
                  <p className="text-[10px] text-surface-500 truncate">{k.scopes.map(s => SCOPE_LABELS[s] ?? s).join(' · ')}</p>
                  <p className="text-[10px] text-surface-400">Créée le {fmtDate(k.createdAt)} · dernière utilisation {fmtDate(k.lastUsedAt)} · expire {k.expiresAt ? `le ${fmtDate(k.expiresAt)}` : 'jamais'}</p>
                </div>
                <button type="button" onClick={() => revoke(k)} className="px-2.5 py-1 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Révoquer</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
