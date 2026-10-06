'use client'

import { useState, useRef } from 'react'
import { Exutoire } from '@/lib/types'
import { Modal, Field, Input, Btn } from './ui'
import { DAYS_FR, WASTE_PRESETS } from './types'
import { minToHHMM, hhmmToMin } from './hooks'

export function ExutoireForm({ initial, onSave, onClose, title }: {
  initial: Omit<Exutoire, 'id'>
  onSave: (_d: Omit<Exutoire, 'id'>) => void
  onClose: () => void
  title: string
}) {
  const [form, setForm] = useState(initial)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMsg, setGeocodeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [wasteInput, setWasteInput] = useState('')
  const geocodeCtrlRef = useRef<AbortController | null>(null)

  async function handleGeocode() {
    const q = form.address.trim()
    if (!q) { setGeocodeMsg({ ok: false, text: 'Entrez une adresse.' }); return }
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
        setForm(p => ({ ...p, lat, lng }))
        setGeocodeMsg({ ok: true, text: `GPS : ${lat.toFixed(4)}, ${lng.toFixed(4)}` })
      } else { setGeocodeMsg({ ok: false, text: 'Adresse introuvable.' }) }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setGeocodeMsg({ ok: false, text: 'Erreur réseau.' })
    }
    finally { setGeocoding(false) }
  }

  function toggleDay(d: number) {
    setForm(p => ({
      ...p,
      closedDays: p.closedDays.includes(d) ? p.closedDays.filter(x => x !== d) : [...p.closedDays, d],
    }))
  }

  function addWaste(w: string) {
    const v = w.trim()
    if (!v || form.acceptedWasteTypes.includes(v)) return
    setForm(p => ({ ...p, acceptedWasteTypes: [...p.acceptedWasteTypes, v] }))
    setWasteInput('')
  }

  return (
    <Modal title={title} onClose={onClose}>
      <Field label="Nom du site">
        <Input value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="Centre de tri Rumilly" />
      </Field>
      <Field label="Adresse">
        <div className="flex gap-2">
          <Input value={form.address} onChange={v => { setForm(p => ({ ...p, address: v })); setGeocodeMsg(null) }} placeholder="ZI La Cartusie, 74150 Rumilly" />
          <button type="button" onClick={handleGeocode} disabled={geocoding}
            className="flex-shrink-0 px-2 py-1 rounded text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap">
            {geocoding ? '…' : '📍 GPS'}
          </button>
        </div>
        {geocodeMsg && <div className={`mt-1 text-[10px] ${geocodeMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{geocodeMsg.ok ? '✓' : '✗'} {geocodeMsg.text}</div>}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude"><Input type="number" value={String(form.lat)} onChange={v => setForm(p => ({ ...p, lat: parseFloat(v) || 0 }))} placeholder="45.865" /></Field>
        <Field label="Longitude"><Input type="number" value={String(form.lng)} onChange={v => setForm(p => ({ ...p, lng: parseFloat(v) || 0 }))} placeholder="5.941" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ouverture (heure)">
          <Input type="time" value={minToHHMM(form.openingHoursOpen)}
            onChange={v => setForm(p => ({ ...p, openingHoursOpen: hhmmToMin(v) }))} />
        </Field>
        <Field label="Fermeture (heure)">
          <Input type="time" value={minToHHMM(form.openingHoursClose)}
            onChange={v => setForm(p => ({ ...p, openingHoursClose: hhmmToMin(v) }))} />
        </Field>
      </div>
      <Field label="Jours de fermeture">
        <div className="flex gap-1.5 flex-wrap">
          {DAYS_FR.map((d, i) => (
            <button key={i} type="button" onClick={() => toggleDay(i)}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${form.closedDays.includes(i) ? 'bg-red-600/30 text-red-400 border border-red-600/40' : 'bg-surface-100 text-surface-400 border border-surface-200 hover:text-surface-600'}`}>
              {d}
            </button>
          ))}
        </div>
        {form.closedDays.length > 0 && <div className="mt-1 text-[10px] text-red-400">Fermé : {form.closedDays.map(d => DAYS_FR[d]).join(', ')}</div>}
      </Field>
      <Field label="Types de déchets acceptés">
        <div className="flex gap-1.5 flex-wrap mb-2">
          {WASTE_PRESETS.map(w => (
            <button key={w} type="button" onClick={() => addWaste(w)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${form.acceptedWasteTypes.includes(w) ? 'bg-green-700/30 text-green-400 border border-green-700/40' : 'bg-surface-100 text-surface-400 border border-surface-200 hover:text-surface-600'}`}>
              {form.acceptedWasteTypes.includes(w) ? '✓ ' : '+ '}{w}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={wasteInput} onChange={setWasteInput} placeholder="Autre type de déchet…" />
          <Btn onClick={() => addWaste(wasteInput)} variant="ghost" size="sm">+ Ajouter</Btn>
        </div>
        {form.acceptedWasteTypes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {form.acceptedWasteTypes.map(w => (
              <span key={w} className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 text-[10px] text-emerald-700">
                {w}
                <button type="button" onClick={() => setForm(p => ({ ...p, acceptedWasteTypes: p.acceptedWasteTypes.filter(x => x !== w) }))} className="text-green-600 hover:text-red-400 ml-0.5 text-[9px]">✕</button>
              </span>
            ))}
          </div>
        )}
      </Field>
      <Field label="Temps de service (min)">
        <Input type="number" min="5" max="120" value={String(form.serviceTimeMin)}
          onChange={v => setForm(p => ({ ...p, serviceTimeMin: parseInt(v) || 20 }))} />
      </Field>
      <Field label="Prix de traitement (€ HT / tonne, facultatif)">
        <Input type="number" min="0" step="0.5" value={form.feePerTonneEur === null || form.feePerTonneEur === undefined ? '' : String(form.feePerTonneEur)}
          onChange={v => setForm(p => ({ ...p, feePerTonneEur: v.trim() === '' ? null : Math.max(0, Number(v) || 0) }))} />
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
          if (!form.name?.trim()) errs.name = 'Le nom est requis'
          if (!form.address?.trim()) errs.address = "L'adresse est requise"
          if (form.lat === 0 && form.lng === 0) errs.gps = 'Les coordonnées GPS sont requises'
          if (form.acceptedWasteTypes.length === 0) errs.waste = 'Au moins un type de déchet est requis'
          if (form.serviceTimeMin <= 0) errs.service = 'Le temps de service doit être > 0'
          setFieldErrors(errs)
          if (Object.keys(errs).length === 0) onSave(form)
        }} variant="primary">Enregistrer</Btn>
        <Btn onClick={onClose} variant="ghost">Annuler</Btn>
      </div>
    </Modal>
  )
}
