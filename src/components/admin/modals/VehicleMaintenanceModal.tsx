'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal, Btn, Field, Input, SelectInput } from '../ui'

interface MaintenanceRecord {
  id: string
  vehicleId: string
  type: string
  description: string
  costEur: number | null
  mileageKm: number | null
  doneAt: string
  doneBy: string
  notes: string
  createdAt: string
}

const TYPE_OPTIONS = [
  { value: 'inspection',  label: 'Contrôle technique / Inspection' },
  { value: 'oil_change',  label: 'Vidange' },
  { value: 'repair',      label: 'Réparation' },
  { value: 'tire',        label: 'Pneumatiques' },
  { value: 'breakdown',   label: 'Panne / Incident' },
  { value: 'other',       label: 'Autre' },
]

const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(o => [o.value, o.label]))

const BLANK: Omit<MaintenanceRecord, 'id' | 'vehicleId' | 'createdAt'> = {
  type: 'inspection',
  description: '',
  costEur: null,
  mileageKm: null,
  doneAt: new Date().toISOString().slice(0, 10),
  doneBy: '',
  notes: '',
}

export function VehicleMaintenanceModal({ vehicleId, vehicleName, onClose }: {
  vehicleId: string
  vehicleName: string
  onClose: () => void
}) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/maintenance?vehicleId=${vehicleId}`)
      if (res.ok) setRecords(await res.json())
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  useEffect(() => { void load() }, [load])

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const body = {
        vehicleId,
        type:        form.type,
        description: form.description,
        costEur:     form.costEur,
        mileageKm:   form.mileageKm,
        doneAt:      form.doneAt,
        doneBy:      form.doneBy,
        notes:       form.notes,
      }
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      await fetch(`/api/maintenance/${id}`, { method: 'DELETE' })
      void load()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <Modal title={`Entretien — ${vehicleName}`} onClose={onClose} size="lg">
      <div className="flex items-center justify-between">
        <span className="text-surface-500 text-xs">{records.length} enregistrement{records.length !== 1 ? 's' : ''}</span>
        <Btn onClick={() => { setShowForm(v => !v); setError('') }} variant="primary" size="sm">
          {showForm ? 'Annuler' : '+ Ajouter'}
        </Btn>
      </div>

      {}
      {showForm && (
        <div className="bg-surface-50 border border-surface-200 rounded-xl p-4 space-y-3">
          <div className="text-surface-700 font-medium text-sm">Nouvel enregistrement</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type *">
              <SelectInput value={form.type} onChange={v => setForm(p => ({ ...p, type: v }))} options={TYPE_OPTIONS} label="Type" />
            </Field>
            <Field label="Date *">
              <Input type="date" value={form.doneAt} onChange={v => setForm(p => ({ ...p, doneAt: v }))} />
            </Field>
          </div>
          <Field label="Description">
            <Input value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} placeholder="Remplacement courroie de distribution…" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Coût (€)">
              <Input type="number" value={form.costEur !== null && form.costEur !== undefined ? String(form.costEur) : ''} min="0" step="0.01"
                onChange={v => setForm(p => ({ ...p, costEur: v ? parseFloat(v) : null }))}
                placeholder="0.00" />
            </Field>
            <Field label="Kilométrage (km)">
              <Input type="number" value={form.mileageKm !== null && form.mileageKm !== undefined ? String(form.mileageKm) : ''} min="0"
                onChange={v => setForm(p => ({ ...p, mileageKm: v ? parseInt(v) : null }))}
                placeholder="150000" />
            </Field>
            <Field label="Réalisé par">
              <Input value={form.doneBy} onChange={v => setForm(p => ({ ...p, doneBy: v }))} placeholder="Garage XYZ" />
            </Field>
          </div>
          <Field label="Notes">
            <Input value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Informations complémentaires…" />
          </Field>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving || !form.doneAt}>
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
          <div className="text-2xl mb-2">🔧</div>
          Aucun entretien enregistré
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(r => (
            <div key={r.id} className="bg-white border border-surface-100 rounded-xl px-4 py-3 flex items-start gap-3 group hover:border-surface-200 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-surface-700 bg-surface-100 border border-surface-200 rounded px-2 py-0.5">
                    {TYPE_LABELS[r.type] ?? r.type}
                  </span>
                  <span className="text-xs text-surface-500">{new Date(r.doneAt).toLocaleDateString('fr-FR')}</span>
                  {r.costEur !== null && r.costEur !== undefined && (
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                      {r.costEur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                    </span>
                  )}
                  {r.mileageKm !== null && r.mileageKm !== undefined && (
                    <span className="text-xs text-surface-400 font-mono">{r.mileageKm.toLocaleString('fr-FR')} km</span>
                  )}
                </div>
                {r.description && <p className="text-sm text-surface-700 mt-1">{r.description}</p>}
                <div className="flex gap-3 mt-1 text-[11px] text-surface-400">
                  {r.doneBy && <span>Par : {r.doneBy}</span>}
                  {r.notes && <span>{r.notes}</span>}
                </div>
              </div>
              <Btn onClick={() => handleDelete(r.id)} variant="danger" size="xs"
                disabled={deleting === r.id}
                title="Supprimer">
                {deleting === r.id ? '…' : '✕'}
              </Btn>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
