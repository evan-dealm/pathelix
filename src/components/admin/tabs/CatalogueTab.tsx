'use client'

import { useState, useEffect, useMemo } from 'react'
import { CustomerPanel } from '@/components/admin/commercial/CustomerPanel'
import { fetchAllPages } from '@/lib/apiClient'
import { CatalogClient, CatalogSite, CatalogProduct, Exutoire } from '@/lib/types'
import { Btn, Modal, Field, Input, SelectInput, Textarea } from '../ui'
import { useDebounce, logErr, sleep } from '../hooks'
import { useToast } from '@/components/ui/Toast'
import { ImportExportBar } from '../ImportExportBar'
import { CLIENT_COLUMNS, parseClientRows, SITE_COLUMNS, parseSiteRows } from '@/lib/importExportColumns'
import { cachedFetch, invalidateClientCache } from '@/lib/clientCache'

type SubTab = 'clients' | 'sites' | 'products'

export function CatalogueTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [subTab, setSubTab] = useState<SubTab>('clients')

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-surface-200 bg-white flex-shrink-0">
        {([
          { id: 'clients' as SubTab, label: 'Clients' },
          { id: 'sites' as SubTab, label: 'Sites' },
          { id: 'products' as SubTab, label: 'Produits' },
        ]).map(t => (
          <button key={t.id} type="button" onClick={() => setSubTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
              ${subTab === t.id ? 'bg-brand-50 text-brand-500' : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700'}`}>
            {t.label}
          </button>
        ))}
        {readOnly && (
          <span className="ml-auto text-xs text-surface-400 italic">Consultation uniquement</span>
        )}
      </div>

      {subTab === 'clients'  && <ClientsPanel readOnly={readOnly} />}
      {subTab === 'sites'    && <SitesPanel readOnly={readOnly} />}
      {subTab === 'products' && <ProductsPanel readOnly={readOnly} />}
    </div>
  )
}

function ClientsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { error: toastError } = useToast()
  const [clients, setClients] = useState<CatalogClient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; client: CatalogClient } | null>(null)
  const [customerId, setCustomerId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    // All pages — the list route returns 50 per page, search/filters ran on a partial list.
    fetchAllPages<CatalogClient>('/api/clients').then(setClients).catch(logErr('clients')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const [vipFilter, setVipFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return clients.filter(c => {
      if (q && !`${c.name} ${c.contact} ${c.email} ${c.phone}`.toLowerCase().includes(q)) return false
      if (vipFilter === 'vip' && !c.vip) return false
      if (vipFilter === 'bsd' && !c.requiresBsd) return false
      return true
    })
  }, [clients, debouncedSearch, vipFilter])

  async function handleDelete(id: string) {
    if (!confirm('Archiver ce client ?')) return
    try {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toastError((d as { error?: string }).error || 'Erreur') }
    } catch { toastError('Erreur réseau') }
    invalidateClientCache('/api/clients')
    load()
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-100 flex-shrink-0">
        <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
          className="bg-surface-50 border border-surface-200 rounded-lg px-3 py-1.5 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-brand-500 w-40" />
        <select value={vipFilter} onChange={e => setVipFilter(e.target.value)} title="Filtrer"
          className="bg-surface-50 border border-surface-200 rounded-lg px-2 py-1.5 text-surface-900 text-xs focus:outline-none focus:border-brand-500">
          <option value="all">Tous</option>
          <option value="vip">VIP</option>
          <option value="bsd">BSD requis</option>
        </select>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-2">
            <ImportExportBar
              columns={CLIENT_COLUMNS}
              data={filtered}
              filename="clients"
              parseRows={parseClientRows}
              onImport={async (items) => {
                let failed = 0
                for (const [i, c] of items.entries()) {
                  if (i > 0) await sleep(250)
                  const res = await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
                  if (!res.ok) failed++
                }
                invalidateClientCache('/api/clients')
                load()
                if (failed > 0) throw new Error(`${failed} sur ${items.length} client(s) n'ont pas pu être importés.`)
              }}
            />
            <Btn onClick={() => setModal({ kind: 'new' })} variant="primary" size="sm">+ Nouveau client</Btn>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-surface-400 text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-surface-400 gap-2">
            <div className="text-3xl">👤</div>
            <div className="text-sm">Aucun client</div>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-surface-50 z-10">
              <tr>
                {['Client', 'Contact', 'Téléphone', 'Email', 'Flags', 'Sites', 'Actions'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setCustomerId(c.id)} className="font-semibold text-surface-900 hover:text-brand-600 hover:underline" title="Ouvrir la fiche client">{c.name}</button>
                      {c.vip && <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-bold">VIP</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{c.contact || '—'}</td>
                  <td className="px-4 py-3 text-surface-500 text-xs font-mono">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{c.email || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.requiresDeposit && <span className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1 py-0.5">Acompte</span>}
                      {c.ecoResponsable && <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1 py-0.5">Eco</span>}
                      {c.requiresBsd && <span className="text-[9px] bg-violet-50 text-violet-700 border border-violet-200 rounded px-1 py-0.5">BSD</span>}
                      {c.voucherRequired && <span className="text-[9px] bg-surface-100 text-surface-600 border border-surface-200 rounded px-1 py-0.5">Bons</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-surface-400 text-xs">{c.clientSites?.length || 0} site{(c.clientSites?.length || 0) !== 1 ? 's' : ''}</td>
                  {!readOnly && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Btn onClick={() => setModal({ kind: 'edit', client: c })} variant="ghost" size="xs">Modifier</Btn>
                        <Btn onClick={() => handleDelete(c.id)} variant="danger" size="xs">Archiver</Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && <ClientFormModal mode={modal} onClose={() => setModal(null)} onSaved={() => { invalidateClientCache('/api/clients'); load() }} />}
      {customerId && <CustomerPanel clientId={customerId} onClose={() => setCustomerId(null)} />}
    </div>
  )
}

function ClientFormModal({ mode, onClose, onSaved }: {
  mode: { kind: 'new' } | { kind: 'edit'; client: CatalogClient }
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = mode.kind === 'edit'
  const init = isEdit ? mode.client : { name: '', contact: '', phone: '', email: '', vip: false, requiresDeposit: false, ecoResponsable: false, requiresBsd: false, voucherRequired: false, notes: '', siret: '', billingAddress: '', externalRef: '', sector: '', contractStart: null as string | null, contractEnd: null as string | null, paymentTermsDays: 30 }

  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!form.name.trim()) { setError('Le nom est obligatoire'); return }
    setSaving(true)
    setError('')
    try {
      const url = isEdit ? `/api/clients/${mode.client.id}` : '/api/clients'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); const e = d?.error; throw new Error(typeof e === 'string' ? e : 'Erreur serveur') }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={isEdit ? 'Modifier le client' : 'Nouveau client'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nom *"><Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex: Bouygues" /></Field>
        <Field label="Contact"><Input value={form.contact} onChange={v => setForm(f => ({ ...f, contact: v }))} placeholder="Nom du contact" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Téléphone"><Input value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="06..." /></Field>
        <Field label="Email"><Input value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="email@..." /></Field>
      </div>

      <div className="flex flex-wrap gap-3 py-2">
        {([
          { key: 'vip', label: 'VIP' },
          { key: 'requiresDeposit', label: 'Acompte' },
          { key: 'ecoResponsable', label: 'Eco-Responsable' },
          { key: 'requiresBsd', label: 'BSD' },
          { key: 'voucherRequired', label: 'Remise bons' },
        ] as const).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1.5 text-sm text-surface-600 cursor-pointer select-none">
            <input type="checkbox" checked={!!(form as Record<string, unknown>)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
            {label}
          </label>
        ))}
      </div>

      <Field label="Notes"><Textarea value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Notes..." rows={2} /></Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="SIRET"><Input value={(form as CatalogClient).siret ?? ''} onChange={v => setForm(f => ({ ...f, siret: v }))} placeholder="12345678901234" /></Field>
        <Field label="Secteur"><Input value={(form as CatalogClient).sector ?? ''} onChange={v => setForm(f => ({ ...f, sector: v }))} placeholder="Zone géographique" /></Field>
      </div>
      <Field label="Adresse de facturation"><Input value={(form as CatalogClient).billingAddress ?? ''} onChange={v => setForm(f => ({ ...f, billingAddress: v }))} placeholder="1 rue de la Paix, 75001 Paris" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Réf. externe (ERP)"><Input value={(form as CatalogClient).externalRef ?? ''} onChange={v => setForm(f => ({ ...f, externalRef: v }))} placeholder="REF-001" /></Field>
        <Field label="Délai paiement (jours)"><Input type="number" min="0" max="365" value={String((form as CatalogClient).paymentTermsDays ?? 30)} onChange={v => setForm(f => ({ ...f, paymentTermsDays: parseInt(v) || 30 }))} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Début contrat"><Input type="date" value={(form as CatalogClient).contractStart ? ((form as CatalogClient).contractStart as string).slice(0, 10) : ''} onChange={v => setForm(f => ({ ...f, contractStart: v ? new Date(v).toISOString() : null }))} /></Field>
        <Field label="Fin contrat"><Input type="date" value={(form as CatalogClient).contractEnd ? ((form as CatalogClient).contractEnd as string).slice(0, 10) : ''} onChange={v => setForm(f => ({ ...f, contractEnd: v ? new Date(v).toISOString() : null }))} /></Field>
      </div>

      {error && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Btn onClick={onClose} variant="ghost" size="sm">Annuler</Btn>
        <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving}>
          {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
        </Btn>
      </div>
    </Modal>
  )
}

function SitesPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { error: toastError } = useToast()
  const [sites, setSites] = useState<CatalogSite[]>([])
  const [clients, setClients] = useState<CatalogClient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; site: CatalogSite } | null>(null)

  function load() {
    setLoading(true)
    Promise.all([
      fetchAllPages<CatalogSite>('/api/sites'),
      fetchAllPages<CatalogClient>('/api/clients'),
    ]).then(([s, c]) => {
      setSites(s)
      setClients(c)
    }).catch(logErr('sites')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const [sectorFilter, setSectorFilter] = useState('all')
  const siteSectors = useMemo(() => [...new Set(sites.map(s => s.sector).filter(Boolean))].sort(), [sites])

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return sites.filter(s => {
      if (q && !`${s.name} ${s.address} ${s.sector}`.toLowerCase().includes(q)) return false
      if (sectorFilter !== 'all' && s.sector !== sectorFilter) return false
      return true
    })
  }, [sites, debouncedSearch, sectorFilter])

  async function handleDelete(id: string) {
    if (!confirm('Archiver ce site ?')) return
    try {
      const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toastError((d as { error?: string }).error || 'Erreur') }
    } catch { toastError('Erreur réseau') }
    load()
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-100 flex-shrink-0">
        <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{filtered.length} site{filtered.length !== 1 ? 's' : ''}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
          className="bg-surface-50 border border-surface-200 rounded-lg px-3 py-1.5 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-brand-500 w-40" />
        <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} title="Filtrer par secteur"
          className="bg-surface-50 border border-surface-200 rounded-lg px-2 py-1.5 text-surface-900 text-xs focus:outline-none focus:border-brand-500">
          <option value="all">Tous secteurs</option>
          {siteSectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-2">
            <ImportExportBar
              columns={SITE_COLUMNS}
              data={filtered}
              filename="sites"
              parseRows={parseSiteRows}
              needsGeocode
              onImport={async (items) => {
                let failed = 0
                for (const [i, s] of items.entries()) {
                  if (i > 0) await sleep(250)
                  const res = await fetch('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
                  if (!res.ok) failed++
                }
                load()
                if (failed > 0) throw new Error(`${failed} sur ${items.length} site(s) n'ont pas pu être importés.`)
              }}
            />
            <Btn onClick={() => setModal({ kind: 'new' })} variant="primary" size="sm">+ Nouveau site</Btn>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-surface-400 text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-surface-400 gap-2">
            <div className="text-3xl">📍</div>
            <div className="text-sm">Aucun site</div>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-surface-50 z-10">
              <tr>
                {['Site', 'Adresse', 'GPS', 'Secteur', 'Clients liés', 'Accès', 'Actions'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
                  <td className="px-4 py-3 font-semibold text-surface-900">{s.name}</td>
                  <td className="px-4 py-3 text-surface-500 text-xs max-w-[200px] truncate">{s.address || '—'}</td>
                  <td className="px-4 py-3">
                    {s.latitude !== 0 ? (
                      <span className="text-xs text-emerald-600 font-medium">OK</span>
                    ) : (
                      <span className="text-xs text-red-500 font-medium">KO</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{s.sector || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.clientSites?.map(cs => (
                        <span key={cs.client.id} className="text-[9px] bg-brand-50 text-brand-500 border border-brand-200 rounded px-1.5 py-0.5 font-medium">{cs.client.name}</span>
                      ))}
                      {(!s.clientSites || s.clientSites.length === 0) && <span className="text-surface-300 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-surface-400 text-xs max-w-[150px] truncate">{s.accessNotes || '—'}</td>
                  {!readOnly && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Btn onClick={() => setModal({ kind: 'edit', site: s })} variant="ghost" size="xs">Modifier</Btn>
                        <Btn onClick={() => handleDelete(s.id)} variant="danger" size="xs">Archiver</Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && <SiteFormModal mode={modal} clients={clients} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  )
}

function SiteFormModal({ mode, clients, onClose, onSaved }: {
  mode: { kind: 'new' } | { kind: 'edit'; site: CatalogSite }
  clients: CatalogClient[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = mode.kind === 'edit'
  const init = isEdit ? { ...mode.site, clientIds: mode.site.clientSites?.map(cs => cs.client.id) || [] }
    : { name: '', address: '', latitude: 0, longitude: 0, accessNotes: '', defaultManeuverMin: 15, sector: '',
        city: '', zipCode: '', country: 'FR', siteType: '', openingHoursOpen: null as number | null, openingHoursClose: null as number | null,
        clientIds: [] as string[] }

  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [geocoding, setGeocoding] = useState(false)

  async function handleGeocode() {
    const q = form.address.trim() || form.name.trim()
    if (!q) return
    setGeocoding(true)
    try {
      const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`)
      const data = await res.json()
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates
        setForm(f => ({ ...f, latitude: lat, longitude: lng }))
      }
    } catch {  }
    finally { setGeocoding(false) }
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Le nom est obligatoire'); return }
    setSaving(true)
    setError('')
    try {
      const url = isEdit ? `/api/sites/${mode.site.id}` : '/api/sites'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); const e = d?.error; throw new Error(typeof e === 'string' ? e : 'Erreur serveur') }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? 'Modifier le site' : 'Nouveau site'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nom du site *"><Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex: Centre Commercial Divonne" /></Field>
        <Field label="Secteur"><Input value={form.sector} onChange={v => setForm(f => ({ ...f, sector: v }))} placeholder="Zone geographique" /></Field>
      </div>
      <Field label="Adresse">
        <div className="flex gap-2">
          <Input value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="Adresse complète" />
          <button type="button" onClick={handleGeocode} disabled={geocoding}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap">
            {geocoding ? '...' : 'GPS'}
          </button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude"><Input type="number" value={String(form.latitude)} onChange={v => setForm(f => ({ ...f, latitude: parseFloat(v) || 0 }))} /></Field>
        <Field label="Longitude"><Input type="number" value={String(form.longitude)} onChange={v => setForm(f => ({ ...f, longitude: parseFloat(v) || 0 }))} /></Field>
      </div>
      <Field label="Notes d'accès"><Textarea value={form.accessNotes} onChange={v => setForm(f => ({ ...f, accessNotes: v }))} placeholder="Portail code 1234, rue étroite..." rows={2} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Ville"><Input value={form.city ?? ''} onChange={v => setForm(f => ({ ...f, city: v }))} placeholder="Lyon" /></Field>
        <Field label="Code postal"><Input value={form.zipCode ?? ''} onChange={v => setForm(f => ({ ...f, zipCode: v }))} placeholder="69001" /></Field>
        <Field label="Pays"><Input value={form.country ?? 'FR'} onChange={v => setForm(f => ({ ...f, country: v }))} placeholder="FR" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type de site">
          <SelectInput value={form.siteType ?? ''} onChange={v => setForm(f => ({ ...f, siteType: v }))} options={[
            { value: '', label: '-- Non précisé --' },
            { value: 'chantier', label: 'Chantier' },
            { value: 'entrepot', label: 'Entrepôt' },
            { value: 'usine', label: 'Usine' },
            { value: 'bureau', label: 'Bureau' },
            { value: 'autre', label: 'Autre' },
          ]} />
        </Field>
        <Field label="Temps manoeuvre par défaut (min)"><Input type="number" value={String(form.defaultManeuverMin)} onChange={v => setForm(f => ({ ...f, defaultManeuverMin: parseInt(v) || 15 }))} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Heure ouverture (hhmm ex: 480=08h00)"><Input type="number" value={form.openingHoursOpen !== null && form.openingHoursOpen !== undefined ? String(form.openingHoursOpen) : ''} placeholder="480" onChange={v => setForm(f => ({ ...f, openingHoursOpen: v ? parseInt(v) : null }))} /></Field>
        <Field label="Heure fermeture (hhmm ex: 1080=18h00)"><Input type="number" value={form.openingHoursClose !== null && form.openingHoursClose !== undefined ? String(form.openingHoursClose) : ''} placeholder="1080" onChange={v => setForm(f => ({ ...f, openingHoursClose: v ? parseInt(v) : null }))} /></Field>
      </div>

      <Field label="Clients liés">
        <div className="flex flex-wrap gap-2">
          {clients.filter(c => !c.archived).map(c => {
            const selected = form.clientIds.includes(c.id)
            return (
              <button key={c.id} type="button" onClick={() => setForm(f => ({
                ...f, clientIds: selected ? f.clientIds.filter(id => id !== c.id) : [...f.clientIds, c.id],
              }))}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                  ${selected ? 'bg-brand-50 text-brand-500 border-brand-200' : 'bg-surface-50 text-surface-500 border-surface-200 hover:border-surface-300'}`}>
                {c.name}
              </button>
            )
          })}
        </div>
      </Field>

      {error && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Btn onClick={onClose} variant="ghost" size="sm">Annuler</Btn>
        <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving}>
          {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
        </Btn>
      </div>
    </Modal>
  )
}

function ProductsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { error: toastError } = useToast()
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [clients, setClients] = useState<CatalogClient[]>([])
  const [sites, setSites] = useState<CatalogSite[]>([])
  const [exutoires, setExutoires] = useState<Exutoire[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [clientFilter, setClientFilter] = useState('')
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; product: CatalogProduct } | null>(null)

  function load() {
    setLoading(true)
    Promise.all([
      fetch('/api/site-products').then(r => r.json()),
      fetchAllPages<CatalogClient>('/api/clients'),
      fetchAllPages<CatalogSite>('/api/sites'),
      cachedFetch<Exutoire[] | { data?: Exutoire[] }>('/api/exutoires', 60_000),
    ]).then(([p, c, s, e]) => {
      setProducts(Array.isArray(p) ? p : p?.data ?? [])
      setClients(c)
      setSites(s)
      setExutoires(Array.isArray(e) ? e : e?.data ?? [])
    }).catch(logErr('products')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let result = products
    if (clientFilter) result = result.filter(p => p.clientId === clientFilter)
    const q = debouncedSearch.toLowerCase()
    if (q) result = result.filter(p => `${p.wasteType} ${p.binSizeLabel} ${p.client?.name} ${p.site?.name}`.toLowerCase().includes(q))
    return result
  }, [products, clientFilter, debouncedSearch])

  async function handleDelete(id: string) {
    if (!confirm('Archiver ce produit ?')) return
    try {
      const res = await fetch(`/api/site-products/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toastError((d as { error?: string }).error || 'Erreur') }
    } catch { toastError('Erreur réseau') }
    load()
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-100 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{filtered.length} produit{filtered.length !== 1 ? 's' : ''}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
          className="bg-surface-50 border border-surface-200 rounded-lg px-3 py-1.5 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-brand-500 w-48" />
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} title="Filtrer par client"
          className="bg-surface-50 border border-surface-200 rounded-lg px-3 py-1.5 text-surface-900 text-sm focus:outline-none focus:border-brand-500">
          <option value="">Tous les clients</option>
          {clients.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {!readOnly && (
          <div className="ml-auto">
            <Btn onClick={() => setModal({ kind: 'new' })} variant="primary" size="sm">+ Nouveau produit</Btn>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-surface-400 text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-surface-400 gap-2">
            <div className="text-3xl">📦</div>
            <div className="text-sm">Aucun produit</div>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-surface-50 z-10">
              <tr>
                {['Client', 'Site', 'Matière', 'Matériel', 'Volume', 'Durée', 'Exutoire', 'Actions'].map(h => (
                  <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
                  <td className="px-4 py-3">
                    <span className="font-medium text-surface-900">{p.client?.name || '—'}</span>
                    {p.client?.vip && <span className="ml-1 text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1 py-0.5">VIP</span>}
                  </td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{p.site?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 text-[11px] font-medium">{p.wasteType}</span>
                  </td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{p.binSizeLabel || p.equipmentType || '—'}</td>
                  <td className="px-4 py-3 text-surface-500 text-xs font-mono">{p.binSizeM3 ? `${p.binSizeM3} m³` : '—'}</td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{p.defaultDurationMin} min</td>
                  <td className="px-4 py-3 text-surface-500 text-xs">{p.defaultExutoire?.name || '—'}</td>
                  {!readOnly && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Btn onClick={() => setModal({ kind: 'edit', product: p })} variant="ghost" size="xs">Modifier</Btn>
                        <Btn onClick={() => handleDelete(p.id)} variant="danger" size="xs">Archiver</Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && <ProductFormModal mode={modal} clients={clients} sites={sites} exutoires={exutoires} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  )
}

function ProductFormModal({ mode, clients, sites, exutoires, onClose, onSaved }: {
  mode: { kind: 'new' } | { kind: 'edit'; product: CatalogProduct }
  clients: CatalogClient[]
  sites: CatalogSite[]
  exutoires: Exutoire[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = mode.kind === 'edit'
  const init = isEdit ? mode.product : {
    clientId: '', siteId: '', wasteType: '', binSizeLabel: '', binSizeM3: null as number | null,
    equipmentType: '', defaultDurationMin: 30, defaultExutoireId: '', notes: '',
  }

  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const linkedSites = useMemo(() => {
    if (!form.clientId) return sites.filter(s => !s.archived)
    const client = clients.find(c => c.id === form.clientId)
    const siteIds = new Set(client?.clientSites?.map(cs => cs.site.id) || [])
    if (siteIds.size === 0) return sites.filter(s => !s.archived)
    return sites.filter(s => siteIds.has(s.id) && !s.archived)
  }, [form.clientId, clients, sites])

  async function handleSave() {
    if (!form.clientId || !form.siteId || !form.wasteType.trim()) {
      setError('Client, site et matière sont obligatoires')
      return
    }
    setSaving(true)
    setError('')
    try {
      const url = isEdit ? `/api/site-products/${mode.product.id}` : '/api/site-products'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, defaultExutoireId: form.defaultExutoireId || null }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); const e = d?.error; throw new Error(typeof e === 'string' ? e : 'Erreur serveur') }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? 'Modifier le produit' : 'Nouveau produit'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client *">
          <SelectInput value={form.clientId} onChange={v => setForm(f => ({ ...f, clientId: v }))}
            options={[{ value: '', label: '-- Choisir --' }, ...clients.filter(c => !c.archived).map(c => ({ value: c.id, label: c.name }))]} />
        </Field>
        <Field label="Site *">
          <SelectInput value={form.siteId} onChange={v => setForm(f => ({ ...f, siteId: v }))}
            options={[{ value: '', label: '-- Choisir --' }, ...linkedSites.map(s => ({ value: s.id, label: s.name }))]} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Matière (déchet) *"><Input value={form.wasteType} onChange={v => setForm(f => ({ ...f, wasteType: v }))} placeholder="Gravats, DIB, Papier..." /></Field>
        <Field label="Matériel (libelle)"><Input value={form.binSizeLabel} onChange={v => setForm(f => ({ ...f, binSizeLabel: v }))} placeholder="Benne 35m³" /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Volume (m³)"><Input type="number" value={form.binSizeM3 !== null ? String(form.binSizeM3) : ''} onChange={v => setForm(f => ({ ...f, binSizeM3: v ? parseFloat(v) : null }))} placeholder="35" /></Field>
        <Field label="Type equipement"><Input value={form.equipmentType} onChange={v => setForm(f => ({ ...f, equipmentType: v }))} placeholder="ampliroll, grue..." /></Field>
        <Field label="Durée par défaut (min)"><Input type="number" value={String(form.defaultDurationMin)} onChange={v => setForm(f => ({ ...f, defaultDurationMin: parseInt(v) || 30 }))} /></Field>
      </div>
      <Field label="Exutoire par défaut">
        <SelectInput value={form.defaultExutoireId || ''} onChange={v => setForm(f => ({ ...f, defaultExutoireId: v }))}
          options={[{ value: '', label: '-- Aucun --' }, ...exutoires.map(e => ({ value: e.id, label: e.name }))]} />
      </Field>
      <Field label="Notes"><Textarea value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Notes..." rows={2} /></Field>

      {error && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Btn onClick={onClose} variant="ghost" size="sm">Annuler</Btn>
        <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving}>
          {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
        </Btn>
      </div>
    </Modal>
  )
}
