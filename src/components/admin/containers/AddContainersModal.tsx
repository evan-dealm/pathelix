'use client'

import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn, Field, Input, Modal, SelectInput } from '../ui'
import type { ContainerTypeRow } from './shared'

/** Adds bins by batch: N bins of a type, numbered after the highest existing number of the prefix. */
export function AddContainersModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [types, setTypes] = useState<ContainerTypeRow[]>([])
  const [form, setForm] = useState({ typeId: '', count: '10', prefix: 'B-', number: '', single: false, purchaseCost: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void apiRequest<{ data: ContainerTypeRow[] }>('/api/container-types').then(r => {
      if (r.ok) { setTypes(r.data.data); setForm(f => ({ ...f, typeId: f.typeId || r.data.data[0]?.id || '' })) }
    })
  }, [])

  async function save() {
    setSaving(true); setError('')
    const body = form.single
      ? { typeId: form.typeId, number: form.number.trim() }
      : { typeId: form.typeId, count: parseInt(form.count, 10) || 0, prefix: form.prefix }
    const res = await apiRequest<{ data: unknown[] }>('/api/containers', {
      method: 'POST', json: { ...body, ...(form.purchaseCost ? { purchaseCost: parseFloat(form.purchaseCost) } : {}) },
    })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    onDone()
  }

  return (
    <Modal title="Ajouter des bennes" onClose={onClose}>
      {types.length === 0 ? (
        <p className="text-sm text-surface-600">Créez d&apos;abord un type de benne (bouton « Types de bennes »).</p>
      ) : (
        <div className="space-y-4">
          <Field label="Type"><SelectInput value={form.typeId} onChange={v => setForm(f => ({ ...f, typeId: v }))} options={types.map(t => ({ value: t.id, label: `${t.name} (${t.capacityM3} m³)` }))} label="Type" /></Field>
          <div role="radiogroup" aria-label="Mode d'ajout" className="flex gap-4 text-sm">
            <label className="inline-flex items-center gap-2"><input type="radio" checked={!form.single} onChange={() => setForm(f => ({ ...f, single: false }))} /> Un lot numéroté</label>
            <label className="inline-flex items-center gap-2"><input type="radio" checked={form.single} onChange={() => setForm(f => ({ ...f, single: true }))} /> Une benne avec son numéro</label>
          </div>
          {form.single ? (
            <Field label="Numéro peint sur la benne"><Input value={form.number} onChange={v => setForm(f => ({ ...f, number: v.toUpperCase() }))} placeholder="B-00482" /></Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre"><Input type="number" value={form.count} onChange={v => setForm(f => ({ ...f, count: v }))} min="1" max="500" /></Field>
              <Field label="Préfixe"><Input value={form.prefix} onChange={v => setForm(f => ({ ...f, prefix: v.toUpperCase() }))} /></Field>
            </div>
          )}
          <Field label="Coût d'achat unitaire (€ HT, facultatif)"><Input type="number" value={form.purchaseCost} onChange={v => setForm(f => ({ ...f, purchaseCost: v }))} min="0" /></Field>
          <p className="text-xs text-surface-500">Chaque benne reçoit un QR code unique à imprimer et coller. Elles sont créées « disponibles » au dépôt.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Btn onClick={onClose} variant="ghost">Annuler</Btn>
            <Btn onClick={() => void save()} disabled={saving || !form.typeId || (form.single ? !form.number.trim() : !(parseInt(form.count, 10) > 0))}>
              {saving ? 'Création…' : form.single ? 'Ajouter la benne' : `Créer ${parseInt(form.count, 10) || 0} bennes`}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}
