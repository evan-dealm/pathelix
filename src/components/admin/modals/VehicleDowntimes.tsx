'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn, Field, Input, SelectInput } from '../ui'

interface Downtime { id: string; startDate: string; endDate: string; reason: string; notes: string }

const REASONS = [
  { value: 'maintenance', label: 'Entretien' },
  { value: 'inspection',  label: 'Contrôle technique' },
  { value: 'breakdown',   label: 'Panne' },
  { value: 'other',       label: 'Autre' },
]
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map(r => [r.value, r.label]))
const today = () => new Date().toISOString().slice(0, 10)
const fr = (d: string) => d.split('-').reverse().join('/')

/**
 * Planned immobilisations of a truck. The optimiser leaves out, on those days, any driver whose
 * trucks are all immobilised — and says so in the optimisation report.
 */
export function VehicleDowntimes({ vehicleId }: { vehicleId: string }) {
  const [items, setItems] = useState<Downtime[]>([])
  const [form, setForm] = useState({ startDate: today(), endDate: today(), reason: 'maintenance', notes: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await apiRequest<{ data: Downtime[] }>(`/api/vehicle-unavailability?vehicleId=${encodeURIComponent(vehicleId)}&from=${today()}`)
    if (res.ok) setItems(res.data.data)
  }, [vehicleId])
  useEffect(() => { void load() }, [load])

  async function add() {
    setBusy(true); setError('')
    const res = await apiRequest('/api/vehicle-unavailability', { method: 'POST', json: { vehicleId, ...form } })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    void load()
  }
  async function remove(id: string) {
    const res = await apiRequest(`/api/vehicle-unavailability/${id}`, { method: 'DELETE' })
    if (!res.ok) setError(res.error)
    void load()
  }

  return (
    <section aria-labelledby={`downtimes-${vehicleId}`} className="rounded-xl border border-surface-200 p-4 space-y-3">
      <h3 id={`downtimes-${vehicleId}`} className="text-sm font-medium text-surface-800">Immobilisations prévues</h3>
      {items.length === 0
        ? <p className="text-xs text-surface-500">Aucune immobilisation à venir — le camion est proposé à l&apos;optimiseur.</p>
        : (
          <ul className="divide-y divide-surface-100 text-xs">
            {items.map(d => (
              <li key={d.id} className="flex items-center justify-between py-1.5">
                <span><span className="font-medium">{fr(d.startDate)}{d.endDate !== d.startDate ? ` → ${fr(d.endDate)}` : ''}</span> · {REASON_LABEL[d.reason] ?? d.reason}{d.notes ? ` — ${d.notes}` : ''}</span>
                <Btn onClick={() => void remove(d.id)} variant="ghost" size="xs" title="Supprimer l'immobilisation">Supprimer</Btn>
              </li>
            ))}
          </ul>
        )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <Field label="Du"><Input type="date" value={form.startDate} onChange={v => setForm(f => ({ ...f, startDate: v }))} /></Field>
        <Field label="Au"><Input type="date" value={form.endDate} onChange={v => setForm(f => ({ ...f, endDate: v }))} /></Field>
        <Field label="Motif"><SelectInput value={form.reason} onChange={v => setForm(f => ({ ...f, reason: v }))} options={REASONS} label="Motif" /></Field>
        <Btn onClick={() => void add()} disabled={busy} variant="primary" size="sm">Immobiliser</Btn>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>
  )
}
