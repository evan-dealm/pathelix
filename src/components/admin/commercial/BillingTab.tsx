'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { useToast } from '@/components/ui/Toast'
import { InvoicesView } from './InvoicesView'
import { useCommercialCatalog } from './useCatalog'
import { Empty, SubTabs, eur, frDay, inputCls, todayIso } from './shared'

type View = 'invoices' | 'payments' | 'weighings' | 'export'

/** Billing: invoices and credit notes, payments to match, weighing tickets to check, accounting export. */
export function BillingTab() {
  const [view, setView] = useState<View>('invoices')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-surface-200 px-4 py-3">
        <h1 className="font-display text-lg font-semibold text-surface-900">Facturation</h1>
        <SubTabs label="Facturation" value={view} onChange={setView} tabs={[['invoices', 'Factures'], ['payments', 'Règlements'], ['weighings', 'Pesées à vérifier'], ['export', 'Export comptable']]} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {view === 'invoices' && <InvoicesView />}
        {view === 'payments' && <PaymentsView />}
        {view === 'weighings' && <WeighingsReview />}
        {view === 'export' && <ExportView />}
      </div>
    </div>
  )
}

interface PaymentRow { id: string; amount: number; receivedAt: string; method: string; reference: string; client: { id: string; name: string }; invoice: { id: string; number: string | null } | null }

function PaymentsView() {
  const cat = useCommercialCatalog()
  const { success, error: toastError } = useToast()
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [unallocated, setUnallocated] = useState(false)
  const [form, setForm] = useState({ clientId: '', amount: '', receivedAt: todayIso(), method: 'TRANSFER', reference: '' })
  const [openInvoices, setOpenInvoices] = useState<Record<string, Array<{ id: string; number: string | null; balance: number }>>>({})

  const load = useCallback(async () => {
    const r = await apiRequest<{ data: PaymentRow[] }>(`/api/payments?limit=100${unallocated ? '&unallocated=1' : ''}`)
    if (r.ok) setRows(r.data.data); else toastError(r.error)
  }, [unallocated, toastError])
  useEffect(() => { void load() }, [load])

  async function invoicesOf(clientId: string) {
    if (openInvoices[clientId]) return
    const r = await apiRequest<{ data: Array<{ id: string; number: string | null; balance: number }> }>(`/api/invoices?status=UNPAID&clientId=${clientId}&limit=100`)
    if (r.ok) setOpenInvoices(o => ({ ...o, [clientId]: r.data.data }))
  }
  async function record() {
    const r = await apiRequest('/api/payments', { method: 'POST', json: { ...form, amount: Number(form.amount.replace(',', '.')) } })
    if (!r.ok) { toastError(r.error); return }
    success('Règlement enregistré — à rapprocher d\'une facture')
    setForm(f => ({ ...f, amount: '', reference: '' })); void load()
  }
  async function allocate(p: PaymentRow, invoiceId: string) {
    const r = await apiRequest(`/api/payments/${p.id}`, { method: 'PUT', json: { invoiceId: invoiceId || null } })
    if (!r.ok) { toastError(r.error); return }
    success('Règlement rapproché'); void load()
  }

  return (
    <div className="space-y-4">
      <section aria-labelledby="new-payment" className="grid grid-cols-2 items-end gap-2 rounded-xl bg-surface-50 p-4 md:grid-cols-6">
        <h2 id="new-payment" className="col-span-2 text-sm font-medium text-surface-800 md:col-span-6">Règlement reçu (sans facture précise)</h2>
        <label className="text-xs text-surface-600 md:col-span-2">Client<select className={inputCls} value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}><option value="">Choisir…</option>{cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-xs text-surface-600">Montant<input className={inputCls} inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></label>
        <label className="text-xs text-surface-600">Reçu le<input type="date" className={inputCls} value={form.receivedAt} onChange={e => setForm(f => ({ ...f, receivedAt: e.target.value }))} /></label>
        <label className="text-xs text-surface-600">Référence<input className={inputCls} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></label>
        <Btn onClick={() => void record()} size="sm" disabled={!form.clientId || !(Number(form.amount.replace(',', '.')) > 0)}>Enregistrer</Btn>
      </section>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={unallocated} onChange={e => setUnallocated(e.target.checked)} />Seulement ceux à rapprocher</label>
      {rows.length === 0 ? <Empty title="Aucun règlement" /> : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500"><tr><th className="px-3 py-2 font-medium">Reçu le</th><th className="px-3 py-2 font-medium">Client</th><th className="px-3 py-2 font-medium">Référence</th><th className="px-3 py-2 text-right font-medium">Montant</th><th className="px-3 py-2 font-medium">Facture</th></tr></thead>
            <tbody className="divide-y divide-surface-100 bg-white">
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="px-3 py-2 tabular-nums">{frDay(p.receivedAt)}</td>
                  <td className="px-3 py-2">{p.client.name}</td>
                  <td className="px-3 py-2 text-surface-600">{p.reference || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(p.amount)}</td>
                  <td className="px-3 py-2">{p.invoice ? p.invoice.number : (
                    <select aria-label={`Rapprocher le règlement de ${eur(p.amount)}`} className={inputCls} defaultValue="" onFocus={() => void invoicesOf(p.client.id)} onChange={e => void allocate(p, e.target.value)}>
                      <option value="">À rapprocher…</option>
                      {(openInvoices[p.client.id] ?? []).map(i => <option key={i.id} value={i.id}>{i.number} — reste {eur(i.balance)}</option>)}
                    </select>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface WeighingRow { id: string; netKg: number; grossKg: number | null; tareKg: number | null; ticketNumber: string; source: string; status: string; weighedAt: string; missionId: string | null; notes: string; documentId: string | null }

/** OCR readings (and other tickets awaiting a check): a person confirms or corrects before use. */
function WeighingsReview() {
  const { success, error: toastError } = useToast()
  const [rows, setRows] = useState<WeighingRow[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const r = await apiRequest<{ data: WeighingRow[] }>('/api/weighings?status=PENDING_REVIEW&limit=100')
    if (r.ok) setRows(r.data.data); else toastError(r.error)
  }, [toastError])
  useEffect(() => { void load() }, [load])
  async function decide(w: WeighingRow, status: 'VALIDATED' | 'REJECTED') {
    const net = edits[w.id] !== undefined ? Number(edits[w.id].replace(',', '.')) : w.netKg
    const r = await apiRequest(`/api/weighings/${w.id}`, { method: 'PUT', json: { status, ...(status === 'VALIDATED' ? { netKg: net } : {}) } })
    if (!r.ok) { toastError(r.error); return }
    success(status === 'VALIDATED' ? 'Pesée validée' : 'Pesée rejetée'); void load()
  }
  if (rows.length === 0) return <Empty title="Aucune pesée à vérifier">Les tickets lus automatiquement (OCR) attendent ici une confirmation avant d&apos;être facturés ou reportés sur un bordereau.</Empty>
  return (
    <ul className="divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200">
      {rows.map(w => (
        <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="min-w-[10rem]">{new Date(w.weighedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}<span className="block text-xs text-surface-500">{w.source === 'OCR' ? 'Lecture automatique du ticket' : w.source}{w.ticketNumber ? ` · ticket ${w.ticketNumber}` : ''}</span>{w.notes && <span className="block text-xs text-amber-700">{w.notes}</span>}{w.documentId && <a className="text-xs text-brand-600 hover:underline" href={`/api/documents/${w.documentId}`} target="_blank" rel="noopener noreferrer">Voir la photo du ticket</a>}</span>
          <label className="text-xs text-surface-600">Poids net (kg)<input className={`${inputCls} w-28`} inputMode="decimal" value={edits[w.id] ?? String(w.netKg)} onChange={e => setEdits(x => ({ ...x, [w.id]: e.target.value }))} /></label>
          <span className="ml-auto flex gap-2"><Btn onClick={() => void decide(w, 'REJECTED')} variant="ghost" size="sm">Rejeter</Btn><Btn onClick={() => void decide(w, 'VALIDATED')} size="sm">Valider</Btn></span>
        </li>
      ))}
    </ul>
  )
}

function ExportView() {
  const d = new Date()
  const firstPrev = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const lastPrev = new Date(d.getFullYear(), d.getMonth(), 0)
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const [from, setFrom] = useState(iso(firstPrev))
  const [to, setTo] = useState(iso(lastPrev))
  return (
    <section aria-labelledby="export-title" className="max-w-xl space-y-4">
      <h2 id="export-title" className="font-display text-base font-semibold text-surface-900">Export comptable</h2>
      <p className="text-sm text-surface-600">Factures et avoirs émis sur la période, en écritures équilibrées (clients 411, ventes 706, TVA collectée 44571) : le FEC réglementaire, ou un journal des ventes CSV importable dans Sage, Cegid, EBP…</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-surface-600">Du<input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs text-surface-600">Au<input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></label>
        <a className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600" href={`/api/invoices/export?format=csv&from=${from}&to=${to}`}>Journal des ventes (CSV)</a>
        <a className="rounded-lg bg-surface-50 px-3 py-1.5 text-xs font-medium text-surface-700 ring-1 ring-surface-200 hover:bg-surface-100" href={`/api/invoices/export?format=fec&from=${from}&to=${to}`}>FEC</a>
      </div>
    </section>
  )
}
