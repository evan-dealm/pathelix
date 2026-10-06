'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { useCommercialCatalog } from './useCatalog'
import { CONTRACT_STATUS, Empty, SidePanel, StatusChip, frDay, inputCls, todayIso } from './shared'

interface Contract {
  id: string; number: string; status: string; title: string; startDate: string; endDate: string | null; renewal: string
  noticeDays: number; billingFrequency: string; rentalFreeDays: number; paymentTermsDays: number; notes: string
  client: { id: string; name: string }; priceList: { id: string; name: string } | null; priceListId?: string | null
}

const blank = { clientId: '', title: '', startDate: todayIso(), endDate: '', renewal: 'NONE', noticeDays: '30', billingFrequency: 'MONTHLY', rentalFreeDays: '0', paymentTermsDays: '30', priceListId: '', status: 'ACTIVE', notes: '' }

/** Framework agreements: dates, renewal, billing rhythm, rental franchise, payment terms, price grid. */
export function ContractsView({ clientId }: { clientId?: string }) {
  const cat = useCommercialCatalog()
  const [rows, setRows] = useState<Contract[]>([])
  const [lists, setLists] = useState<Array<{ id: string; name: string }>>([])
  const [edit, setEdit] = useState<Contract | 'new' | null>(null)
  const [form, setForm] = useState({ ...blank, clientId: clientId ?? '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([
      apiRequest<{ data: Contract[] }>(`/api/contracts?limit=100${clientId ? `&clientId=${clientId}` : ''}`),
      apiRequest<{ data: Array<{ id: string; name: string }> }>('/api/price-lists'),
    ])
    if (c.ok) setRows(c.data.data)
    if (l.ok) setLists(l.data.data)
  }, [clientId])
  useEffect(() => { void load() }, [load])

  function openEdit(c: Contract | 'new') {
    setError('')
    setEdit(c)
    setForm(c === 'new' ? { ...blank, clientId: clientId ?? '' } : {
      clientId: c.client.id, title: c.title, startDate: c.startDate, endDate: c.endDate ?? '', renewal: c.renewal, noticeDays: String(c.noticeDays),
      billingFrequency: c.billingFrequency, rentalFreeDays: String(c.rentalFreeDays), paymentTermsDays: String(c.paymentTermsDays), priceListId: c.priceList?.id ?? '', status: c.status, notes: c.notes,
    })
  }

  async function save() {
    setError('')
    const json = {
      title: form.title, startDate: form.startDate, endDate: form.endDate || null, renewal: form.renewal, noticeDays: Number(form.noticeDays) || 0,
      billingFrequency: form.billingFrequency, rentalFreeDays: Number(form.rentalFreeDays) || 0, paymentTermsDays: Number(form.paymentTermsDays) || 0,
      priceListId: form.priceListId || null, status: form.status, notes: form.notes,
    }
    const r = edit === 'new'
      ? await apiRequest('/api/contracts', { method: 'POST', json: { ...json, clientId: form.clientId } })
      : await apiRequest(`/api/contracts/${(edit as Contract).id}`, { method: 'PUT', json })
    if (!r.ok) { setError(r.error); return }
    setEdit(null); void load()
  }

  const F = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value })) })
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Btn onClick={() => openEdit('new')} size="sm">Nouveau contrat</Btn></div>
      {rows.length === 0 ? <Empty title="Aucun contrat">Un contrat fixe la grille tarifaire, la franchise de location, le rythme de facturation et les délais de paiement d&apos;un client.</Empty> : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500"><tr><th className="px-3 py-2 font-medium">N°</th><th className="px-3 py-2 font-medium">Client</th><th className="px-3 py-2 font-medium">Statut</th><th className="px-3 py-2 font-medium">Période</th><th className="px-3 py-2 font-medium">Grille</th></tr></thead>
            <tbody className="divide-y divide-surface-100 bg-white">
              {rows.map(c => (
                <tr key={c.id} className="cursor-pointer hover:bg-surface-50" onClick={() => openEdit(c)}>
                  <td className="px-3 py-2 font-medium">{c.number}<div className="text-xs font-normal text-surface-500">{c.title}</div></td>
                  <td className="px-3 py-2">{c.client.name}</td>
                  <td className="px-3 py-2"><StatusChip map={CONTRACT_STATUS} status={c.status} /></td>
                  <td className="px-3 py-2 tabular-nums text-surface-600">{frDay(c.startDate)} → {c.endDate ? frDay(c.endDate) : 'sans fin'}{c.renewal === 'TACIT' ? ' (reconduction tacite)' : ''}</td>
                  <td className="px-3 py-2 text-surface-600">{c.priceList?.name ?? 'Grille par défaut'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <SidePanel onClose={() => setEdit(null)} title={edit === 'new' ? 'Nouveau contrat' : `Contrat ${edit.number}`}>
          <div className="grid gap-3 md:grid-cols-2">
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2">{error}</p>}
            <label className="text-xs text-surface-600 md:col-span-2">Client<select className={inputCls} {...F('clientId')} disabled={edit !== 'new'}><option value="">Choisir…</option>{cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-xs text-surface-600 md:col-span-2">Objet<input className={inputCls} {...F('title')} placeholder="Location et rotations — chantier Europole" /></label>
            <label className="text-xs text-surface-600">Début<input type="date" className={inputCls} {...F('startDate')} /></label>
            <label className="text-xs text-surface-600">Fin<input type="date" className={inputCls} {...F('endDate')} /></label>
            <label className="text-xs text-surface-600">Reconduction<select className={inputCls} {...F('renewal')}><option value="NONE">Aucune</option><option value="TACIT">Tacite</option></select></label>
            <label className="text-xs text-surface-600">Préavis (jours)<input className={inputCls} inputMode="numeric" {...F('noticeDays')} /></label>
            <label className="text-xs text-surface-600">Facturation<select className={inputCls} {...F('billingFrequency')}><option value="MONTHLY">Mensuelle</option><option value="PER_OPERATION">À chaque intervention</option></select></label>
            <label className="text-xs text-surface-600">Jours de location offerts<input className={inputCls} inputMode="numeric" {...F('rentalFreeDays')} /></label>
            <label className="text-xs text-surface-600">Délai de paiement (jours)<input className={inputCls} inputMode="numeric" {...F('paymentTermsDays')} /></label>
            <label className="text-xs text-surface-600">Grille tarifaire<select className={inputCls} {...F('priceListId')}><option value="">Grille par défaut / du client</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="text-xs text-surface-600">Statut<select className={inputCls} {...F('status')}>{Object.entries(CONTRACT_STATUS).map(([k, [lab]]) => <option key={k} value={k}>{lab}</option>)}</select></label>
            <label className="text-xs text-surface-600 md:col-span-2">Notes<textarea rows={3} className={inputCls} {...F('notes')} /></label>
            <div className="flex justify-end md:col-span-2"><Btn onClick={() => void save()} disabled={!form.clientId || !form.startDate}>Enregistrer</Btn></div>
          </div>
        </SidePanel>
      )}
    </div>
  )
}
