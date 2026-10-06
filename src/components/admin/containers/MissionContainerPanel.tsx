'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import type { Mission } from '@/lib/types'
import { STATUS_LABEL, type ContainerRow, type ContainerTypeRow } from './shared'

const PLACE = new Set(['POSER', 'ECHANGER'])
const COLLECT = new Set(['RETIRER', 'ECHANGER', 'ALLER_RETOUR', 'CHARGER_IMMEDIAT'])

/**
 * Bins of a mission, from its detail: the type expected, the bin reserved for the pose (checked
 * server-side: available, right size) and the bin to take away (among those at the site). The
 * driver's scan confirms or corrects them in the field.
 */
export function MissionContainerPanel({ mission, onChanged }: { mission: Mission; onChanged?: () => void }) {
  const [types, setTypes] = useState<ContainerTypeRow[]>([])
  const [available, setAvailable] = useState<ContainerRow[]>([])
  const [onSite, setOnSite] = useState<ContainerRow[]>([])
  const [typeId, setTypeId] = useState(mission.containerTypeId ?? '')
  const [placed, setPlaced] = useState(mission.placedContainerId ?? '')
  const [collected, setCollected] = useState(mission.collectedContainerId ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const load = useCallback(async () => {
    const t = await apiRequest<{ data: ContainerTypeRow[] }>('/api/container-types')
    if (t.ok) setTypes(t.data.data)
    if (PLACE.has(mission.type)) {
      const sp = new URLSearchParams({ status: 'AVAILABLE,RESERVED', limit: '100' })
      if (typeId) sp.set('typeId', typeId)
      const r = await apiRequest<{ data: ContainerRow[] }>(`/api/containers?${sp}`)
      if (r.ok) setAvailable(r.data.data)
    }
    if (COLLECT.has(mission.type) && (mission.siteId || mission.clientId)) {
      const sp = new URLSearchParams({ status: 'AT_CUSTOMER,FULL,TO_COLLECT', limit: '100' })
      if (mission.siteId) sp.set('siteId', mission.siteId); else if (mission.clientId) sp.set('clientId', mission.clientId)
      const r = await apiRequest<{ data: ContainerRow[] }>(`/api/containers?${sp}`)
      if (r.ok) setOnSite(r.data.data)
    }
  }, [mission.type, mission.siteId, mission.clientId, typeId])
  useEffect(() => { void load() }, [load])

  if (!PLACE.has(mission.type) && !COLLECT.has(mission.type)) return null
  if (types.length === 0) return null

  async function run(p: Promise<{ ok: boolean; error?: string }>, msg: string) {
    setError(''); setSaved('')
    const r = await p
    if (!r.ok) { setError(r.error ?? 'Erreur'); return }
    setSaved(msg); onChanged?.(); void load()
  }

  const sel = 'mt-1 w-full rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm'
  return (
    <section aria-labelledby={`bins-${mission.id}`} className="rounded-xl bg-surface-50 p-3 space-y-2">
      <h3 id={`bins-${mission.id}`} className="text-sm font-medium text-surface-800">Bennes</h3>
      {PLACE.has(mission.type) && (
        <>
          <label className="block text-xs text-surface-600">Type de benne à poser
            <select className={sel} value={typeId} onChange={e => {
              setTypeId(e.target.value)
              void run(apiRequest(`/api/missions/${mission.id}`, { method: 'PUT', json: { containerTypeId: e.target.value || undefined } }), 'Type enregistré')
            }}>
              <option value="">Non précisé</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.counts.AVAILABLE ?? 0} disponibles)</option>)}
            </select>
          </label>
          <label className="block text-xs text-surface-600">Benne réservée
            <select className={sel} value={placed} onChange={e => {
              setPlaced(e.target.value)
              void run(apiRequest(`/api/missions/${mission.id}/container`, { method: 'POST', json: { containerId: e.target.value || null } }), e.target.value ? 'Benne réservée' : 'Réservation annulée')
            }}>
              <option value="">Aucune (choisie au dépôt, confirmée par le scan)</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.number} — {c.type.name}{c.status === 'RESERVED' ? ' (déjà réservée)' : ''}</option>)}
            </select>
          </label>
        </>
      )}
      {COLLECT.has(mission.type) && (
        <label className="block text-xs text-surface-600">Benne à retirer
          <select className={sel} value={collected} onChange={e => {
            setCollected(e.target.value)
            void run(apiRequest(`/api/missions/${mission.id}`, { method: 'PUT', json: { collectedContainerId: e.target.value || undefined } }), 'Benne à retirer enregistrée')
          }}>
            <option value="">{onSite.length > 0 ? 'Non précisée (confirmée par le scan)' : 'Aucune benne enregistrée sur ce site'}</option>
            {onSite.map(c => <option key={c.id} value={c.id}>{c.number} — {c.type.name} · {STATUS_LABEL[c.status]}{c.daysOnSite !== null ? ` · ${c.daysOnSite} j` : ''}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {saved && <p role="status" className="text-xs text-emerald-700">{saved}</p>}
    </section>
  )
}
