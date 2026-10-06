'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { useDebounce } from '../hooks'
import { Btn } from '../ui'
import { useToast } from '@/components/ui/Toast'
import { LinesEditor, blankLine, type EditableLine } from './LinesEditor'
import { useCommercialCatalog } from './useCatalog'
import { Empty, INVOICE_STATUS, SidePanel, StatusChip, downloadPdf, eur, frDay, inputCls, openPrintable, todayIso } from './shared'

interface InvoiceRow { id: string; number: string | null; kind: string; status: string; issueDate: string | null; dueDate: string | null; totalTTC: number; balance: number; client: { id: string; name: string } }
interface InvoiceFull extends InvoiceRow {
  notes: string; periodStart: string | null; periodEnd: string | null; amountPaid: number; totalHT: number
  lines: EditableLine[]; payments: Array<{ id: string; amount: number; receivedAt: string; method: string; reference: string }>
  creditNotes: Array<{ id: string; number: string | null; status: string; totalTTC: number }>; creditedInvoice: { id: string; number: string } | null
  client: { id: string; name: string; email?: string }
}

const METHODS: Array<[string, string]> = [['TRANSFER', 'Virement'], ['CHECK', 'Chèque'], ['CARD', 'Carte'], ['CASH', 'Espèces'], ['DIRECT_DEBIT', 'Prélèvement'], ['OTHER', 'Autre']]

function firstOfMonth(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export function InvoicesView({ clientId }: { clientId?: string }) {
  const { error: toastError, success } = useToast()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [summary, setSummary] = useState<{ outstanding: number; overdue: number } | null>(null)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounce(q, 250)
  const [open, setOpen] = useState<string | 'field' | 'manual' | null>(null)

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ limit: '100' })
    if (status) sp.set('status', status)
    if (dq) sp.set('q', dq)
    if (clientId) sp.set('clientId', clientId)
    const r = await apiRequest<{ data: InvoiceRow[]; summary: { outstanding: number; overdue: number } }>(`/api/invoices?${sp}`)
    if (r.ok) { setRows(r.data.data); setSummary(r.data.summary) } else toastError(r.error)
  }, [status, dq, clientId, toastError])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-3">
      {summary && !clientId && (
        <dl className="flex flex-wrap gap-8">
          <div><dt className="text-xs text-surface-500">À encaisser</dt><dd className="font-display text-xl font-semibold tabular-nums text-surface-900">{eur(summary.outstanding)}</dd></div>
          <div><dt className="text-xs text-surface-500">Dont en retard</dt><dd className={`font-display text-xl font-semibold tabular-nums ${summary.overdue > 0 ? 'text-red-600' : 'text-surface-900'}`}>{eur(summary.overdue)}</dd></div>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Rechercher une facture" value={q} onChange={e => setQ(e.target.value)} placeholder="N°, client…" className={`${inputCls} w-56`} />
        <select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value)} className={`${inputCls} w-48`}>
          <option value="">Toutes</option><option value="UNPAID">Non réglées</option>
          {Object.entries(INVOICE_STATUS).map(([k, [lab]]) => <option key={k} value={k}>{lab}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Btn onClick={() => setOpen('manual')} variant="ghost" size="sm">Facture manuelle</Btn>
          <Btn onClick={() => setOpen('field')} size="sm">Facturer les prestations</Btn>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="Aucune facture" action={<Btn onClick={() => setOpen('field')}>Facturer les prestations</Btn>}>
          Les interventions terminées, les jours de location et les pesées validées se facturent en un clic, au tarif du client, sans rien ressaisir.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500">
              <tr><th className="px-3 py-2 font-medium">N°</th><th className="px-3 py-2 font-medium">Client</th><th className="px-3 py-2 font-medium">Statut</th><th className="px-3 py-2 font-medium">Échéance</th><th className="px-3 py-2 text-right font-medium">TTC</th><th className="px-3 py-2 text-right font-medium">Reste dû</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-100 bg-white">
              {rows.map(r => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-50" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-2"><button type="button" className="font-medium hover:underline" onClick={() => setOpen(r.id)}>{r.number ?? 'Brouillon'}</button>{r.kind === 'CREDIT_NOTE' && <span className="ml-1 text-xs text-violet-700">avoir</span>}<div className="text-xs text-surface-500">{frDay(r.issueDate)}</div></td>
                  <td className="px-3 py-2">{r.client.name}</td>
                  <td className="px-3 py-2"><StatusChip map={INVOICE_STATUS} status={r.status} /></td>
                  <td className="px-3 py-2 tabular-nums text-surface-600">{frDay(r.dueDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.totalTTC)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.status === 'OVERDUE' ? 'font-semibold text-red-600' : ''}`}>{r.status === 'DRAFT' || r.status === 'CANCELLED' || r.kind === 'CREDIT_NOTE' ? '—' : eur(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open === 'field' && <BillFieldWork defaultClientId={clientId} onClose={() => setOpen(null)} onCreated={id => { success('Brouillon de facture créé'); void load(); setOpen(id) }} />}
      {open === 'manual' && <ManualInvoice defaultClientId={clientId} onClose={() => setOpen(null)} onCreated={id => { void load(); setOpen(id) }} />}
      {open && open !== 'field' && open !== 'manual' && <InvoiceDetail id={open} onClose={() => setOpen(null)} onChanged={() => void load()} onOpen={setOpen} />}
    </div>
  )
}

/** Field work → invoice: customer and period, what is billable (explained), then the draft. */
function BillFieldWork({ defaultClientId, onClose, onCreated }: { defaultClientId?: string; onClose: () => void; onCreated: (_id: string) => void }) {
  const cat = useCommercialCatalog()
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [periodStart, setStart] = useState(firstOfMonth())
  const [periodEnd, setEnd] = useState(todayIso())
  const [preview, setPreview] = useState<{ lines: Array<EditableLine & { code: string }>; warnings: string[]; totals: { totalHT: number; totalTTC: number } } | null>(null)
  const [error, setError] = useState('')

  async function compute() {
    setError(''); setPreview(null)
    const r = await apiRequest<NonNullable<typeof preview>>('/api/invoices/preview', { method: 'POST', json: { clientId, periodStart, periodEnd } })
    if (!r.ok) { setError(r.error); return }
    setPreview(r.data)
  }
  async function create() {
    const r = await apiRequest<{ invoice: { id: string } }>('/api/invoices', { method: 'POST', json: { clientId, periodStart, periodEnd, fromFieldData: true } })
    if (!r.ok) { setError(r.error); return }
    onCreated(r.data.invoice.id)
  }
  return (
    <SidePanel wide onClose={onClose} title="Facturer les prestations" subtitle="Interventions terminées, location des bennes et pesées validées non encore facturées.">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-surface-600 md:col-span-2">Client<select className={inputCls} value={clientId} onChange={e => { setClientId(e.target.value); setPreview(null) }}><option value="">Choisir…</option>{cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="text-xs text-surface-600">Du<input type="date" className={inputCls} value={periodStart} onChange={e => setStart(e.target.value)} /></label>
          <label className="text-xs text-surface-600">Au<input type="date" className={inputCls} value={periodEnd} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        <Btn onClick={() => void compute()} variant="ghost" size="sm" disabled={!clientId}>Voir ce qui est à facturer</Btn>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {preview && (preview.lines.length === 0
          ? <p className="text-sm text-surface-600">Rien à facturer sur cette période : aucune prestation terminée, location ou pesée validée non facturée.</p>
          : <>
            <LinesEditor lines={preview.lines} readOnly />
            {preview.warnings.map(w => <p key={w} className="text-sm text-amber-700">{w}</p>)}
            <div className="flex justify-end"><Btn onClick={() => void create()}>Créer le brouillon de facture</Btn></div>
          </>)}
      </div>
    </SidePanel>
  )
}

function ManualInvoice({ defaultClientId, onClose, onCreated }: { defaultClientId?: string; onClose: () => void; onCreated: (_id: string) => void }) {
  const cat = useCommercialCatalog()
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [lines, setLines] = useState<EditableLine[]>([blankLine()])
  const [error, setError] = useState('')
  async function create() {
    const r = await apiRequest<{ invoice: { id: string } }>('/api/invoices', { method: 'POST', json: { clientId, lines: lines.filter(l => l.label.trim()) } })
    if (!r.ok) { setError(r.error); return }
    onCreated(r.data.invoice.id)
  }
  return (
    <SidePanel wide onClose={onClose} title="Facture manuelle">
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="block text-xs text-surface-600">Client<select className={inputCls} value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Choisir…</option>{cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <LinesEditor lines={lines} onChange={setLines} />
        <div className="flex justify-end"><Btn onClick={() => void create()} disabled={!clientId}>Créer le brouillon</Btn></div>
      </div>
    </SidePanel>
  )
}

function InvoiceDetail({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen: (_id: string) => void }) {
  const { success } = useToast()
  const [inv, setInv] = useState<InvoiceFull | null>(null)
  const [lines, setLines] = useState<EditableLine[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pay, setPay] = useState({ amount: '', receivedAt: todayIso(), method: 'TRANSFER', reference: '' })

  const load = useCallback(async () => {
    const r = await apiRequest<InvoiceFull>(`/api/invoices/${id}`)
    if (!r.ok) { setError(r.error); return }
    setInv(r.data); setLines(r.data.lines); setNotes(r.data.notes)
    setPay(p => ({ ...p, amount: r.data.balance > 0 ? String(r.data.balance) : '' }))
  }, [id])
  useEffect(() => { void load() }, [load])

  async function run(p: Promise<{ ok: boolean; error?: string; data?: unknown }>, msg?: string) {
    setError(''); setBusy(true)
    const r = await p
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'Erreur'); return null }
    if (msg) success(msg)
    void load(); onChanged()
    return r.data
  }
  if (!inv) return <SidePanel onClose={onClose} title="Facture">{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</SidePanel>
  const draft = inv.status === 'DRAFT'
  const isCredit = inv.kind === 'CREDIT_NOTE'
  const payable = !isCredit && ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)
  return (
    <SidePanel wide onClose={onClose}
      title={`${isCredit ? 'Avoir' : 'Facture'} ${inv.number ?? '(brouillon)'}`}
      subtitle={<span className="inline-flex items-center gap-2"><StatusChip map={INVOICE_STATUS} status={inv.status} />{inv.client.name}{inv.periodStart ? ` · ${frDay(inv.periodStart)} – ${frDay(inv.periodEnd)}` : ''}</span>}
      actions={<>
        <Btn onClick={() => openPrintable('invoice', inv.id)} variant="ghost" size="sm">Aperçu / imprimer</Btn>
        {!draft && <Btn onClick={() => void downloadPdf('invoice', inv.id).then(e => e && setError(e))} variant="ghost" size="sm">PDF</Btn>}
        {draft && <Btn onClick={() => void run(apiRequest(`/api/invoices/${inv.id}/issue`, { method: 'POST' }), 'Facture émise')} size="sm" disabled={busy}>Émettre la facture</Btn>}
        {!draft && inv.status !== 'CANCELLED' && <Btn onClick={() => void run(apiRequest<{ message: string }>(`/api/invoices/${inv.id}/send`, { method: 'POST', json: {} })).then(d => d && success((d as { message: string }).message))} size="sm" disabled={busy}>Envoyer par e-mail</Btn>}
        {!draft && inv.status !== 'CANCELLED' && <Btn onClick={() => void run(apiRequest(`/api/invoices/${inv.id}/send`, { method: 'POST', json: { markOnly: true } }), 'Marquée envoyée')} variant="ghost" size="sm">Marquer envoyée</Btn>}
        {!draft && !isCredit && inv.status !== 'CANCELLED' && <Btn onClick={() => { if (window.confirm('Créer un avoir sur toute la facture ?')) void run(apiRequest<{ id: string }>(`/api/invoices/${inv.id}/credit-note`, { method: 'POST', json: {} })).then(d => d && onOpen((d as { id: string }).id)) }} variant="warning" size="sm">Faire un avoir</Btn>}
      </>}>
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {draft && <p className="text-sm text-surface-600">Brouillon modifiable. À l&apos;émission, la facture reçoit son numéro définitif et ne se modifie plus (correction par avoir).</p>}
        {inv.creditedInvoice && <p className="text-sm text-violet-800">Avoir sur la facture <button type="button" className="underline" onClick={() => onOpen(inv.creditedInvoice!.id)}>{inv.creditedInvoice.number}</button>.</p>}
        <LinesEditor lines={lines} onChange={draft ? setLines : undefined} readOnly={!draft} />
        {draft && (
          <div className="space-y-2">
            <label className="block text-xs text-surface-600">Notes<textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => { if (window.confirm('Supprimer ce brouillon ?')) void run(apiRequest(`/api/invoices/${inv.id}`, { method: 'DELETE' }), 'Brouillon supprimé').then(d => d && onClose()) }} variant="danger" size="sm">Supprimer</Btn>
              <Btn onClick={() => void run(apiRequest(`/api/invoices/${inv.id}`, { method: 'PUT', json: { notes, lines: lines.filter(l => l.label.trim()) } }), 'Brouillon enregistré')} size="sm" disabled={busy}>Enregistrer</Btn>
            </div>
          </div>
        )}
        {!draft && !isCredit && (
          <section aria-labelledby="payments-title" className="space-y-2">
            <h3 id="payments-title" className="text-sm font-medium text-surface-800">Règlements — reste dû {eur(inv.balance)}</h3>
            <ul className="divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200 text-sm">
              {inv.payments.map(p => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2">
                  <span>{frDay(p.receivedAt)} · {METHODS.find(m => m[0] === p.method)?.[1] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                  <span className="flex items-center gap-2 tabular-nums">{eur(p.amount)}
                    <button type="button" aria-label="Supprimer ce règlement" className="rounded p-1 text-surface-400 hover:bg-red-50 hover:text-red-600" onClick={() => { if (window.confirm('Supprimer ce règlement ?')) void run(apiRequest(`/api/payments/${p.id}`, { method: 'DELETE' }), 'Règlement supprimé') }}>✕</button>
                  </span>
                </li>
              ))}
              {inv.payments.length === 0 && <li className="px-3 py-2 text-surface-500">Aucun règlement.</li>}
            </ul>
            {payable && (
              <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-5">
                <label className="text-xs text-surface-600">Montant<input className={inputCls} inputMode="decimal" value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} /></label>
                <label className="text-xs text-surface-600">Reçu le<input type="date" className={inputCls} value={pay.receivedAt} onChange={e => setPay(p => ({ ...p, receivedAt: e.target.value }))} /></label>
                <label className="text-xs text-surface-600">Mode<select className={inputCls} value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value }))}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="text-xs text-surface-600">Référence<input className={inputCls} value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} /></label>
                <Btn onClick={() => void run(apiRequest('/api/payments', { method: 'POST', json: { clientId: inv.client.id, invoiceId: inv.id, amount: Number(pay.amount.replace(',', '.')), receivedAt: pay.receivedAt, method: pay.method, reference: pay.reference } }), 'Règlement enregistré')} size="sm" disabled={busy || !(Number(pay.amount.replace(',', '.')) > 0)}>Enregistrer le règlement</Btn>
              </div>
            )}
          </section>
        )}
        {inv.creditNotes.length > 0 && (
          <p className="text-sm text-surface-600">Avoirs : {inv.creditNotes.map(c => <button key={c.id} type="button" className="mr-2 underline" onClick={() => onOpen(c.id)}>{c.number ?? 'brouillon'} ({eur(c.totalTTC)})</button>)}</p>
        )}
      </div>
    </SidePanel>
  )
}
