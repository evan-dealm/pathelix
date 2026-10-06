'use client'

import { useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { inputCls } from './shared'
import type { EditableLine } from './LinesEditor'

interface PricedLine { code: string; label: string; quantity: number; unit: string; unitPrice: number; discountPct: number; vatRate: number; explanation: string; missionType?: string; containerTypeId?: string; materialId?: string }

const OPS: Array<[string, string]> = [['POSER', 'Pose'], ['RETIRER', 'Retrait'], ['ECHANGER', 'Échange'], ['ALLER_RETOUR', 'Rotation']]

/**
 * Prices a job from the customer's grids: operations, bin type, material, rental days, tonnes.
 * Every proposed line says which grid and rule it comes from; the user keeps control of the
 * result (lines are added to the document and stay editable).
 */
export function PricingAssistant({ clientId, zip, containerTypes, materials, onAdd }: {
  clientId:       string
  zip?:           string
  containerTypes: Array<{ id: string; name: string }>
  materials:      Array<{ id: string; name: string }>
  onAdd:          (_lines: EditableLine[]) => void
}) {
  const [ops, setOps] = useState<Record<string, boolean>>({ POSER: true, RETIRER: true })
  const [typeId, setTypeId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [days, setDays] = useState('')
  const [tons, setTons] = useState('')
  const [date, setDate] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [result, setResult] = useState<{ lines: PricedLine[]; warnings: string[] } | null>(null)
  const [error, setError] = useState('')

  async function compute() {
    setError('')
    const items: unknown[] = Object.entries(ops).filter(([, on]) => on).map(([missionType]) => ({ kind: 'OPERATION', missionType, containerTypeId: typeId || undefined, materialId: materialId || undefined }))
    if (Number(days) > 0) items.push({ kind: 'RENTAL', containerTypeId: typeId || undefined, days: Number(days) })
    if (Number(tons) > 0) items.push({ kind: 'TREATMENT', materialId: materialId || undefined, tons: Number(tons.replace(',', '.')) })
    if (items.length === 0) { setError('Choisissez au moins une prestation'); return }
    const r = await apiRequest<{ lines: PricedLine[]; warnings: string[] }>('/api/pricing/preview', { method: 'POST', json: { clientId: clientId || null, zip, date: date || undefined, urgent, items } })
    if (!r.ok) { setError(r.error); return }
    setResult(r.data)
  }

  function add() {
    if (!result) return
    onAdd(result.lines.map(l => ({
      label: l.label, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate,
      explanation: l.explanation, missionType: l.missionType ?? null, containerTypeId: l.containerTypeId ?? null, materialId: l.materialId ?? null,
      plannedDate: l.missionType ? (date || null) : null,
    })))
    setResult(null)
  }

  return (
    <section aria-labelledby="pricing-assistant" className="space-y-3 rounded-xl bg-surface-50 p-4">
      <h3 id="pricing-assistant" className="text-sm font-medium text-surface-800">Chiffrer avec les tarifs</h3>
      <div className="flex flex-wrap gap-3 text-sm">
        {OPS.map(([v, lab]) => (
          <label key={v} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!ops[v]} onChange={e => setOps(o => ({ ...o, [v]: e.target.checked }))} />{lab}</label>
        ))}
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />Urgent</label>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <select aria-label="Type de benne" className={inputCls} value={typeId} onChange={e => setTypeId(e.target.value)}>
          <option value="">Type de benne</option>{containerTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Matière" className={inputCls} value={materialId} onChange={e => setMaterialId(e.target.value)}>
          <option value="">Matière</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input aria-label="Jours de location" className={inputCls} inputMode="numeric" placeholder="Jours de location" value={days} onChange={e => setDays(e.target.value)} />
        <input aria-label="Tonnes estimées" className={inputCls} inputMode="decimal" placeholder="Tonnes estimées" value={tons} onChange={e => setTons(e.target.value)} />
        <input aria-label="Date d'intervention" type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Btn onClick={() => void compute()} variant="ghost" size="sm">Calculer</Btn>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
      {result && (
        <div className="space-y-2">
          <ul className="divide-y divide-surface-200 rounded-lg bg-white text-sm ring-1 ring-surface-200">
            {result.lines.map((l, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <span><span className={l.code === 'UNPRICED' ? 'text-amber-700' : 'text-surface-900'}>{l.label}</span><span className="block text-[11px] text-surface-500">{l.explanation}</span></span>
                <span className="whitespace-nowrap tabular-nums">{l.quantity.toLocaleString('fr-FR')} × {l.unitPrice.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
              </li>
            ))}
          </ul>
          {result.warnings.map(w => <p key={w} className="text-xs text-amber-700">{w}</p>)}
          <Btn onClick={add} size="sm">Ajouter ces lignes</Btn>
        </div>
      )}
    </section>
  )
}
