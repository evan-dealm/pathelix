'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal, Btn, Field, Input } from '../ui'
import { usePlanningStore } from '@/stores/planningStore'

interface FuelRecord {
  id: string
  vehicleId: string
  driverId: string | null
  liters: number
  costEur: number
  pricePerLiter: number | null
  mileageKm: number
  stationName: string
  filledAt: string
  fullTank: boolean
  notes: string
  createdAt: string
}

const BLANK: Omit<FuelRecord, 'id' | 'vehicleId' | 'createdAt'> = {
  driverId: null,
  liters: 0,
  costEur: 0,
  pricePerLiter: null,
  mileageKm: 0,
  stationName: '',
  filledAt: new Date().toISOString().slice(0, 10),
  fullTank: true,
  notes: '',
}

export function VehicleFuelModal({ vehicleId, vehicleName, onClose }: {
  vehicleId: string
  vehicleName: string
  onClose: () => void
}) {
  const drivers = usePlanningStore(s => s.drivers)
  const activeDrivers = drivers.filter(d => !d.archived)

  const [records, setRecords] = useState<FuelRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/fuel-records?vehicleId=${vehicleId}`)
      if (res.ok) setRecords(await res.json())
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (form.liters > 0 && form.costEur > 0) {
      setForm(p => ({ ...p, pricePerLiter: Math.round((p.costEur / p.liters) * 1000) / 1000 }))
    }
  }, [form.liters, form.costEur])

  async function handleSave() {
    setError('')
    if (form.liters <= 0) { setError('Le nombre de litres est requis'); return }
    if (form.costEur <= 0) { setError('Le coût est requis'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/fuel-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          driverId:      form.driverId || null,
          liters:        form.liters,
          costEur:       form.costEur,
          pricePerLiter: form.pricePerLiter,
          mileageKm:     form.mileageKm,
          stationName:   form.stationName,
          filledAt:      form.filledAt,
          fullTank:      form.fullTank,
          notes:         form.notes,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error || 'Erreur lors de la sauvegarde')
        return
      }
      setForm({ ...BLANK })
      setShowForm(false)
      void load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cet enregistrement ?')) return
    setDeleting(id)
    try {
      await fetch(`/api/fuel-records/${id}`, { method: 'DELETE' })
      void load()
    } finally {
      setDeleting(null)
    }
  }

  const totalLiters = records.reduce((s, r) => s + r.liters, 0)
  const totalCost = records.reduce((s, r) => s + r.costEur, 0)

  return (
    <Modal title={`Carburant — ${vehicleName}`} onClose={onClose} size="lg">
      {}
      {records.length > 0 && (
        <div className="flex gap-4 bg-surface-50 border border-surface-100 rounded-xl px-4 py-2.5">
          <div>
            <div className="text-[10px] uppercase text-surface-400 tracking-wider">Total litres</div>
            <div className="text-sm font-semibold text-surface-800">{totalLiters.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} L</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-surface-400 tracking-wider">Coût total</div>
            <div className="text-sm font-semibold text-surface-800">{totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-surface-400 tracking-wider">Prix moyen</div>
            <div className="text-sm font-semibold text-surface-800">
              {totalLiters > 0 ? (totalCost / totalLiters).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3 }) : '—'}/L
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-surface-500 text-xs">{records.length} plein{records.length !== 1 ? 's' : ''}</span>
        <Btn onClick={() => { setShowForm(v => !v); setError('') }} variant="primary" size="sm">
          {showForm ? 'Annuler' : '+ Ajouter un plein'}
        </Btn>
      </div>

      {}
      {showForm && (
        <div className="bg-surface-50 border border-surface-200 rounded-xl p-4 space-y-3">
          <div className="text-surface-700 font-medium text-sm">Nouveau plein</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date *">
              <Input type="date" value={form.filledAt} onChange={v => setForm(p => ({ ...p, filledAt: v }))} />
            </Field>
            <Field label="Chauffeur (optionnel)">
              <select value={form.driverId ?? ''} onChange={e => setForm(p => ({ ...p, driverId: e.target.value || null }))}
                className="w-full bg-surface-50 border border-surface-200 rounded-lg px-3 py-2 text-surface-900 text-sm focus:outline-none focus:border-brand-500">
                <option value="">— Non renseigné —</option>
                {activeDrivers.map(d => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Litres *">
              <Input type="number" value={String(form.liters || '')} min="0" step="0.01"
                onChange={v => setForm(p => ({ ...p, liters: parseFloat(v) || 0 }))} placeholder="80.5" />
            </Field>
            <Field label="Coût total (€) *">
              <Input type="number" value={String(form.costEur || '')} min="0" step="0.01"
                onChange={v => setForm(p => ({ ...p, costEur: parseFloat(v) || 0 }))} placeholder="120.00" />
            </Field>
            <Field label="Prix/litre (€)">
              <Input type="number" value={form.pricePerLiter !== null ? String(form.pricePerLiter) : ''} min="0" step="0.001"
                onChange={v => setForm(p => ({ ...p, pricePerLiter: v ? parseFloat(v) : null }))} placeholder="1.650" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kilométrage (km)">
              <Input type="number" value={String(form.mileageKm || '')} min="0"
                onChange={v => setForm(p => ({ ...p, mileageKm: parseInt(v) || 0 }))} placeholder="150000" />
            </Field>
            <Field label="Station-service">
              <Input value={form.stationName} onChange={v => setForm(p => ({ ...p, stationName: v }))} placeholder="Total, BP, Leclerc…" />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-surface-700">
              <input type="checkbox" checked={form.fullTank}
                onChange={e => setForm(p => ({ ...p, fullTank: e.target.checked }))}
                className="w-4 h-4 rounded border-surface-300 text-brand-500" />
              Plein complet
            </label>
          </div>
          <Field label="Notes">
            <Input value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Informations complémentaires…" />
          </Field>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Btn>
            <Btn onClick={() => { setShowForm(false); setError('') }} variant="ghost" size="sm">Annuler</Btn>
          </div>
        </div>
      )}

      {}
      {loading ? (
        <div className="text-center text-surface-400 text-sm py-6">Chargement…</div>
      ) : records.length === 0 ? (
        <div className="text-center text-surface-400 text-sm py-8">
          <div className="text-2xl mb-2">⛽</div>
          Aucun plein enregistré
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(r => {
            const driver = r.driverId ? drivers.find(d => d.id === r.driverId) : null
            return (
              <div key={r.id} className="bg-white border border-surface-100 rounded-xl px-4 py-3 flex items-start gap-3 group hover:border-surface-200 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-surface-700">
                      {new Date(r.filledAt).toLocaleDateString('fr-FR')}
                    </span>
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                      {r.liters.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} L
                    </span>
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                      {r.costEur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                    </span>
                    {r.pricePerLiter !== null && r.pricePerLiter !== undefined && (
                      <span className="text-xs text-surface-400">{r.pricePerLiter.toFixed(3)} €/L</span>
                    )}
                    {!r.fullTank && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Partiel</span>}
                  </div>
                  <div className="flex gap-3 mt-1 text-[11px] text-surface-400 flex-wrap">
                    {r.mileageKm > 0 && <span className="font-mono">{r.mileageKm.toLocaleString('fr-FR')} km</span>}
                    {r.stationName && <span>{r.stationName}</span>}
                    {driver && <span>Chauffeur : {driver.firstName} {driver.lastName}</span>}
                    {r.notes && <span>{r.notes}</span>}
                  </div>
                </div>
                <Btn onClick={() => handleDelete(r.id)} variant="danger" size="xs"
                  disabled={deleting === r.id} title="Supprimer">
                  {deleting === r.id ? '…' : '✕'}
                </Btn>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
