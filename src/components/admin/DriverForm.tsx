'use client'

import { useState, useRef, useEffect } from 'react'
import { Driver, Exutoire } from '@/lib/types'
import { Modal, Field, Input, SelectInput, Btn } from './ui'
import { cachedFetch } from '@/lib/clientCache'

export function DriverForm({ initial, onSave, onClose, title }: {
  initial: Omit<Driver, 'id'>
  onSave: (_d: Omit<Driver, 'id'>) => void
  onClose: () => void
  title: string
}) {
  const [form, setForm] = useState(initial)
  const [departureMode, setDepartureMode] = useState<'home' | 'exutoire'>(
    initial.startingExutoireId ? 'exutoire' : 'home'
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMsg, setGeocodeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [exutoires, setExutoires] = useState<Exutoire[]>([])
  const set = (k: keyof Driver) => (v: string) => setForm(p => ({ ...p, [k]: v }))
  const setN = (k: keyof Driver) => (v: string) => setForm(p => ({ ...p, [k]: parseFloat(v) || 0 }))
  const geocodeCtrlRef = useRef<AbortController | null>(null)

  useEffect(() => {
    cachedFetch<Exutoire[] | { data?: Exutoire[] }>('/api/exutoires', 60_000).then(data => {
      setExutoires(Array.isArray(data) ? data : (data as { data?: Exutoire[] })?.data ?? [])
    }).catch(() => {})
  }, [])

  async function handleGeocodeDepot() {
    const q = form.depotName.trim()
    if (!q) { setGeocodeMsg({ ok: false, text: 'Entrez un nom de dépôt d\'abord.' }); return }
    geocodeCtrlRef.current?.abort()
    const ctrl = new AbortController()
    geocodeCtrlRef.current = ctrl
    setGeocoding(true); setGeocodeMsg(null)
    try {
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Geocoding error: ${res.status}`)
      const data = await res.json()
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates
        setForm(p => ({ ...p, depotLat: lat, depotLng: lng }))
        setGeocodeMsg({ ok: true, text: `GPS trouvé : ${lat.toFixed(4)}, ${lng.toFixed(4)}` })
      } else {
        setGeocodeMsg({ ok: false, text: 'Adresse introuvable.' })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setGeocodeMsg({ ok: false, text: 'Erreur réseau.' })
    }
    finally { setGeocoding(false) }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prénom"><Input value={form.firstName} onChange={set('firstName')} placeholder="Julien" /></Field>
        <Field label="Nom"><Input value={form.lastName} onChange={set('lastName')} placeholder="Martin" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Secteur"><Input value={form.sector} onChange={set('sector')} placeholder="Annecy" /></Field>
      </div>

      {}
      <div>
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Point de départ</span>
        </div>
        <div className="flex gap-1 mb-3">
          {(['home', 'exutoire'] as const).map(mode => (
            <button key={mode} type="button"
              onClick={() => {
                setDepartureMode(mode)
                if (mode === 'home') setForm(p => ({ ...p, startingExutoireId: null }))
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all
                ${departureMode === mode
                  ? 'bg-[#0055A4] text-white border-[#0055A4]'
                  : 'bg-surface-50 text-surface-500 border-surface-200 hover:border-surface-300'}`}>
              {mode === 'home' ? '🏠 Domicile' : '🏭 Exutoire'}
            </button>
          ))}
        </div>

        {departureMode === 'home' && (
          <>
            <Field label="Adresse domicile / dépôt">
              <div className="flex gap-2">
                <Input value={form.depotName} onChange={v => { set('depotName')(v); setGeocodeMsg(null) }} placeholder="12 rue de la Paix, Annecy" />
                <button type="button" onClick={handleGeocodeDepot} disabled={geocoding}
                  title="Géocoder l'adresse"
                  className="flex-shrink-0 px-2 py-1 rounded text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap">
                  {geocoding ? '…' : '📍 GPS'}
                </button>
              </div>
              {geocodeMsg && (
                <div className={`mt-1 text-[10px] ${geocodeMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {geocodeMsg.ok ? '✓' : '✗'} {geocodeMsg.text}
                </div>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lat."><Input type="number" value={String(form.depotLat)} onChange={setN('depotLat')} placeholder="45.948" /></Field>
              <Field label="Lng."><Input type="number" value={String(form.depotLng)} onChange={setN('depotLng')} placeholder="6.147" /></Field>
            </div>
          </>
        )}

        {departureMode === 'exutoire' && (
          <Field label="Exutoire de départ (le chauffeur part et revient ici)">
            <SelectInput
              value={form.startingExutoireId ?? ''}
              onChange={v => {
                const ex = exutoires.find(e => e.id === v)
                setForm(p => ({
                  ...p,
                  startingExutoireId: v || null,
                  ...(ex ? { depotName: ex.name, depotLat: ex.lat, depotLng: ex.lng } : {}),
                }))
              }}
              options={[
                { value: '', label: '-- Sélectionner un exutoire --' },
                ...exutoires.map(ex => ({ value: ex.id, label: `${ex.name} — ${ex.address}` })),
              ]}
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Taille max benne (m³)">
          <Input type="number" step="1" min="1" max="40"
            value={form.maxBinSizeM3 !== null && form.maxBinSizeM3 !== undefined ? String(form.maxBinSizeM3) : ''}
            onChange={v => setForm(p => ({ ...p, maxBinSizeM3: v ? parseFloat(v) : undefined }))}
            placeholder="20" />
        </Field>
        <Field label="Capacité véhicule (nb bennes)">
          <Input type="number" step="1" min="1" max="5"
            value={form.vehicleCapacity !== null && form.vehicleCapacity !== undefined ? String(form.vehicleCapacity) : ''}
            onChange={v => setForm(p => ({ ...p, vehicleCapacity: v ? parseInt(v) : undefined }))}
            placeholder="1" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Téléphone">
          <Input value={form.phone ?? ''} onChange={v => setForm(p => ({ ...p, phone: v || undefined }))} placeholder="+33 6 12 34 56 78" />
        </Field>
        <Field label="Heures max / semaine">
          <Input type="number" step="0.5" min="1" max="60"
            value={form.weeklyHoursMax !== undefined ? String(form.weeklyHoursMax) : ''}
            onChange={v => setForm(p => ({ ...p, weeklyHoursMax: v ? parseFloat(v) : undefined }))}
            placeholder="48" />
        </Field>
      </div>
      <Field label="Notes">
        <Input value={form.notes ?? ''} onChange={v => setForm(p => ({ ...p, notes: v || undefined }))} placeholder="Notes sur le chauffeur…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email">
          <Input type="email" value={form.email ?? ''} onChange={v => setForm(p => ({ ...p, email: v || undefined }))} placeholder="julien.martin@..." />
        </Field>
        <Field label="Matricule">
          <Input value={form.employeeNumber ?? ''} onChange={v => setForm(p => ({ ...p, employeeNumber: v || undefined }))} placeholder="EMP-001" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Date d'embauche">
          <Input type="date" value={form.hiredAt ? form.hiredAt.slice(0, 10) : ''} onChange={v => setForm(p => ({ ...p, hiredAt: v ? new Date(v).toISOString() : undefined }))} />
        </Field>
        <Field label="Date de naissance">
          <Input type="date" value={form.birthDate ? form.birthDate.slice(0, 10) : ''} onChange={v => setForm(p => ({ ...p, birthDate: v ? new Date(v).toISOString() : undefined }))} />
        </Field>
        <Field label="Expiration permis">
          <Input type="date" value={form.licenseExpiry ? form.licenseExpiry.slice(0, 10) : ''} onChange={v => setForm(p => ({ ...p, licenseExpiry: v ? new Date(v).toISOString() : undefined }))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact urgence">
          <Input value={form.emergencyContact ?? ''} onChange={v => setForm(p => ({ ...p, emergencyContact: v || undefined }))} placeholder="Prénom Nom : 06 12 34 56 78" />
        </Field>
        <Field label="Couleur (carte)">
          <Input value={form.color ?? ''} onChange={v => setForm(p => ({ ...p, color: v || undefined }))} placeholder="#4C7DFF" />
        </Field>
      </div>
      <Field label="Catégories de permis">
        <div className="flex flex-wrap gap-2 pt-0.5">
          {(['B', 'C', 'CE', 'D', 'BE'] as const).map(cat => {
            const checked = (form.licenseCategories ?? []).includes(cat)
            return (
              <label key={cat} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-all select-none ${checked ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-surface-50 border-surface-200 text-surface-600 hover:border-surface-300'}`}>
                <input type="checkbox" className="hidden" checked={checked} onChange={() => {
                  setForm(p => {
                    const current = p.licenseCategories ?? []
                    const next = checked ? current.filter(c => c !== cat) : [...current, cat]
                    return { ...p, licenseCategories: next.length > 0 ? next : undefined }
                  })
                }} />
                {checked ? '✓ ' : ''}{cat}
              </label>
            )
          })}
        </div>
      </Field>
      <Field label="Compétences">
        <div className="flex flex-wrap gap-2 pt-0.5">
          {(['permis_C', 'permis_CE', 'CACES', 'grue', 'HAZMAT', 'ADR'] as const).map(skill => {
            const checked = (form.skills ?? []).includes(skill)
            return (
              <label key={skill} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-all select-none ${checked ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-surface-50 border-surface-200 text-surface-600 hover:border-surface-300'}`}>
                <input type="checkbox" className="hidden" checked={checked} onChange={() => {
                  setForm(p => {
                    const current = p.skills ?? []
                    const next = checked ? current.filter(s => s !== skill) : [...current, skill]
                    return { ...p, skills: next.length > 0 ? next : undefined }
                  })
                }} />
                {checked ? '✓ ' : ''}{skill}
              </label>
            )
          })}
        </div>
      </Field>
      {Object.keys(fieldErrors).length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
          {Object.entries(fieldErrors).map(([k, v]) => (
            <p key={k} className="text-red-600 text-xs">{v}</p>
          ))}
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <Btn onClick={() => {
          const errs: Record<string, string> = {}
          if (!form.firstName?.trim()) errs.firstName = 'Le prénom est requis'
          if (!form.lastName?.trim()) errs.lastName = 'Le nom est requis'
          if (!form.sector?.trim()) errs.sector = 'Le secteur est requis'
          if (departureMode === 'home') {
            if (!form.depotName?.trim()) errs.depotName = 'L\'adresse domicile est requise'
            if (form.depotLat === 0 && form.depotLng === 0) errs.depot = 'Les coordonnées GPS sont requises (cliquer 📍 GPS)'
          } else {
            if (!form.startingExutoireId) errs.startingExutoireId = 'Sélectionner un exutoire de départ'
          }
          setFieldErrors(errs)
          if (Object.keys(errs).length === 0) onSave(form)
        }} variant="primary">Enregistrer</Btn>
        <Btn onClick={onClose} variant="ghost">Annuler</Btn>
      </div>
    </Modal>
  )
}
