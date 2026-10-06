'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { apiRequest } from '@/lib/apiClient'
import { useDebounce } from '../hooks'
import { Btn } from '../ui'
import { useToast } from '@/components/ui/Toast'
import { usePermissions, hasPerm } from '@/hooks/usePermissions'
import { CONTAINER_STATUSES, type ContainerStatus } from '@/lib/containers/lifecycle'
import { FleetBars, type TypeAvailability } from './FleetBars'
import { ContainerDetail } from './ContainerDetail'
import { AddContainersModal } from './AddContainersModal'
import { ContainerTypesModal } from './ContainerTypesModal'
import { printQrLabels } from './qrPrint'
import { STATUS_LABEL, STATUS_TONE, frDate, whereLabel, type ContainerRow } from './shared'

const ContainersMap = dynamic(() => import('./ContainersMap').then(m => m.ContainersMap), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-surface-400">Chargement de la carte…</div>,
})

interface Stats {
  total: number
  byStatus: Record<string, number>
  byType: TypeAvailability[]
  utilisationPct: number | null
  avgDaysOnSite: number | null
  longStay: { days: number; count: number }
  immobilized: number
  rotations: { windowDays: number; total: number; perContainer: number | null }
  leastRotated: Array<{ id: string; number: string; status: ContainerStatus; rotations: number; lastRotationAt: string | null; type: string }>
  topClients: Array<{ clientId: string; name: string; containers: number; days: number; rentEstimate: number }>
}

type View = 'list' | 'map' | 'insights'
const SORTS = [
  { value: 'number', label: 'Numéro' },
  { value: 'daysOnSite', label: 'Le plus longtemps chez client' },
  { value: 'rotation', label: 'Rotation la plus ancienne' },
  { value: '-movement', label: 'Dernier mouvement' },
]

export function ContainersTab() {
  const { error: toastError } = useToast()
  const { permissions } = usePermissions()
  const canManage = hasPerm(permissions, 'manage_vehicles')
  const [stats, setStats] = useState<Stats | null>(null)
  const [rows, setRows] = useState<ContainerRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const debouncedQ = useDebounce(q, 250)
  const [status, setStatus] = useState<string>('')
  const [typeId, setTypeId] = useState('')
  const [longStay, setLongStay] = useState(false)
  const [sort, setSort] = useState('number')
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [modal, setModal] = useState<'add' | 'types' | null>(null)
  const pageSize = view === 'map' ? 100 : 50

  const loadStats = useCallback(async () => {
    const res = await apiRequest<Stats>('/api/containers/stats')
    if (res.ok) setStats(res.data)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const sp = new URLSearchParams({ page: String(page), limit: String(pageSize), sort })
    if (debouncedQ) sp.set('q', debouncedQ)
    if (status) sp.set('status', status)
    if (typeId) sp.set('typeId', typeId)
    if (longStay && stats) sp.set('minDays', String(stats.longStay.days))
    else if (longStay) sp.set('minDays', '30')
    const res = await apiRequest<{ data: ContainerRow[]; pagination: { total: number } }>(`/api/containers?${sp}`)
    setLoading(false)
    if (!res.ok) { toastError(res.error); return }
    setRows(res.data.data)
    setTotal(res.data.pagination.total)
  }, [page, pageSize, sort, debouncedQ, status, typeId, longStay, stats, toastError])

  useEffect(() => { void loadStats() }, [loadStats])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(1) }, [debouncedQ, status, typeId, longStay, sort])

  const refresh = useCallback(() => { void load(); void loadStats() }, [load, loadStats])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const allOnPage = rows.length > 0 && rows.every(r => selected.has(r.id))

  async function printSelected() {
    const items = rows.filter(r => selected.has(r.id)).map(r => ({ number: r.number, qrToken: r.qrToken, typeName: r.type.name }))
    if (items.length === 0) return
    const settings = await apiRequest<{ companyDisplayName?: string; tenantName?: string }>('/api/settings')
    const company = settings.ok ? (settings.data.companyDisplayName || settings.data.tenantName || '') : ''
    try { await printQrLabels(items, company) } catch (err) { toastError(err instanceof Error ? err.message : 'Impression impossible') }
  }

  const kpis = useMemo(() => stats ? [
    { label: 'Disponibles', value: stats.byStatus.AVAILABLE ?? 0, hint: `sur ${stats.total} bennes` },
    { label: 'Chez les clients', value: (stats.byStatus.AT_CUSTOMER ?? 0) + (stats.byStatus.FULL ?? 0) + (stats.byStatus.TO_COLLECT ?? 0), hint: stats.avgDaysOnSite !== null ? `${stats.avgDaysOnSite} j en moyenne` : '—' },
    { label: `Plus de ${stats.longStay.days} jours sur site`, value: stats.longStay.count, hint: 'à relancer ou facturer', alert: stats.longStay.count > 0, action: () => { setLongStay(true); setView('list') } },
    { label: 'Hors service', value: stats.immobilized, hint: 'maintenance, immobilisées, perdues', alert: stats.immobilized > 0, action: () => { setStatus('MAINTENANCE,IMMOBILIZED,LOST'); setView('list') } },
    { label: 'Taux d\'utilisation', value: stats.utilisationPct !== null ? `${stats.utilisationPct} %` : '—', hint: 'réservées, en transport ou chez client' },
    { label: `Rotations (${stats.rotations.windowDays} j)`, value: stats.rotations.perContainer ?? '—', hint: `par benne · ${stats.rotations.total} au total` },
  ] : [], [stats])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-surface-200 px-4 py-3">
        <h1 className="font-display text-lg font-semibold text-surface-900">Parc de bennes</h1>
        <div role="tablist" aria-label="Affichage" className="flex rounded-lg bg-surface-100 p-0.5 text-sm">
          {([['list', 'Liste'], ['map', 'Carte'], ['insights', 'Analyse']] as const).map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 ${view === v ? 'bg-white font-medium text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-800'}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && <Btn onClick={() => void printSelected()} variant="ghost" size="sm">Imprimer {selected.size} étiquette{selected.size > 1 ? 's' : ''} QR</Btn>}
          {canManage && <Btn onClick={() => setModal('types')} variant="ghost" size="sm">Types de bennes</Btn>}
          {canManage && <Btn onClick={() => setModal('add')} size="sm">Ajouter des bennes</Btn>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {stats && stats.total === 0 && !loading ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <h2 className="font-display text-xl font-semibold text-surface-900">Votre parc est vide</h2>
            <p className="mt-2 text-sm text-surface-600">
              Créez vos types de bennes (15 m³, 30 m³…), puis ajoutez vos bennes par lot : chacune reçoit un numéro et un QR code à imprimer.
              Leur position suivra ensuite les poses et retraits faits par les chauffeurs.
            </p>
            {canManage && (
              <div className="mt-6 flex justify-center gap-2">
                <Btn onClick={() => setModal('types')} variant="ghost">Créer les types</Btn>
                <Btn onClick={() => setModal('add')}>Ajouter des bennes</Btn>
              </div>
            )}
          </div>
        ) : (
          <>
            {stats && (
              <section className="grid gap-6 border-b border-surface-200 px-4 py-4 lg:grid-cols-[1.4fr_1fr]">
                <FleetBars types={stats.byType} activeTypeId={typeId} onPickType={setTypeId} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                  {kpis.map(k => {
                    const body = (
                      <>
                        <dt className="text-xs text-surface-500">{k.label}</dt>
                        <dd className={`font-display text-xl font-semibold tabular-nums ${k.alert ? 'text-amber-700' : 'text-surface-900'}`}>{k.value}</dd>
                        <dd className="text-[11px] text-surface-400">{k.hint}</dd>
                      </>
                    )
                    return k.action
                      ? <button key={k.label} type="button" onClick={k.action} className="rounded-lg text-left hover:bg-surface-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"><div>{body}</div></button>
                      : <div key={k.label}>{body}</div>
                  })}
                </dl>
              </section>
            )}

            {view !== 'insights' && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <label className="sr-only" htmlFor="container-search">Rechercher</label>
                <input id="container-search" value={q} onChange={e => setQ(e.target.value)} placeholder="N° de benne, client, site…"
                  className="w-64 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                <label className="sr-only" htmlFor="container-status">Statut</label>
                <select id="container-status" value={status} onChange={e => setStatus(e.target.value)}
                  className="rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm">
                  <option value="">Tous les statuts</option>
                  {CONTAINER_STATUSES.filter(s => s !== 'ARCHIVED').map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  <option value="MAINTENANCE,IMMOBILIZED,LOST">Hors service</option>
                  <option value="ARCHIVED">Archivées</option>
                </select>
                <label className="inline-flex items-center gap-2 text-sm text-surface-700">
                  <input type="checkbox" checked={longStay} onChange={e => setLongStay(e.target.checked)} />
                  Chez client depuis plus de {stats?.longStay.days ?? 30} jours
                </label>
                <label className="sr-only" htmlFor="container-sort">Trier</label>
                <select id="container-sort" value={sort} onChange={e => setSort(e.target.value)} className="ml-auto rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm">
                  {SORTS.map(s => <option key={s.value} value={s.value}>Tri : {s.label}</option>)}
                </select>
                {(typeId || status || longStay || q) && (
                  <button type="button" onClick={() => { setTypeId(''); setStatus(''); setLongStay(false); setQ('') }} className="text-sm text-brand-600 hover:underline">Effacer les filtres</button>
                )}
              </div>
            )}

            {view === 'list' && (
              <div className="px-4 pb-6">
                <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
                  <table className="w-full min-w-[760px] text-sm">
                    <caption className="sr-only">Bennes du parc</caption>
                    <thead className="bg-surface-50 text-left text-xs text-surface-500">
                      <tr>
                        <th scope="col" className="w-10 px-3 py-2">
                          <input type="checkbox" aria-label="Tout sélectionner sur cette page" checked={allOnPage}
                            onChange={e => setSelected(prev => { const n = new Set(prev); for (const r of rows) { if (e.target.checked) n.add(r.id); else n.delete(r.id) } return n })} />
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">N°</th>
                        <th scope="col" className="px-3 py-2 font-medium">Type</th>
                        <th scope="col" className="px-3 py-2 font-medium">Statut</th>
                        <th scope="col" className="px-3 py-2 font-medium">Où</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Jours sur site</th>
                        <th scope="col" className="px-3 py-2 font-medium">Dernière rotation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100 bg-white">
                      {rows.map(r => (
                        <tr key={r.id} className={`cursor-pointer hover:bg-surface-50 ${detailId === r.id ? 'bg-brand-50/60' : ''}`} onClick={() => setDetailId(r.id)}>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" aria-label={`Sélectionner ${r.number}`} checked={selected.has(r.id)}
                              onChange={e => setSelected(prev => { const n = new Set(prev); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })} />
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => setDetailId(r.id)} className="font-display font-semibold text-surface-900 hover:underline">{r.number}</button>
                          </td>
                          <td className="px-3 py-2 text-surface-600">{r.type.name}</td>
                          <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ${STATUS_TONE[r.status].chip}`}>{STATUS_LABEL[r.status]}</span></td>
                          <td className="max-w-[18rem] truncate px-3 py-2 text-surface-700" title={r.site?.address}>{whereLabel(r)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${r.daysOnSite !== null && r.daysOnSite >= (stats?.longStay.days ?? 30) ? 'font-semibold text-amber-700' : 'text-surface-700'}`}>{r.daysOnSite ?? '—'}</td>
                          <td className="px-3 py-2 tabular-nums text-surface-600">{frDate(r.lastRotationAt)}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && !loading && (
                        <tr><td colSpan={7} className="px-3 py-10 text-center text-surface-500">Aucune benne ne correspond à ces filtres.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-surface-500">
                  <span aria-live="polite">{loading ? 'Chargement…' : `${total} benne${total > 1 ? 's' : ''}`}</span>
                  {pages > 1 && (
                    <span className="flex items-center gap-2">
                      <Btn onClick={() => setPage(p => Math.max(1, p - 1))} variant="ghost" size="xs" disabled={page <= 1}>Précédent</Btn>
                      <span className="tabular-nums">{page} / {pages}</span>
                      <Btn onClick={() => setPage(p => Math.min(pages, p + 1))} variant="ghost" size="xs" disabled={page >= pages}>Suivant</Btn>
                    </span>
                  )}
                </div>
              </div>
            )}

            {view === 'map' && (
              <div className="h-[60vh] px-4 pb-6">
                <ContainersMap rows={rows} onSelect={setDetailId} />
                <p className="mt-2 text-xs text-surface-500">
                  {rows.filter(r => r.latitude !== null).length} bennes localisées sur {rows.length} affichées (les {pageSize} premières du filtre).
                </p>
              </div>
            )}

            {view === 'insights' && stats && (
              <div className="grid gap-6 px-4 py-4 lg:grid-cols-2">
                <section aria-labelledby="top-clients">
                  <h2 id="top-clients" className="font-display text-base font-semibold text-surface-900">Clients qui immobilisent le plus de matériel</h2>
                  <p className="mt-0.5 text-xs text-surface-500">Bennes posées aujourd&apos;hui × jours sur site{stats.topClients.some(c => c.rentEstimate > 0) ? ' — location estimée au tarif journalier du type' : ''}.</p>
                  <table className="mt-3 w-full text-sm">
                    <thead className="text-left text-xs text-surface-500"><tr><th className="py-1 font-medium">Client</th><th className="text-right font-medium">Bennes</th><th className="text-right font-medium">Jours cumulés</th><th className="text-right font-medium">Location estimée</th></tr></thead>
                    <tbody className="divide-y divide-surface-100">
                      {stats.topClients.map(c => (
                        <tr key={c.clientId}>
                          <td className="py-1.5"><button type="button" className="text-surface-800 hover:underline" onClick={() => { setQ(c.name); setView('list') }}>{c.name}</button></td>
                          <td className="text-right tabular-nums">{c.containers}</td>
                          <td className="text-right tabular-nums">{c.days}</td>
                          <td className="text-right tabular-nums">{c.rentEstimate > 0 ? `${c.rentEstimate.toLocaleString('fr-FR')} €` : '—'}</td>
                        </tr>
                      ))}
                      {stats.topClients.length === 0 && <tr><td colSpan={4} className="py-3 text-surface-500">Aucune benne chez un client.</td></tr>}
                    </tbody>
                  </table>
                </section>
                <section aria-labelledby="least-rotated">
                  <h2 id="least-rotated" className="font-display text-base font-semibold text-surface-900">Bennes qui tournent le moins</h2>
                  <p className="mt-0.5 text-xs text-surface-500">Vidages à l&apos;exutoire sur {stats.rotations.windowDays} jours.</p>
                  <table className="mt-3 w-full text-sm">
                    <thead className="text-left text-xs text-surface-500"><tr><th className="py-1 font-medium">Benne</th><th className="font-medium">Type</th><th className="font-medium">Statut</th><th className="text-right font-medium">Rotations</th><th className="text-right font-medium">Dernière</th></tr></thead>
                    <tbody className="divide-y divide-surface-100">
                      {stats.leastRotated.map(c => (
                        <tr key={c.id}>
                          <td className="py-1.5"><button type="button" className="font-display font-semibold hover:underline" onClick={() => setDetailId(c.id)}>{c.number}</button></td>
                          <td className="text-surface-600">{c.type}</td>
                          <td><span className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ${STATUS_TONE[c.status].chip}`}>{STATUS_LABEL[c.status]}</span></td>
                          <td className="text-right tabular-nums">{c.rotations}</td>
                          <td className="text-right tabular-nums text-surface-600">{frDate(c.lastRotationAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            )}
          </>
        )}
      </div>

      {detailId && <ContainerDetail id={detailId} canManage={canManage} onClose={() => setDetailId(null)} onChanged={refresh} />}
      {modal === 'add' && <AddContainersModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh() }} />}
      {modal === 'types' && <ContainerTypesModal onClose={() => { setModal(null); refresh() }} />}
    </div>
  )
}
