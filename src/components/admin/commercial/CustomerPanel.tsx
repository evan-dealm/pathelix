'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { QuotesView } from './QuotesView'
import { OrdersView } from './OrdersView'
import { InvoicesView } from './InvoicesView'
import { ContractsView } from './ContractsView'
import { SidePanel, SubTabs, eur, frDay, inputCls } from './shared'
import { PortalAccess } from './PortalAccess'

interface Overview {
  client: { id: string; name: string; email: string; phone: string; siret: string; billingAddress: string; notes: string; paymentTermsDays: number; vip: boolean; requiresBsd: boolean }
  contacts: Array<{ id: string; name: string; role: string; email: string; phone: string; isPrimary: boolean; receivesInvoices: boolean }>
  sites: Array<{ id: string; name: string; address: string; accessNotes: string }>
  containers: Array<{ id: string; number: string; status: string; daysOnSite: number | null; type: { name: string }; site: { name: string } | null }>
  contracts: Array<{ id: string; number: string; status: string; startDate: string; endDate: string | null; title: string }>
  documents: Array<{ id: string; kind: string; filename: string; createdAt: string; visibleToClient: boolean }>
  stats: { missionsDone: number; missionsPlanned: number; incidents: number; tonnage: number; quotesOpen: number }
  finance: { revenue12mHT: number; outstanding: number; overdue: number; paymentTermsDays: number } | null
  timeline: Array<{ at: string; kind: string; title: string; detail: string }>
}

type View = 'overview' | 'quotes' | 'orders' | 'invoices' | 'contracts'

const KIND_DOT: Record<string, string> = {
  NOTE: 'bg-surface-400', CALL: 'bg-sky-500', EMAIL: 'bg-sky-400', MEETING: 'bg-sky-600', QUOTE: 'bg-violet-500', ORDER: 'bg-violet-600',
  MISSION: 'bg-[#0055A4]', PROOF: 'bg-emerald-500', WEIGHING: 'bg-teal-500', INVOICE: 'bg-amber-500', PAYMENT: 'bg-emerald-600',
}

/**
 * The customer in one place: who, where, what is on site, what was sold, done, billed and paid —
 * one timeline from the first call to the last payment.
 */
export function CustomerPanel({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [o, setO] = useState<Overview | null>(null)
  const [view, setView] = useState<View>('overview')
  const [error, setError] = useState('')
  const [note, setNote] = useState({ kind: 'CALL', content: '' })
  const [contact, setContact] = useState({ name: '', role: '', email: '', phone: '', receivesInvoices: false })
  const load = useCallback(async () => {
    const r = await apiRequest<Overview>(`/api/clients/${clientId}/overview`)
    if (r.ok) setO(r.data); else setError(r.error)
  }, [clientId])
  useEffect(() => { void load() }, [load])

  async function addNote() {
    const r = await apiRequest(`/api/clients/${clientId}/notes`, { method: 'POST', json: note })
    if (!r.ok) { setError(r.error); return }
    setNote(n => ({ ...n, content: '' })); void load()
  }
  async function addContact() {
    const r = await apiRequest(`/api/clients/${clientId}/contacts`, { method: 'POST', json: contact })
    if (!r.ok) { setError(r.error); return }
    setContact({ name: '', role: '', email: '', phone: '', receivesInvoices: false }); void load()
  }

  return (
    <SidePanel wide onClose={onClose} title={o?.client.name ?? 'Client'}
      subtitle={o ? [o.client.siret ? `SIRET ${o.client.siret}` : '', o.client.email, o.client.phone].filter(Boolean).join(' · ') : undefined}
      actions={<SubTabs label="Fiche client" value={view} onChange={setView} tabs={[['overview', 'Vue d\'ensemble'], ['quotes', 'Devis'], ['orders', 'Commandes'], ['invoices', 'Factures'], ['contracts', 'Contrats']]} />}>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {view === 'quotes' && <QuotesView clientId={clientId} />}
      {view === 'orders' && <OrdersView clientId={clientId} />}
      {view === 'invoices' && <InvoicesView clientId={clientId} />}
      {view === 'contracts' && <ContractsView clientId={clientId} />}
      {view === 'overview' && o && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {o.finance && <>
                <div><dt className="text-xs text-surface-500">CA 12 mois (HT)</dt><dd className="font-display text-lg font-semibold tabular-nums">{eur(o.finance.revenue12mHT)}</dd></div>
                <div><dt className="text-xs text-surface-500">Encours</dt><dd className="font-display text-lg font-semibold tabular-nums">{eur(o.finance.outstanding)}</dd></div>
                <div><dt className="text-xs text-surface-500">En retard</dt><dd className={`font-display text-lg font-semibold tabular-nums ${o.finance.overdue > 0 ? 'text-red-600' : ''}`}>{eur(o.finance.overdue)}</dd></div>
              </>}
              <div><dt className="text-xs text-surface-500">Interventions réalisées</dt><dd className="font-display text-lg font-semibold tabular-nums">{o.stats.missionsDone}</dd></div>
              <div><dt className="text-xs text-surface-500">À venir</dt><dd className="font-display text-lg font-semibold tabular-nums">{o.stats.missionsPlanned}</dd></div>
              <div><dt className="text-xs text-surface-500">Tonnage pesé</dt><dd className="font-display text-lg font-semibold tabular-nums">{o.stats.tonnage.toLocaleString('fr-FR')} t</dd></div>
            </dl>

            <section aria-labelledby="c-containers">
              <h3 id="c-containers" className="text-sm font-medium text-surface-800">Bennes chez ce client ({o.containers.length})</h3>
              <ul className="mt-2 divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200 text-sm">
                {o.containers.map(c => <li key={c.id} className="flex justify-between px-3 py-2"><span><strong className="font-display">{c.number}</strong> · {c.type.name}{c.site ? ` · ${c.site.name}` : ''}</span><span className={`tabular-nums ${c.daysOnSite !== null && c.daysOnSite >= 30 ? 'font-semibold text-amber-700' : 'text-surface-600'}`}>{c.daysOnSite ?? '—'} j</span></li>)}
                {o.containers.length === 0 && <li className="px-3 py-2 text-surface-500">Aucune benne sur site.</li>}
              </ul>
            </section>

            <section aria-labelledby="c-sites">
              <h3 id="c-sites" className="text-sm font-medium text-surface-800">Sites</h3>
              <ul className="mt-2 space-y-2 text-sm">{o.sites.map(s => <li key={s.id}><span className="font-medium">{s.name}</span> — {s.address}{s.accessNotes && <span className="block text-xs text-surface-500">Accès : {s.accessNotes}</span>}</li>)}
                {o.sites.length === 0 && <li className="text-surface-500">Aucun site (à créer dans le catalogue).</li>}</ul>
            </section>

            <section aria-labelledby="c-contacts">
              <h3 id="c-contacts" className="text-sm font-medium text-surface-800">Contacts</h3>
              <ul className="mt-2 divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200 text-sm">
                {o.contacts.map(c => <li key={c.id} className="px-3 py-2"><span className="font-medium">{c.name}</span>{c.role ? ` — ${c.role}` : ''}{c.isPrimary ? ' · principal' : ''}{c.receivesInvoices ? ' · reçoit les factures' : ''}<span className="block text-xs text-surface-500">{[c.email, c.phone].filter(Boolean).join(' · ')}</span></li>)}
                {o.contacts.length === 0 && <li className="px-3 py-2 text-surface-500">Aucun contact.</li>}
              </ul>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input aria-label="Nom du contact" className={inputCls} placeholder="Nom" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} />
                <input aria-label="Fonction" className={inputCls} placeholder="Fonction" value={contact.role} onChange={e => setContact(c => ({ ...c, role: e.target.value }))} />
                <input aria-label="E-mail" className={inputCls} placeholder="E-mail" value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
                <input aria-label="Téléphone" className={inputCls} placeholder="Téléphone" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} />
                <label className="col-span-2 inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={contact.receivesInvoices} onChange={e => setContact(c => ({ ...c, receivesInvoices: e.target.checked }))} />Reçoit les devis et factures</label>
                <div className="col-span-2"><Btn onClick={() => void addContact()} variant="ghost" size="sm" disabled={!contact.name.trim()}>Ajouter le contact</Btn></div>
              </div>
            </section>

            {o.documents.length > 0 && (
              <section aria-labelledby="c-docs">
                <h3 id="c-docs" className="text-sm font-medium text-surface-800">Documents</h3>
                <ul className="mt-2 space-y-1 text-sm">{o.documents.map(d => <li key={d.id}><a className="text-brand-600 hover:underline" href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer">{d.filename}</a> <span className="text-xs text-surface-500">{frDay(d.createdAt.slice(0, 10))}{d.visibleToClient ? ' · visible sur le portail' : ''}</span></li>)}</ul>
              </section>
            )}

            <PortalAccess clientId={clientId} />
          </div>

          <section aria-labelledby="c-timeline" className="space-y-3">
            <h3 id="c-timeline" className="text-sm font-medium text-surface-800">Chronologie</h3>
            <div className="flex gap-2">
              <select aria-label="Type d'échange" className={`${inputCls} w-32`} value={note.kind} onChange={e => setNote(n => ({ ...n, kind: e.target.value }))}>
                <option value="CALL">Appel</option><option value="EMAIL">E-mail</option><option value="MEETING">Rendez-vous</option><option value="NOTE">Note</option>
              </select>
              <input aria-label="Contenu" className={inputCls} placeholder="Ce qui a été dit ou convenu…" value={note.content} onChange={e => setNote(n => ({ ...n, content: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && note.content.trim()) void addNote() }} />
              <Btn onClick={() => void addNote()} size="sm" disabled={!note.content.trim()}>Ajouter</Btn>
            </div>
            <ol className="space-y-3 border-l border-surface-200 pl-4">
              {o.timeline.map((t, i) => (
                <li key={i} className="relative text-sm">
                  <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${KIND_DOT[t.kind] ?? 'bg-surface-300'}`} aria-hidden />
                  <p className="text-surface-900">{t.title}</p>
                  <p className="text-xs text-surface-500">{new Date(t.at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}{t.detail ? ` · ${t.detail}` : ''}</p>
                </li>
              ))}
              {o.timeline.length === 0 && <li className="text-sm text-surface-500">Rien encore : ajoutez le premier échange.</li>}
            </ol>
          </section>
        </div>
      )}
    </SidePanel>
  )
}
