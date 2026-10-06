'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { useDebounce } from '../hooks'
import { Btn } from '../ui'
import { useToast } from '@/components/ui/Toast'
import { LinesEditor, blankLine, type EditableLine } from './LinesEditor'
import { PricingAssistant } from './PricingAssistant'
import { useCommercialCatalog } from './useCatalog'
import { Empty, QUOTE_STATUS, SidePanel, StatusChip, downloadPdf, eur, frDay, inputCls, openPrintable } from './shared'

interface QuoteRow { id: string; number: string; status: string; title: string; issueDate: string; validUntil: string; totalHT: number; totalTTC: number; client: { id: string; name: string } }
interface QuoteFull extends QuoteRow {
  siteId: string | null; notes: string; terms: string; refusalReason: string; decidedBy: string
  lines: Array<EditableLine & { id: string }>; order: { id: string; number: string } | null; client: { id: string; name: string; email?: string }
}

export function QuotesView({ clientId, onOpenOrder }: { clientId?: string; onOpenOrder?: (_id: string) => void }) {
  const { error: toastError, success: toastSuccess } = useToast()
  const [rows, setRows] = useState<QuoteRow[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounce(q, 250)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const sp = new URLSearchParams({ limit: '100' })
    if (status) sp.set('status', status)
    if (dq) sp.set('q', dq)
    if (clientId) sp.set('clientId', clientId)
    const r = await apiRequest<{ data: QuoteRow[] }>(`/api/quotes?${sp}`)
    setLoading(false)
    if (r.ok) setRows(r.data.data); else toastError(r.error)
  }, [status, dq, clientId, toastError])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Rechercher un devis" value={q} onChange={e => setQ(e.target.value)} placeholder="N°, objet, client…" className={`${inputCls} w-60`} />
        <select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value)} className={`${inputCls} w-44`}>
          <option value="">Tous les statuts</option>
          {Object.entries(QUOTE_STATUS).map(([k, [lab]]) => <option key={k} value={k}>{lab}</option>)}
        </select>
        <div className="ml-auto"><Btn onClick={() => setOpen('new')} size="sm">Nouveau devis</Btn></div>
      </div>
      {!loading && rows.length === 0 ? (
        <Empty title="Aucun devis" action={<Btn onClick={() => setOpen('new')}>Créer un devis</Btn>}>
          Un devis se chiffre avec vos grilles tarifaires ; accepté, il devient une commande et ses interventions sans ressaisie.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500">
              <tr><th className="px-3 py-2 font-medium">N°</th><th className="px-3 py-2 font-medium">Client</th><th className="px-3 py-2 font-medium">Objet</th><th className="px-3 py-2 font-medium">Statut</th><th className="px-3 py-2 font-medium">Valable jusqu&apos;au</th><th className="px-3 py-2 text-right font-medium">Total HT</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-100 bg-white">
              {rows.map(r => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-50" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-2"><button type="button" className="font-medium text-surface-900 hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button></td>
                  <td className="px-3 py-2 text-surface-700">{r.client.name}</td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-surface-600">{r.title || '—'}</td>
                  <td className="px-3 py-2"><StatusChip map={QUOTE_STATUS} status={r.status} /></td>
                  <td className="px-3 py-2 tabular-nums text-surface-600">{frDay(r.validUntil)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.totalHT)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <QuoteEditor id={open === 'new' ? null : open} defaultClientId={clientId} onClose={() => setOpen(null)}
        onSaved={(id, msg) => { if (msg) toastSuccess(msg); void load(); if (id) setOpen(id) }} onOpenOrder={onOpenOrder} />}
    </div>
  )
}

function QuoteEditor({ id, defaultClientId, onClose, onSaved, onOpenOrder }: {
  id: string | null; defaultClientId?: string; onClose: () => void; onSaved: (_id: string | null, _msg?: string) => void; onOpenOrder?: (_id: string) => void
}) {
  const cat = useCommercialCatalog()
  const [quote, setQuote] = useState<QuoteFull | null>(null)
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [siteId, setSiteId] = useState('')
  const [title, setTitle] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [lines, setLines] = useState<EditableLine[]>([blankLine()])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [convertKind, setConvertKind] = useState('POSE_RETRAIT')

  const load = useCallback(async () => {
    if (!id) return
    const r = await apiRequest<QuoteFull>(`/api/quotes/${id}`)
    if (!r.ok) { setError(r.error); return }
    const q = r.data
    setQuote(q); setClientId(q.client.id); setSiteId(q.siteId ?? ''); setTitle(q.title); setValidUntil(q.validUntil); setNotes(q.notes); setTerms(q.terms)
    setLines(q.lines.map(l => ({ ...l })))
  }, [id])
  useEffect(() => { void load() }, [load])

  const editable = !quote || quote.status === 'DRAFT'
  const client = cat.clients.find(c => c.id === clientId)
  const sites = client?.clientSites?.map(cs => cs.site) ?? []
  const zip = sites.find(s => s.id === siteId)?.zipCode

  async function save(): Promise<string | null> {
    setError(''); setBusy(true)
    const payloadLines = lines.filter(l => l.label.trim()).map(l => ({ ...l, missionType: l.missionType || null }))
    const body = { siteId: siteId || null, title, notes, terms, ...(validUntil ? { validUntil } : {}), lines: payloadLines }
    const r = quote
      ? await apiRequest<QuoteFull>(`/api/quotes/${quote.id}`, { method: 'PUT', json: body })
      : await apiRequest<QuoteFull>('/api/quotes', { method: 'POST', json: { ...body, clientId } })
    setBusy(false)
    if (!r.ok) { setError(r.error); return null }
    onSaved(r.data.id, quote ? 'Devis enregistré' : `Devis ${r.data.number} créé`)
    if (quote) void load()
    return r.data.id
  }

  async function act(path: string, json: unknown, msg: string) {
    if (!quote) return
    setError(''); setBusy(true)
    const r = await apiRequest<{ mail?: { sent: boolean; message: string } | null; id?: string }>(`/api/quotes/${quote.id}/${path}`, { method: 'POST', json })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const mail = r.data.mail
    onSaved(path === 'duplicate' && r.data.id ? r.data.id : quote.id, mail ? (mail.sent ? `Devis envoyé — ${mail.message}` : `Devis marqué envoyé. ${mail.message}`) : msg)
    if (path !== 'duplicate') void load()
  }

  async function convert() {
    if (!quote) return
    setBusy(true); setError('')
    const r = await apiRequest<{ id: string; number: string; missions: unknown[] }>(`/api/quotes/${quote.id}/convert`, { method: 'POST', json: { kind: convertKind, createMissions: true } })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onSaved(quote.id, `Commande ${r.data.number} créée avec ${r.data.missions.length} intervention(s)`)
    void load()
  }

  const actions = quote && (
    <>
      <Btn onClick={() => openPrintable('quote', quote.id)} variant="ghost" size="sm">Aperçu / imprimer</Btn>
      <Btn onClick={() => void downloadPdf('quote', quote.id).then(e => e && setError(e))} variant="ghost" size="sm">PDF</Btn>
      <Btn onClick={() => void act('duplicate', {}, 'Devis dupliqué')} variant="ghost" size="sm">Dupliquer</Btn>
      {(quote.status === 'DRAFT' || quote.status === 'SENT') && <Btn onClick={() => void act('send', {}, 'Devis envoyé')} size="sm" disabled={busy}>{quote.status === 'SENT' ? 'Renvoyer par e-mail' : 'Envoyer au client'}</Btn>}
      {(quote.status === 'SENT' || quote.status === 'DRAFT') && <Btn onClick={() => void act('decision', { decision: 'ACCEPTED' }, 'Devis accepté')} variant="success" size="sm" disabled={busy}>Accepté par le client</Btn>}
      {quote.status === 'SENT' && <Btn onClick={() => { const reason = window.prompt('Motif du refus (facultatif)') ?? ''; void act('decision', { decision: 'REFUSED', reason }, 'Devis refusé') }} variant="danger" size="sm" disabled={busy}>Refusé</Btn>}
    </>
  )

  return (
    <SidePanel wide onClose={onClose} title={quote ? `Devis ${quote.number}` : 'Nouveau devis'}
      subtitle={quote ? <span className="inline-flex items-center gap-2"><StatusChip map={QUOTE_STATUS} status={quote.status} />{quote.client.name}</span> : undefined}
      actions={actions}>
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {quote?.status === 'ACCEPTED' && (
          <section className="flex flex-wrap items-end gap-3 rounded-xl bg-emerald-50 p-4">
            <div className="flex-1 text-sm text-emerald-900">Accepté{quote.decidedBy ? ` par ${quote.decidedBy}` : ''}. Créez la commande : les lignes liées à une intervention deviennent des missions à planifier.</div>
            <label className="text-xs text-emerald-900">Type de commande
              <select className={inputCls} value={convertKind} onChange={e => setConvertKind(e.target.value)}>
                <option value="ONE_OFF">Ponctuelle</option><option value="POSE_RETRAIT">Pose puis retrait</option><option value="ROTATION">Rotations</option><option value="LONG_RENTAL">Location longue durée</option>
              </select>
            </label>
            <Btn onClick={() => void convert()} disabled={busy}>Créer la commande</Btn>
          </section>
        )}
        {quote?.order && (
          <p className="text-sm text-violet-800">Commande <button type="button" className="font-medium underline" onClick={() => onOpenOrder?.(quote.order!.id)}>{quote.order.number}</button> créée depuis ce devis.</p>
        )}
        {quote?.status === 'REFUSED' && quote.refusalReason && <p className="text-sm text-red-700">Motif du refus : {quote.refusalReason}</p>}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-surface-600">Client
            <select className={inputCls} value={clientId} onChange={e => { setClientId(e.target.value); setSiteId('') }} disabled={!!quote}>
              <option value="">Choisir un client…</option>
              {cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-surface-600">Chantier / site
            <select className={inputCls} value={siteId} onChange={e => setSiteId(e.target.value)} disabled={!editable || sites.length === 0}>
              <option value="">{sites.length === 0 ? 'Aucun site pour ce client' : 'Non précisé'}</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-surface-600">Objet
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} disabled={!editable} placeholder="Benne gravats — chantier rue des Alpes" />
          </label>
          <label className="text-xs text-surface-600">Valable jusqu&apos;au
            <input type="date" className={inputCls} value={validUntil} onChange={e => setValidUntil(e.target.value)} disabled={!editable} />
          </label>
        </div>

        {editable && clientId && <PricingAssistant clientId={clientId} zip={zip} containerTypes={cat.containerTypes} materials={cat.materials} onAdd={add => setLines(ls => [...ls.filter(l => l.label.trim()), ...add])} />}

        <LinesEditor lines={lines} onChange={setLines} readOnly={!editable} operations containerTypes={cat.containerTypes} materials={cat.materials} />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-surface-600">Notes au client
            <textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} disabled={!editable} />
          </label>
          <label className="text-xs text-surface-600">Conditions
            <textarea rows={3} className={inputCls} value={terms} onChange={e => setTerms(e.target.value)} disabled={!editable} />
          </label>
        </div>
        {editable && (
          <div className="flex justify-end gap-2">
            {quote && <Btn onClick={() => { if (window.confirm('Supprimer ce brouillon ?')) void apiRequest(`/api/quotes/${quote.id}`, { method: 'DELETE' }).then(r => { if (r.ok) { onSaved(null, 'Brouillon supprimé'); onClose() } else setError(r.error) }) }} variant="danger" size="sm">Supprimer</Btn>}
            <Btn onClick={() => void save()} disabled={busy || !clientId}>{quote ? 'Enregistrer' : 'Créer le devis'}</Btn>
          </div>
        )}
      </div>
    </SidePanel>
  )
}
