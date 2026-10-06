'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn, Field, Input, Modal } from '../ui'
import type { ContainerTypeRow } from './shared'

const blank = { name: '', capacityM3: '', tareKg: '', dailyRentalPrice: '', allowedMaterials: '' }

/** Bin types: size, empty weight (counted in the truck's load), rental price, allowed materials. */
export function ContainerTypesModal({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<ContainerTypeRow[]>([])
  const [form, setForm] = useState(blank)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await apiRequest<{ data: ContainerTypeRow[] }>('/api/container-types')
    if (r.ok) setTypes(r.data.data)
  }, [])
  useEffect(() => { void load() }, [load])

  function edit(t: ContainerTypeRow) {
    setEditId(t.id)
    setForm({
      name: t.name, capacityM3: String(t.capacityM3), tareKg: t.tareKg !== null ? String(t.tareKg) : '',
      dailyRentalPrice: t.dailyRentalPrice !== null ? String(t.dailyRentalPrice) : '', allowedMaterials: (t.allowedMaterials ?? []).join(', '),
    })
  }

  async function save() {
    setError('')
    const json = {
      name: form.name.trim(),
      capacityM3: parseFloat(form.capacityM3),
      tareKg: form.tareKg ? parseFloat(form.tareKg) : null,
      dailyRentalPrice: form.dailyRentalPrice ? parseFloat(form.dailyRentalPrice) : null,
      allowedMaterials: form.allowedMaterials.split(',').map(s => s.trim()).filter(Boolean),
    }
    const r = editId
      ? await apiRequest(`/api/container-types/${editId}`, { method: 'PUT', json })
      : await apiRequest('/api/container-types', { method: 'POST', json })
    if (!r.ok) { setError(r.error); return }
    setForm(blank); setEditId(null); void load()
  }

  async function archive(t: ContainerTypeRow) {
    if (!window.confirm(`Archiver le type « ${t.name} » ?`)) return
    const r = await apiRequest(`/api/container-types/${t.id}`, { method: 'DELETE' })
    if (!r.ok) setError(r.error)
    void load()
  }

  return (
    <Modal title="Types de bennes" onClose={onClose} size="lg">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-surface-500">
          <tr><th className="py-1 font-medium">Type</th><th className="text-right font-medium">Volume</th><th className="text-right font-medium">Poids à vide</th><th className="text-right font-medium">Location / jour</th><th className="text-right font-medium">Au parc</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {types.map(t => (
            <tr key={t.id}>
              <td className="py-1.5 font-medium text-surface-900">{t.name}</td>
              <td className="text-right tabular-nums">{t.capacityM3} m³</td>
              <td className="text-right tabular-nums">{t.tareKg !== null ? `${t.tareKg} kg` : '—'}</td>
              <td className="text-right tabular-nums">{t.dailyRentalPrice !== null ? `${t.dailyRentalPrice} €` : '—'}</td>
              <td className="text-right tabular-nums">{Object.values(t.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0)}</td>
              <td className="space-x-1 text-right">
                <Btn onClick={() => edit(t)} variant="ghost" size="xs">Modifier</Btn>
                <Btn onClick={() => void archive(t)} variant="ghost" size="xs">Archiver</Btn>
              </td>
            </tr>
          ))}
          {types.length === 0 && <tr><td colSpan={6} className="py-3 text-surface-500">Aucun type. Exemple : « Benne 15 m³ », 15 m³, 1 800 kg à vide.</td></tr>}
        </tbody>
      </table>
      <div className="space-y-3 rounded-xl bg-surface-50 p-4">
        <h3 className="text-sm font-medium text-surface-800">{editId ? 'Modifier le type' : 'Nouveau type'}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Nom"><Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Benne 15 m³" /></Field>
          <Field label="Volume (m³)"><Input type="number" value={form.capacityM3} onChange={v => setForm(f => ({ ...f, capacityM3: v }))} /></Field>
          <Field label="Poids à vide (kg)"><Input type="number" value={form.tareKg} onChange={v => setForm(f => ({ ...f, tareKg: v }))} /></Field>
          <Field label="Location / jour (€ HT)"><Input type="number" value={form.dailyRentalPrice} onChange={v => setForm(f => ({ ...f, dailyRentalPrice: v }))} /></Field>
        </div>
        <Field label="Matières autorisées (séparées par des virgules, vide = toutes)"><Input value={form.allowedMaterials} onChange={v => setForm(f => ({ ...f, allowedMaterials: v }))} placeholder="Gravats, DIB, Bois" /></Field>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          {editId && <Btn onClick={() => { setEditId(null); setForm(blank) }} variant="ghost" size="sm">Annuler</Btn>}
          <Btn onClick={() => void save()} size="sm" disabled={!form.name.trim() || !(parseFloat(form.capacityM3) > 0)}>{editId ? 'Enregistrer' : 'Créer le type'}</Btn>
        </div>
      </div>
    </Modal>
  )
}
