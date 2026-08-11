'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import { Mission, MissionType, CatalogClient, CatalogProduct, Exutoire } from '@/lib/types'
import { Modal, Field, Input, SelectInput, Textarea, Btn } from './ui'
import { MiniMap } from '@/components/ui/MiniMap'
import { useTrade } from '@/providers/TradeProvider'
import { cachedFetch } from '@/lib/clientCache'
import { JargonTip } from '@/components/ui/Tooltip'

const SKILL_OPTIONS = ['permis_C', 'permis_CE', 'CACES', 'grue', 'HAZMAT', 'ADR']

export function MissionForm({ initial, onSave, onClose, title }: {
  initial: Omit<Mission, 'id'>
  onSave: (_d: Omit<Mission, 'id'>) => void
  onClose: () => void
  title: string
}) {
  const { missionLabel, missionIcon, enabledTypes, vocab } = useTrade()
  const typeOpts = enabledTypes.map(t => ({ value: t, label: `${missionIcon(t)} ${missionLabel(t)}` }))

  const [form, setForm] = useState(initial)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'catalogue' | 'manual'>('catalogue')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMsg, setGeocodeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const set = (k: keyof Mission) => (v: string) => setForm(p => ({ ...p, [k]: v }))
  const setN = (k: keyof Mission) => (v: string) => setForm(p => ({ ...p, [k]: parseFloat(v) || 0 }))
  const geocodeCtrlRef = useRef<AbortController | null>(null)

  const [clients, setClients] = useState<CatalogClient[]>([])
  const [allProducts, setAllProducts] = useState<CatalogProduct[]>([])
  const [selectedClientId, setSelectedClientId] = useState(initial.clientId ?? '')
  const [selectedSiteId, setSelectedSiteId] = useState(initial.siteId ?? '')
  const [selectedProductId, setSelectedProductId] = useState(initial.productId ?? '')
  const [clientSearch, setClientSearch] = useState(initial.clientName ?? '')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const clientInputRef = useRef<HTMLInputElement>(null)

  const [exutoires, setExutoires] = useState<Exutoire[]>([])

  useEffect(() => {
    Promise.all([
      cachedFetch<CatalogClient[] | { data?: CatalogClient[] }>('/api/clients', 30_000),
      fetch('/api/site-products').then(r => r.json()),
      cachedFetch<Exutoire[] | { data?: Exutoire[] }>('/api/exutoires', 60_000),
    ]).then(([c, p, ex]) => {
      setClients(Array.isArray(c) ? c : c?.data ?? [])
      setAllProducts(Array.isArray(p) ? p : p?.data ?? [])
      setExutoires(Array.isArray(ex) ? ex : ex?.data ?? [])
    }).catch(() => {})
  }, [])

  const clientFuse = useMemo(() => new Fuse(clients.filter(c => !c.archived), {
    keys: ['name', 'contact', 'email'],
    threshold: 0.4,
    distance: 100,
  }), [clients])

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.filter(c => !c.archived)
    return clientFuse.search(clientSearch).map(r => r.item)
  }, [clients, clientSearch, clientFuse])

  const clientSites = useMemo(() => {
    if (!selectedClientId) return []
    const client = clients.find(c => c.id === selectedClientId)
    return client?.clientSites?.map(cs => cs.site) || []
  }, [selectedClientId, clients])

  const availableProducts = useMemo(() => {
    return allProducts.filter(p =>
      p.clientId === selectedClientId &&
      p.siteId === selectedSiteId &&
      !p.archived
    )
  }, [allProducts, selectedClientId, selectedSiteId])

  function handleSelectClient(client: CatalogClient) {
    setSelectedClientId(client.id)
    setClientSearch(client.name)
    setShowClientDropdown(false)
    setSelectedSiteId('')
    setSelectedProductId('')
    setForm(p => ({ ...p, clientId: client.id, clientName: client.name }))
  }

  function handleSelectSite(siteId: string) {
    setSelectedSiteId(siteId)
    setSelectedProductId('')
    const site = clientSites.find(s => s.id === siteId)
    if (site) {
      setForm(p => ({
        ...p,
        siteId,
        address: site.address || p.address,
        latitude: site.latitude,
        longitude: site.longitude,
        accessNotes: site.accessNotes,
        maneuverTimeMin: site.defaultManeuverMin || p.maneuverTimeMin,
      }))
    }
  }

  function handleSelectProduct(productId: string) {
    setSelectedProductId(productId)
    const product = allProducts.find(p => p.id === productId)
    if (product) {
      setForm(p => ({
        ...p,
        productId,
        wasteTypeLabel: product.wasteType,
        binSize: product.binSizeLabel,
        binSizeM3: product.binSizeM3 ?? p.binSizeM3,
        equipmentType: product.equipmentType || p.equipmentType,
        estimatedDurationMin: product.defaultDurationMin || p.estimatedDurationMin,
        linkedExutoireId: product.defaultExutoireId || p.linkedExutoireId,

        ...(product.site ? {
          address: product.site.address || p.address,
          latitude: product.site.latitude,
          longitude: product.site.longitude,
          accessNotes: product.site.accessNotes,
          maneuverTimeMin: product.site.defaultManeuverMin || p.maneuverTimeMin,
        } : {}),
      }))
    }
  }

  async function handleGeocode() {
    const q = form.address.trim()
    if (!q) { setGeocodeMsg({ ok: false, text: 'Entrez une adresse d\'abord.' }); return }
    geocodeCtrlRef.current?.abort()
    const ctrl = new AbortController()
    geocodeCtrlRef.current = ctrl
    setGeocoding(true)
    setGeocodeMsg(null)
    try {
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Geocoding error: ${res.status}`)
      const data = await res.json()
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates
        const label = data.features[0].properties.label
        setForm(p => ({ ...p, latitude: lat, longitude: lng }))
        setGeocodeMsg({ ok: true, text: `Trouv\u00e9: ${label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}` })
      } else {
        setGeocodeMsg({ ok: false, text: 'Adresse introuvable' })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setGeocodeMsg({ ok: false, text: 'Erreur réseau.' })
    } finally { setGeocoding(false) }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {}
      <div className="flex bg-surface-100 rounded-lg p-0.5 gap-0.5 mb-2">
        <button type="button" onClick={() => setMode('catalogue')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'catalogue' ? 'bg-white text-surface-900 shadow-soft' : 'text-surface-500 hover:text-surface-700'}`}>
          Depuis le catalogue
        </button>
        <button type="button" onClick={() => setMode('manual')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'manual' ? 'bg-white text-surface-900 shadow-soft' : 'text-surface-500 hover:text-surface-700'}`}>
          Saisie manuelle
        </button>
      </div>

      {}
      {mode === 'catalogue' && (
        <div className="space-y-3 pb-2 border-b border-surface-100 mb-3">
          {}
          <Field label="1. Client">
            <div className="relative">
              <input
                ref={clientInputRef}
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setShowClientDropdown(true); setSelectedClientId(''); setSelectedSiteId(''); setSelectedProductId('') }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Rechercher un client..."
                className="w-full bg-surface-50 border border-surface-200 rounded-lg px-3 py-2 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition-all"
              />
              {showClientDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-surface-200 rounded-xl shadow-elevated z-50 max-h-60 overflow-y-auto">
                  {filteredClients.length === 0 && (
                    <div className="px-3 py-3 text-xs text-surface-400 text-center">Aucun client trouvé</div>
                  )}
                  {filteredClients.slice(0, 20).map(c => (
                    <button key={c.id} type="button" onClick={() => handleSelectClient(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-50 transition-colors flex items-center gap-2">
                      <span className="font-medium text-surface-900">{c.name}</span>
                      {c.vip && <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1 py-0.5">VIP</span>}
                      <span className="text-surface-400 text-xs ml-auto">{c.clientSites?.length || 0} site{(c.clientSites?.length || 0) !== 1 ? 's' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          {}
          {selectedClientId && (
            <Field label="2. Site">
              <SelectInput
                value={selectedSiteId}
                onChange={handleSelectSite}
                options={[
                  { value: '', label: '-- Choisir un site --' },
                  ...clientSites.map(s => ({ value: s.id, label: `${s.name}${s.address ? ` — ${s.address}` : ''}` })),
                ]}
              />
            </Field>
          )}

          {}
          {selectedSiteId && (
            <Field label={`3. Produit (${vocab.wasteType.toLowerCase()} + ${vocab.binSize.toLowerCase()})`}>
              {availableProducts.length > 0 ? (
                <div className="grid grid-cols-1 gap-1.5">
                  {availableProducts.map(p => (
                    <button key={p.id} type="button" onClick={() => handleSelectProduct(p.id)}
                      className={`text-left px-3 py-2 rounded-lg border transition-all text-sm
                        ${selectedProductId === p.id
                          ? 'bg-brand-50 border-brand-200 text-brand-700'
                          : 'bg-surface-50 border-surface-200 text-surface-600 hover:border-surface-300'}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.wasteType}</span>
                        {p.binSizeLabel && <span className="text-xs text-surface-400">{p.binSizeLabel}</span>}
                        {p.binSizeM3 && <span className="text-xs text-surface-400">({p.binSizeM3} m³)</span>}
                      </div>
                      {p.defaultExutoire && <div className="text-xs text-surface-400 mt-0.5">{vocab.exutoire}: {p.defaultExutoire.name}</div>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-surface-400 text-xs py-2">Aucun produit configure pour ce client sur ce site. Ajoutez-en dans le Catalogue.</p>
              )}
            </Field>
          )}
        </div>
      )}

      {}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type d'operation">
          <SelectInput value={form.type} onChange={v => setForm(p => ({ ...p, type: v as MissionType }))} options={typeOpts} />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={set('date')} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={<span>Priorite <JargonTip term="p1" position="right" /></span>}>
          <SelectInput
            value={form.priority !== null && form.priority !== undefined ? String(form.priority) : '2'}
            onChange={v => setForm(p => ({ ...p, priority: v ? (Number(v) as 1 | 2 | 3) : undefined }))}
            options={[
              { value: '2', label: 'P2 — Normal (défaut)' },
              { value: '1', label: 'P1 — Urgent (avant 10h)' },
              { value: '3', label: 'P3 — Flexible' },
            ]}
          />
        </Field>
        <Field label="Equipement">
          <Input value={form.equipmentType || ''} onChange={v => setForm(p => ({ ...p, equipmentType: v }))} placeholder="ampliroll, grue..." />
        </Field>
      </div>

      {}
      {mode === 'manual' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <Input value={form.clientName || ''} onChange={set('clientName')} placeholder="Nom client" />
            </Field>
            <Field label="Adresse">
              <div className="flex gap-2">
                <Input value={form.address} onChange={v => { set('address')(v); setGeocodeMsg(null) }} placeholder="Adresse complete" />
                <button type="button" onClick={handleGeocode} disabled={geocoding}
                  className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 transition-colors">
                  {geocoding ? '...' : '\ud83d\udccd G\u00e9ocoder'}
                </button>
              </div>
              {geocodeMsg && (
                <div className={`mt-1 text-[10px] ${geocodeMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {geocodeMsg.ok ? '\u2713' : '\u2717'} {geocodeMsg.text}
                </div>
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude"><Input type="number" value={String(form.latitude)} onChange={setN('latitude')} /></Field>
            <Field label="Longitude"><Input type="number" value={String(form.longitude)} onChange={setN('longitude')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={vocab.wasteType}><Input value={form.wasteTypeLabel || ''} onChange={set('wasteTypeLabel')} placeholder="Gravats, DIB..." /></Field>
            <Field label={vocab.binSize}><Input value={form.binSize || ''} onChange={set('binSize')} placeholder="Benne 35m³" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Volume (m³)">
              <Input type="number" step="0.5" value={form.binSizeM3 !== null ? String(form.binSizeM3) : ''} onChange={v => setForm(p => ({ ...p, binSizeM3: v ? parseFloat(v) : undefined }))} />
            </Field>
            <Field label="Notes d'acces">
              <Input value={form.accessNotes || ''} onChange={set('accessNotes')} placeholder="Code portail..." />
            </Field>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Duree sur place (min)">
          <Input type="number" value={String(form.estimatedDurationMin)} onChange={setN('estimatedDurationMin')} min="0" />
        </Field>
        <Field label="Manoeuvre (min)">
          <Input type="number" value={String(form.maneuverTimeMin)} onChange={setN('maneuverTimeMin')} min="0" />
        </Field>
      </div>

      {}
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
          <input type="checkbox"
            checked={!!form.timeWindow}
            onChange={e => setForm(p => ({
              ...p,
              timeWindow: e.target.checked ? { openMin: 8 * 60, closeMin: 17 * 60 } : undefined,
            }))} />
          <span className="text-xs font-medium text-surface-700">Créneau horaire client</span>
        </label>
        {form.timeWindow && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ouverture">
              <Input type="time"
                value={`${String(Math.floor(form.timeWindow.openMin / 60)).padStart(2, '0')}:${String(form.timeWindow.openMin % 60).padStart(2, '0')}`}
                onChange={v => {
                  const [h, m] = v.split(':').map(Number)
                  setForm(p => ({ ...p, timeWindow: { ...p.timeWindow!, openMin: (h || 0) * 60 + (m || 0) } }))
                }} />
            </Field>
            <Field label="Fermeture">
              <Input type="time"
                value={`${String(Math.floor(form.timeWindow.closeMin / 60)).padStart(2, '0')}:${String(form.timeWindow.closeMin % 60).padStart(2, '0')}`}
                onChange={v => {
                  const [h, m] = v.split(':').map(Number)
                  setForm(p => ({ ...p, timeWindow: { ...p.timeWindow!, closeMin: (h || 0) * 60 + (m || 0) } }))
                }} />
            </Field>
          </div>
        )}
      </div>

      {}
      {(form.type === 'RETIRER' || form.type === 'ECHANGER' || form.type === 'ALLER_RETOUR' || form.type === 'CHARGER_IMMEDIAT') && (
        <Field label={`${vocab.exutoire}${form.type === 'ALLER_RETOUR' ? ' (obligatoire)' : ''}`}>
          <SelectInput
            value={form.linkedExutoireId || ''}
            onChange={v => setForm(p => ({ ...p, linkedExutoireId: v || undefined }))}
            options={[
              { value: '', label: `-- Aucun ${vocab.exutoire.toLowerCase()} --` },
              ...exutoires.map(ex => ({ value: ex.id, label: `${ex.name} — ${ex.address}` })),
            ]}
          />
        </Field>
      )}

      {}
      <Field label="Compétences requises">
        <div className="flex flex-wrap gap-2 pt-0.5">
          {SKILL_OPTIONS.map(skill => {
            const checked = (form.requiredSkills ?? []).includes(skill)
            return (
              <label key={skill} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-all select-none
                ${checked
                  ? 'bg-brand-50 border-brand-200 text-brand-700'
                  : 'bg-surface-50 border-surface-200 text-surface-600 hover:border-surface-300'}`}>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  onChange={() => {
                    setForm(p => {
                      const current = p.requiredSkills ?? []
                      const next = checked
                        ? current.filter(s => s !== skill)
                        : [...current, skill]
                      return { ...p, requiredSkills: next.length > 0 ? next : undefined }
                    })
                  }}
                />
                {checked ? '✓ ' : ''}{skill}
              </label>
            )
          })}
        </div>
      </Field>

      <Field label="Notes"><Textarea value={form.notes || ''} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Observations..." rows={2} /></Field>

      {}
      {mode === 'catalogue' && (
        <Field label="Adresse (override)">
          <div className="flex gap-2">
            <Input value={form.address} onChange={v => { set('address')(v); setGeocodeMsg(null) }} placeholder="Adresse complete" />
            <button type="button" onClick={handleGeocode} disabled={geocoding}
              className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap">
              {geocoding ? '...' : '\ud83d\udccd G\u00e9ocoder'}
            </button>
          </div>
          {geocodeMsg && (
            <div className={`mt-1 text-[10px] ${geocodeMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {geocodeMsg.ok ? '\u2713' : '\u2717'} {geocodeMsg.text}
            </div>
          )}
        </Field>
      )}

      {}
      {mode === 'catalogue' && (form.address || form.latitude !== 0) && (
        <div className="bg-surface-50 rounded-lg p-3 text-xs text-surface-500 space-y-1">
          <div className="font-medium text-surface-700 text-[11px] uppercase tracking-wider mb-1">Donnees auto-remplies</div>
          {form.latitude !== 0 && <div>GPS: <span className="text-surface-900">{form.latitude.toFixed(4)}, {form.longitude.toFixed(4)}</span></div>}
          {form.wasteTypeLabel && <div>Matiere: <span className="text-surface-900">{form.wasteTypeLabel}</span></div>}
          {form.binSize && <div>Materiel: <span className="text-surface-900">{form.binSize}</span></div>}
          {form.accessNotes && <div>Acces: <span className="text-surface-900">{form.accessNotes}</span></div>}
        </div>
      )}

      {}
      {form.latitude !== 0 && form.longitude !== 0 && (
        <MiniMap lat={form.latitude} lng={form.longitude} className="mt-2" />
      )}

      {Object.keys(fieldErrors).length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
          {Object.entries(fieldErrors).map(([k, v]) => (
            <p key={k} className="text-red-600 text-xs">{v}</p>
          ))}
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <Btn onClick={async () => {
          const errs: Record<string, string> = {}
          if (!form.type) errs.type = 'Le type de mission est requis'
          if (!form.date) errs.date = 'La date est requise'
          if (!form.address || form.address.trim().length === 0) errs.address = "L'adresse est requise"
          if (form.latitude === 0 && form.longitude === 0) errs.gps = 'Les coordonnées GPS sont requises (géocodez l\'adresse)'
          if (form.estimatedDurationMin <= 0) errs.duration = 'La durée estimée doit être > 0'
          setFieldErrors(errs)
          if (Object.keys(errs).length > 0) return
          setIsSaving(true)
          try { await Promise.resolve(onSave(form)) }
          finally { setIsSaving(false) }
        }} variant="primary" disabled={isSaving}>
          {isSaving ? (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Enregistrement…
            </span>
          ) : 'Enregistrer'}
        </Btn>
        <Btn onClick={onClose} variant="ghost" disabled={isSaving}>Annuler</Btn>
      </div>
    </Modal>
  )
}
