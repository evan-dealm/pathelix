'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'

interface Overview {
  me: { name: string; email: string }
  client: string
  company: { name: string; supportEmail: string }
  sites: Array<{ id: string; name: string; address: string }>
  containers: Array<{ id: string; number: string; status: string; daysOnSite: number | null; type: { name: string; capacityM3: number }; site: { id: string; name: string } | null }>
  upcoming: Array<{ id: string; label: string; date: string; address: string; window: [number, number] | null; trackingToken: string | null }>
  past: Array<{ id: string; label: string; date: string; address: string; completedAt: string; hasPhoto: boolean; hasSignature: boolean }>
  quotes: Array<{ id: string; number: string; status: string; title: string; validUntil: string; totalTTC: number }>
  invoices: Array<{ id: string; number: string; kind: string; status: string; issueDate: string; dueDate: string | null; totalTTC: number; balance: number }>
  weighings: Array<{ id: string; netKg: number; weighedAt: string; ticketNumber: string }>
  documents: Array<{ id: string; kind: string; filename: string; createdAt: string }>
  requests: Array<{ id: string; kind: string; status: string; preferredDate: string | null; message: string; response: string; createdAt: string }>
}

type Tab = 'home' | 'interventions' | 'billing' | 'documents' | 'requests'
const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const fr = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const BIN_STATUS: Record<string, string> = { AT_CUSTOMER: 'Sur site', FULL: 'Signalée pleine', TO_COLLECT: 'Retrait demandé' }
const QUOTE_STATUS: Record<string, string> = { SENT: 'À valider', ACCEPTED: 'Accepté', REFUSED: 'Refusé', CONVERTED: 'Accepté', EXPIRED: 'Expiré' }
const INVOICE_STATUS: Record<string, string> = { ISSUED: 'À régler', SENT: 'À régler', PARTIALLY_PAID: 'Réglée en partie', PAID: 'Réglée', OVERDUE: 'En retard', CANCELLED: 'Annulée' }
const REQ_KIND: Record<string, string> = { ROTATION: 'Rotation', PICKUP: 'Retrait', NEW_CONTAINER: 'Benne supplémentaire', ISSUE: 'Problème', OTHER: 'Demande' }
const REQ_STATUS: Record<string, string> = { NEW: 'Reçue', ACCEPTED: 'Planifiée', DONE: 'Traitée', REJECTED: 'Refusée' }

/**
 * Customer portal: what a site manager needs without calling the haulier — bins on site,
 * upcoming visits, proofs, documents, quotes to accept, invoices, and one-tap requests.
 */
export default function PortalPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading')
  const [tab, setTab] = useState<Tab>('home')
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    const r = await apiRequest<Overview>('/api/portal/overview')
    if (r.ok) { setData(r.data); setState('ready') }
    else if (r.status === 401) setState('login')
    else { setFlash(r.error); setState('ready') }
  }, [])
  useEffect(() => { void load() }, [load])

  if (state === 'loading') return <main className="grid min-h-dvh place-items-center bg-surface-50 text-surface-500"><p role="status">Chargement…</p></main>
  if (state === 'login') return <Login onDone={() => void load()} />
  if (!data) return <main className="grid min-h-dvh place-items-center bg-surface-50"><p role="alert" className="text-red-700">{flash}</p></main>

  const due = data.invoices.filter(i => i.kind === 'INVOICE' && ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status))
  const toAnswer = data.quotes.filter(q => q.status === 'SENT')
  return (
    <div className="min-h-dvh bg-surface-50 text-surface-900">
      <header className="border-b border-surface-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-xs text-surface-500">{data.company.name || 'Espace client'}</p>
            <h1 className="font-display text-lg font-semibold">{data.client}</h1>
          </div>
          <button type="button" className="text-sm text-surface-600 hover:text-surface-900" onClick={() => void apiRequest('/api/portal/logout', { method: 'POST' }).then(() => setState('login'))}>Se déconnecter</button>
        </div>
        <nav aria-label="Rubriques" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {([['home', 'Accueil'], ['interventions', 'Interventions'], ['billing', `Devis et factures${toAnswer.length ? ` (${toAnswer.length})` : ''}`], ['documents', 'Documents'], ['requests', 'Mes demandes']] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${tab === id ? 'bg-brand-50 font-medium text-brand-700' : 'text-surface-600 hover:bg-surface-100'}`}>{label}</button>
          ))}
        </nav>
      </header>
      <main id="main-content" className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {flash && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
        {tab === 'home' && <>
          <section aria-labelledby="bins">
            <h2 id="bins" className="font-display text-base font-semibold">Vos bennes sur site ({data.containers.length})</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {data.containers.map(c => (
                <article key={c.id} className="rounded-xl bg-white p-4 ring-1 ring-surface-200">
                  <div className="flex items-baseline justify-between"><span className="font-display text-lg font-semibold">{c.number}</span><span className="text-xs text-surface-500">{BIN_STATUS[c.status] ?? c.status}</span></div>
                  <p className="text-sm text-surface-600">{c.type.name}{c.site ? ` · ${c.site.name}` : ''} · depuis {c.daysOnSite ?? 0} j</p>
                  {c.status === 'AT_CUSTOMER' || c.status === 'FULL' ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <RequestButton kind="ROTATION" containerId={c.id} label="Demander une rotation" onDone={m => { setFlash(m); void load() }} />
                      <RequestButton kind="PICKUP" containerId={c.id} label="Faire retirer" onDone={m => { setFlash(m); void load() }} subtle />
                    </div>
                  ) : <p className="mt-2 text-sm text-amber-700">Retrait demandé — nous planifions le passage.</p>}
                </article>
              ))}
              {data.containers.length === 0 && <p className="text-sm text-surface-600">Aucune benne chez vous actuellement.</p>}
            </div>
          </section>
          <section aria-labelledby="next">
            <h2 id="next" className="font-display text-base font-semibold">Prochaines interventions</h2>
            <ul className="mt-3 divide-y divide-surface-100 rounded-xl bg-white ring-1 ring-surface-200">
              {data.upcoming.slice(0, 5).map(m => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span><strong>{m.label}</strong> le {fr(m.date)}{m.window ? ` entre ${hhmm(m.window[0])} et ${hhmm(m.window[1])}` : ''}<span className="block text-xs text-surface-500">{m.address}</span></span>
                  {m.trackingToken && <a className="text-brand-600 hover:underline" href={`/track/${m.trackingToken}`}>Suivre le camion</a>}
                </li>
              ))}
              {data.upcoming.length === 0 && <li className="px-4 py-3 text-sm text-surface-600">Aucune intervention prévue.</li>}
            </ul>
          </section>
          {(due.length > 0 || toAnswer.length > 0) && (
            <section aria-labelledby="todo" className="rounded-xl bg-white p-4 ring-1 ring-surface-200">
              <h2 id="todo" className="font-display text-base font-semibold">À traiter</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {toAnswer.map(q => <li key={q.id}>Devis {q.number} à valider avant le {fr(q.validUntil)} — <button type="button" className="text-brand-600 underline" onClick={() => setTab('billing')}>voir</button></li>)}
                {due.map(i => <li key={i.id} className={i.status === 'OVERDUE' ? 'text-red-700' : ''}>Facture {i.number} : {eur(i.balance)} à régler avant le {fr(i.dueDate)}</li>)}
              </ul>
            </section>
          )}
          <NewRequest sites={data.sites} onDone={m => { setFlash(m); void load() }} />
        </>}

        {tab === 'interventions' && (
          <section aria-labelledby="hist">
            <h2 id="hist" className="font-display text-base font-semibold">Interventions réalisées</h2>
            <ul className="mt-3 divide-y divide-surface-100 rounded-xl bg-white ring-1 ring-surface-200">
              {data.past.map(m => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span><strong>{m.label}</strong> le {fr(m.completedAt)}<span className="block text-xs text-surface-500">{m.address}</span></span>
                  <span className="flex gap-3">
                    {m.hasPhoto && <a className="text-brand-600 hover:underline" href={`/api/portal/missions/${m.id}/proof?what=photo`} target="_blank" rel="noopener noreferrer">Photo</a>}
                    {m.hasSignature && <a className="text-brand-600 hover:underline" href={`/api/portal/missions/${m.id}/proof?what=signature`} target="_blank" rel="noopener noreferrer">Signature</a>}
                  </span>
                </li>
              ))}
              {data.past.length === 0 && <li className="px-4 py-3 text-sm text-surface-600">Aucune intervention réalisée.</li>}
            </ul>
            {data.weighings.length > 0 && <>
              <h2 className="mt-6 font-display text-base font-semibold">Tickets de pesée</h2>
              <ul className="mt-3 divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
                {data.weighings.map(w => <li key={w.id} className="flex justify-between px-4 py-2"><span>{fr(w.weighedAt)}{w.ticketNumber ? ` · ticket ${w.ticketNumber}` : ''}</span><span className="tabular-nums">{(w.netKg / 1000).toLocaleString('fr-FR')} t</span></li>)}
              </ul>
            </>}
          </section>
        )}

        {tab === 'billing' && <Billing quotes={data.quotes} invoices={data.invoices} onDecided={m => { setFlash(m); void load() }} />}

        {tab === 'documents' && (
          <section aria-labelledby="docs">
            <h2 id="docs" className="font-display text-base font-semibold">Documents</h2>
            <ul className="mt-3 divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
              {data.documents.map(d => <li key={d.id} className="flex justify-between px-4 py-2"><a className="text-brand-600 hover:underline" href={`/api/portal/documents/${d.id}`}>{d.filename}</a><span className="text-xs text-surface-500">{fr(d.createdAt)}</span></li>)}
              {data.documents.length === 0 && <li className="px-4 py-3 text-surface-600">Aucun document partagé.</li>}
            </ul>
          </section>
        )}

        {tab === 'requests' && (
          <section aria-labelledby="reqs" className="space-y-4">
            <NewRequest sites={data.sites} onDone={m => { setFlash(m); void load() }} />
            <h2 id="reqs" className="font-display text-base font-semibold">Mes demandes</h2>
            <ul className="divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
              {data.requests.map(r => <li key={r.id} className="px-4 py-3"><div className="flex justify-between"><strong>{REQ_KIND[r.kind] ?? r.kind}</strong><span>{REQ_STATUS[r.status] ?? r.status}</span></div><p className="text-xs text-surface-500">Envoyée le {fr(r.createdAt)}{r.preferredDate ? ` · souhaitée le ${fr(r.preferredDate)}` : ''}</p>{r.message && <p className="text-surface-700">{r.message}</p>}{r.response && <p className="mt-1 text-surface-900">Réponse : {r.response}</p>}</li>)}
              {data.requests.length === 0 && <li className="px-4 py-3 text-surface-600">Aucune demande.</li>}
            </ul>
          </section>
        )}
        {data.company.supportEmail && <p className="text-center text-xs text-surface-500">Une question ? <a className="underline" href={`mailto:${data.company.supportEmail}`}>{data.company.supportEmail}</a></p>}
      </main>
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    const r = await apiRequest('/api/portal/login', { method: 'POST', json: { email, password } })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone()
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-50 px-4">
      <form onSubmit={e => void submit(e)} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-surface-200">
        <h1 className="font-display text-xl font-semibold">Espace client</h1>
        <p className="text-sm text-surface-600">Suivez vos bennes, vos interventions, vos devis et vos factures.</p>
        <label className="block text-sm">E-mail<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2" /></label>
        <label className="block text-sm">Mot de passe<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2" /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-500 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-50">{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="text-xs text-surface-500">Pas encore d&apos;accès ? Demandez une invitation à votre interlocuteur.</p>
      </form>
    </main>
  )
}

function RequestButton({ kind, containerId, label, onDone, subtle }: { kind: string; containerId: string; label: string; onDone: (_m: string) => void; subtle?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const r = await apiRequest('/api/portal/requests', { method: 'POST', json: { kind, containerId } })
    setBusy(false)
    onDone(r.ok ? 'Demande envoyée : vous serez prévenu dès qu\'elle est planifiée.' : r.error)
  }
  return <button type="button" disabled={busy} onClick={() => void go()} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${subtle ? 'bg-surface-100 text-surface-800 hover:bg-surface-200' : 'bg-brand-500 text-white hover:bg-brand-600'}`}>{label}</button>
}

function NewRequest({ sites, onDone }: { sites: Overview['sites']; onDone: (_m: string) => void }) {
  const [kind, setKind] = useState('NEW_CONTAINER')
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [message, setMessage] = useState('')
  async function send() {
    const r = await apiRequest('/api/portal/requests', { method: 'POST', json: { kind, siteId: siteId || undefined, preferredDate: date || undefined, message } })
    if (r.ok) { setMessage(''); onDone('Demande envoyée.') } else onDone(r.error)
  }
  return (
    <section aria-labelledby="new-req" className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-surface-200">
      <h2 id="new-req" className="font-display text-base font-semibold">Nouvelle demande</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm">Objet<select className="mt-1 w-full rounded-lg border border-surface-200 px-2 py-1.5" value={kind} onChange={e => setKind(e.target.value)}><option value="NEW_CONTAINER">Benne supplémentaire</option><option value="ISSUE">Signaler un problème</option><option value="OTHER">Autre demande</option></select></label>
        <label className="text-sm">Site<select className="mt-1 w-full rounded-lg border border-surface-200 px-2 py-1.5" value={siteId} onChange={e => setSiteId(e.target.value)}><option value="">—</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-sm">Date souhaitée<input type="date" className="mt-1 w-full rounded-lg border border-surface-200 px-2 py-1.5" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <label className="block text-sm">Précisions<textarea rows={2} className="mt-1 w-full rounded-lg border border-surface-200 px-2 py-1.5" value={message} onChange={e => setMessage(e.target.value)} /></label>
      <button type="button" onClick={() => void send()} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">Envoyer la demande</button>
    </section>
  )
}

function Billing({ quotes, invoices, onDecided }: { quotes: Overview['quotes']; invoices: Overview['invoices']; onDecided: (_m: string) => void }) {
  async function decide(id: string, decision: 'ACCEPTED' | 'REFUSED') {
    const reason = decision === 'REFUSED' ? (window.prompt('Motif (facultatif)') ?? '') : undefined
    if (decision === 'ACCEPTED' && !window.confirm('Accepter ce devis ? Cela vaut bon pour accord.')) return
    const r = await apiRequest(`/api/portal/quotes/${id}/decision`, { method: 'POST', json: { decision, reason } })
    onDecided(r.ok ? (decision === 'ACCEPTED' ? 'Devis accepté : nous planifions l\'intervention.' : 'Devis refusé.') : r.error)
  }
  return (
    <>
      <section aria-labelledby="quotes">
        <h2 id="quotes" className="font-display text-base font-semibold">Devis</h2>
        <ul className="mt-3 divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
          {quotes.map(q => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><a className="font-medium text-brand-600 hover:underline" href={`/api/portal/sales/quote/${q.id}`} target="_blank" rel="noopener noreferrer">{q.number}</a> {q.title && `· ${q.title}`}<span className="block text-xs text-surface-500">{eur(q.totalTTC)} TTC · {QUOTE_STATUS[q.status] ?? q.status}{q.status === 'SENT' ? ` jusqu'au ${fr(q.validUntil)}` : ''}</span></span>
              {q.status === 'SENT' && <span className="flex gap-2">
                <button type="button" onClick={() => void decide(q.id, 'ACCEPTED')} className="rounded-lg bg-brand-500 px-3 py-1.5 font-medium text-white hover:bg-brand-600">Accepter</button>
                <button type="button" onClick={() => void decide(q.id, 'REFUSED')} className="rounded-lg bg-surface-100 px-3 py-1.5 hover:bg-surface-200">Refuser</button>
              </span>}
            </li>
          ))}
          {quotes.length === 0 && <li className="px-4 py-3 text-surface-600">Aucun devis.</li>}
        </ul>
      </section>
      <section aria-labelledby="invoices">
        <h2 id="invoices" className="font-display text-base font-semibold">Factures</h2>
        <ul className="mt-3 divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
          {invoices.map(i => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span><a className="font-medium text-brand-600 hover:underline" href={`/api/portal/sales/invoice/${i.id}`} target="_blank" rel="noopener noreferrer">{i.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'} {i.number}</a><span className="block text-xs text-surface-500">Du {fr(i.issueDate)}{i.dueDate ? ` · échéance ${fr(i.dueDate)}` : ''}</span></span>
              <span className={`text-right ${i.status === 'OVERDUE' ? 'text-red-700' : ''}`}><span className="tabular-nums">{eur(i.totalTTC)}</span><span className="block text-xs">{INVOICE_STATUS[i.status] ?? i.status}{i.balance > 0 && i.status !== 'PAID' ? ` · reste ${eur(i.balance)}` : ''}</span></span>
            </li>
          ))}
          {invoices.length === 0 && <li className="px-4 py-3 text-surface-600">Aucune facture.</li>}
        </ul>
      </section>
    </>
  )
}
