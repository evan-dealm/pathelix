'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { useDebounce } from '../hooks'
import { Btn } from '../ui'
import { useToast } from '@/components/ui/Toast'
import { LinesEditor, blankLine, type EditableLine } from './LinesEditor'
import { useCommercialCatalog } from './useCatalog'
import { Empty, INVOICE_STATUS, ORDER_STATUS, SidePanel, StatusChip, eur, frDay, inputCls, todayIso } from './shared'

interface OrderRow { id: string; number: string; status: string; kind: string; title: string; startDate: string; endDate: string | null; totalHT: number; client: { id: string; name: string }; progress: { done: number; total: number } }
interface OrderFull extends OrderRow {
  notes: string; lines: EditableLine[]; site: { name: string } | null; quote: { id: string; number: string } | null
  missions: Array<{ id: string; type: string; date: string; completedAt: string | null; archived: boolean }>
  invoices: Array<{ id: string; number: string | null; status: string; totalTTC: number }>
}

const KIND: Record<string, string> = { ONE_OFF: 'Ponctuelle', POSE_RETRAIT: 'Pose puis retrait', ROTATION: 'Rotations', RECURRING: 'Récurrente', LONG_RENTAL: 'Location longue durée' }
const TYPE: Record<string, string> = { POSER: 'Pose', RETIRER: 'Retrait', ECHANGER: 'Échange', ALLER_RETOUR: 'Rotation', CHARGER_IMMEDIAT: 'Chargement', DEPLACER: 'Déplacement', TASSER: 'Tassage', EXPEDIER: 'Expédition' }

export function OrdersView({ clientId, openId, onOpened }: { clientId?: string; openId?: string | null; onOpened?: () => void }) {
  const { error: toastError, success } = useToast()
  const [rows, setRows] = useState<OrderRow[]>([])
  const [q, setQ] = useState('')
  const dq = useDebounce(q, 250)
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState<string | 'new' | null>(openId ?? null)
  useEffect(() => { if (openId) { setOpen(openId); onOpened?.() } }, [openId, onOpened])

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ limit: '100' })
    if (dq) sp.set('q', dq)
    if (status) sp.set('status', status)
    if (clientId) sp.set('clientId', clientId)
    const r = await apiRequest<{ data: OrderRow[] }>(`/api/orders?${sp}`)
    if (r.ok) setRows(r.data.data); else toastError(r.error)
  }, [dq, status, clientId, toastError])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Rechercher une commande" value={q} onChange={e => setQ(e.target.value)} placeholder="N°, objet, client…" className={`${inputCls} w-60`} />
        <select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value)} className={`${inputCls} w-44`}>
          <option value="">Tous les statuts</option>
          {Object.entries(ORDER_STATUS).map(([k, [lab]]) => <option key={k} value={k}>{lab}</option>)}
        </select>
        <div className="ml-auto"><Btn onClick={() => setOpen('new')} size="sm">Nouvelle commande</Btn></div>
      </div>
      {rows.length === 0 ? (
        <Empty title="Aucune commande">Une commande naît d&apos;un devis accepté ou se saisit directement (appel d&apos;un client) ; elle crée ses interventions.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500">
              <tr><th className="px-3 py-2 font-medium">N°</th><th className="px-3 py-2 font-medium">Client</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Statut</th><th className="px-3 py-2 font-medium">Interventions</th><th className="px-3 py-2 text-right font-medium">Total HT</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-100 bg-white">
              {rows.map(r => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-50" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-2"><button type="button" className="font-medium hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button><div className="text-xs text-surface-500">{frDay(r.startDate)}</div></td>
                  <td className="px-3 py-2">{r.client.name}</td>
                  <td className="px-3 py-2 text-surface-600">{KIND[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2"><StatusChip map={ORDER_STATUS} status={r.status} /></td>
                  <td className="px-3 py-2 tabular-nums text-surface-600">{r.progress.total === 0 ? '—' : `${r.progress.done} / ${r.progress.total} réalisées`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.totalHT)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open === 'new' && <NewOrder defaultClientId={clientId} onClose={() => setOpen(null)} onCreated={(id, n) => { success(`Commande ${n} créée`); void load(); setOpen(id) }} />}
      {open && open !== 'new' && <OrderDetail id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </div>
  )
}

function OrderDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { success } = useToast()
  const [o, setO] = useState<OrderFull | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const r = await apiRequest<OrderFull>(`/api/orders/${id}`)
    if (r.ok) setO(r.data); else setError(r.error)
  }, [id])
  useEffect(() => { void load() }, [load])

  async function createMissions() {
    const r = await apiRequest<{ created: number }>(`/api/orders/${id}/missions`, { method: 'POST' })
    if (!r.ok) { setError(r.error); return }
    success(r.data.created > 0 ? `${r.data.created} intervention(s) créée(s)` : 'Toutes les interventions existent déjà')
    void load(); onChanged()
  }
  async function cancel() {
    if (!window.confirm('Annuler la commande ? Ses interventions non réalisées seront annulées et les bennes réservées libérées.')) return
    const r = await apiRequest(`/api/orders/${id}`, { method: 'PUT', json: { status: 'CANCELLED' } })
    if (!r.ok) { setError(r.error); return }
    void load(); onChanged()
  }

  return (
    <SidePanel wide onClose={onClose} title={o ? `Commande ${o.number}` : 'Commande'}
      subtitle={o ? <span className="inline-flex items-center gap-2"><StatusChip map={ORDER_STATUS} status={o.status} />{o.client.name}{o.site ? ` · ${o.site.name}` : ''}</span> : undefined}
      actions={o && o.status !== 'CANCELLED' ? <>
        <Btn onClick={() => void createMissions()} size="sm">Créer les interventions manquantes</Btn>
        {o.status !== 'COMPLETED' && <Btn onClick={() => void cancel()} variant="danger" size="sm">Annuler la commande</Btn>}
      </> : undefined}>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {o && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-surface-500">Type</dt><dd>{KIND[o.kind] ?? o.kind}</dd></div>
            <div><dt className="text-xs text-surface-500">Début</dt><dd>{frDay(o.startDate)}</dd></div>
            <div><dt className="text-xs text-surface-500">Fin</dt><dd>{frDay(o.endDate)}</dd></div>
            <div><dt className="text-xs text-surface-500">Devis</dt><dd>{o.quote?.number ?? '—'}</dd></div>
          </dl>
          <section aria-labelledby="order-missions">
            <h3 id="order-missions" className="text-sm font-medium text-surface-800">Interventions ({o.progress.done}/{o.progress.total} réalisées)</h3>
            <ul className="mt-2 divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200">
              {o.missions.map(m => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{TYPE[m.type] ?? m.type} — {frDay(m.date)}</span>
                  <span className={m.completedAt ? 'text-emerald-700' : m.archived ? 'text-surface-400' : 'text-surface-600'}>{m.completedAt ? 'Réalisée' : m.archived ? 'Annulée' : 'À planifier / planifiée'}</span>
                </li>
              ))}
              {o.missions.length === 0 && <li className="px-3 py-3 text-sm text-surface-500">Aucune intervention : liez des lignes à une intervention puis créez-les.</li>}
            </ul>
          </section>
          <LinesEditor lines={o.lines} readOnly />
          {o.invoices.length > 0 && (
            <section aria-labelledby="order-invoices">
              <h3 id="order-invoices" className="text-sm font-medium text-surface-800">Factures</h3>
              <ul className="mt-2 space-y-1 text-sm">{o.invoices.map(i => <li key={i.id} className="flex items-center gap-2">{i.number ?? 'Brouillon'} <StatusChip map={INVOICE_STATUS} status={i.status} /> {eur(i.totalTTC)}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </SidePanel>
  )
}

function NewOrder({ defaultClientId, onClose, onCreated }: { defaultClientId?: string; onClose: () => void; onCreated: (_id: string, _n: string) => void }) {
  const cat = useCommercialCatalog()
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [siteId, setSiteId] = useState('')
  const [kind, setKind] = useState('ONE_OFF')
  const [startDate, setStartDate] = useState(todayIso())
  const [endDate, setEndDate] = useState('')
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<EditableLine[]>([{ ...blankLine(), missionType: 'POSER' }])
  const [error, setError] = useState('')
  const sites = cat.clients.find(c => c.id === clientId)?.clientSites?.map(cs => cs.site) ?? []

  async function create() {
    setError('')
    const r = await apiRequest<{ id: string; number: string }>('/api/orders', { method: 'POST', json: {
      clientId, siteId: siteId || null, kind, title, startDate, endDate: endDate || null, createMissions: true,
      lines: lines.filter(l => l.label.trim()).map(l => ({ ...l, missionType: l.missionType || null })),
    } })
    if (!r.ok) { setError(r.error); return }
    onCreated(r.data.id, r.data.number)
  }

  return (
    <SidePanel wide onClose={onClose} title="Nouvelle commande" subtitle="Les lignes liées à une intervention créent les missions à planifier.">
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-surface-600">Client<select className={inputCls} value={clientId} onChange={e => { setClientId(e.target.value); setSiteId('') }}><option value="">Choisir…</option>{cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="text-xs text-surface-600">Site<select className={inputCls} value={siteId} onChange={e => setSiteId(e.target.value)}><option value="">{sites.length ? 'Choisir…' : 'Aucun site'}</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="text-xs text-surface-600">Type<select className={inputCls} value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(KIND).filter(([k]) => k !== 'RECURRING').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-surface-600">Début<input type="date" className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label className="text-xs text-surface-600">Fin (retrait prévu)<input type="date" className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
          <label className="text-xs text-surface-600">Objet<input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} /></label>
        </div>
        <LinesEditor lines={lines} onChange={setLines} operations containerTypes={cat.containerTypes} materials={cat.materials} />
        <div className="flex justify-end"><Btn onClick={() => void create()} disabled={!clientId || !startDate}>Créer la commande</Btn></div>
      </div>
    </SidePanel>
  )
}
