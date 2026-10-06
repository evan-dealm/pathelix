'use client'

import { eur, inputCls } from './shared'

export interface EditableLine {
  label:            string
  description?:     string
  quantity:         number
  unit:             string
  unitPrice:        number
  discountPct:      number
  vatRate:          number
  explanation?:     string
  missionType?:     string | null
  containerTypeId?: string | null
  materialId?:      string | null
  plannedDate?:     string | null
}

export const blankLine = (vatRate = 20): EditableLine => ({ label: '', quantity: 1, unit: 'UNIT', unitPrice: 0, discountPct: 0, vatRate, explanation: 'Prix saisi' })

const UNITS: Array<[string, string]> = [['UNIT', 'u'], ['DAY', 'jour'], ['TON', 't'], ['KM', 'km'], ['HOUR', 'h'], ['M3', 'm³'], ['FLAT', 'forfait'], ['PCT', '%']]
const OPS: Array<[string, string]> = [['', 'Pas d\'intervention'], ['POSER', 'Pose'], ['RETIRER', 'Retrait'], ['ECHANGER', 'Échange'], ['ALLER_RETOUR', 'Rotation (aller-retour)'], ['CHARGER_IMMEDIAT', 'Chargement immédiat'], ['DEPLACER', 'Déplacement'], ['TASSER', 'Tassage']]

export const lineAmount = (l: EditableLine) => Math.round(l.quantity * l.unitPrice * (1 - (l.discountPct || 0) / 100) * 100) / 100

export function lineTotals(lines: EditableLine[]) {
  const byRate = new Map<number, number>()
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + lineAmount(l))
  const vat = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, base]) => ({ rate, base, vat: Math.round(base * rate) / 100 }))
  const ht = vat.reduce((a, v) => a + v.base, 0)
  const tva = vat.reduce((a, v) => a + v.vat, 0)
  return { ht, vat, ttc: Math.round((ht + tva) * 100) / 100 }
}

/**
 * Lines of a quote, order or invoice. With `operations`, a line can carry the intervention it
 * sells (type, bin type, material, date): on conversion it becomes a mission, no re-typing.
 */
export function LinesEditor({ lines, onChange, readOnly, operations, containerTypes = [], materials = [] }: {
  lines:           EditableLine[]
  onChange?:       (_l: EditableLine[]) => void
  readOnly?:       boolean
  operations?:     boolean
  containerTypes?: Array<{ id: string; name: string }>
  materials?:      Array<{ id: string; name: string }>
}) {
  const set = (i: number, patch: Partial<EditableLine>) => onChange?.(lines.map((l, j) => (j === i ? { ...l, ...patch, ...(patch.unitPrice !== undefined && !('explanation' in patch) ? { explanation: 'Prix saisi' } : {}) } : l)))
  const t = lineTotals(lines)
  const num = (v: string) => (v === '' || v === '-' ? 0 : Number(v.replace(',', '.')) || 0)
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl ring-1 ring-surface-200">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-50 text-left text-xs text-surface-500">
            <tr>
              <th className="px-2 py-2 font-medium">Désignation</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Qté</th>
              <th className="w-20 px-2 py-2 font-medium">Unité</th>
              <th className="w-28 px-2 py-2 text-right font-medium">PU HT</th>
              <th className="w-16 px-2 py-2 text-right font-medium">Remise</th>
              <th className="w-16 px-2 py-2 text-right font-medium">TVA</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Total HT</th>
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 bg-white align-top">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">
                  {readOnly ? <div className="font-medium text-surface-900">{l.label}</div>
                    : <input aria-label={`Désignation ligne ${i + 1}`} className={inputCls} value={l.label} onChange={e => set(i, { label: e.target.value })} placeholder="Pose benne 15 m³" />}
                  {l.explanation && <div className="mt-0.5 text-[11px] text-surface-500" title={l.explanation}>{l.explanation}</div>}
                  {operations && !readOnly && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-brand-600">{l.missionType ? 'Intervention liée' : 'Lier une intervention'}</summary>
                      <div className="mt-1 grid grid-cols-2 gap-1.5">
                        <select aria-label="Type d'intervention" className={inputCls} value={l.missionType ?? ''} onChange={e => set(i, { missionType: e.target.value || null })}>
                          {OPS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                        </select>
                        <input aria-label="Date prévue" type="date" className={inputCls} value={l.plannedDate ?? ''} onChange={e => set(i, { plannedDate: e.target.value || null })} />
                        <select aria-label="Type de benne" className={inputCls} value={l.containerTypeId ?? ''} onChange={e => set(i, { containerTypeId: e.target.value || null })}>
                          <option value="">Benne : non précisée</option>
                          {containerTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select aria-label="Matière" className={inputCls} value={l.materialId ?? ''} onChange={e => set(i, { materialId: e.target.value || null })}>
                          <option value="">Matière : non précisée</option>
                          {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </div>
                    </details>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{readOnly ? l.quantity.toLocaleString('fr-FR') : <input aria-label={`Quantité ligne ${i + 1}`} inputMode="decimal" className={`${inputCls} text-right`} value={l.quantity} onChange={e => set(i, { quantity: num(e.target.value) })} />}</td>
                <td className="px-2 py-1.5">{readOnly ? UNITS.find(u => u[0] === l.unit)?.[1] ?? l.unit : (
                  <select aria-label={`Unité ligne ${i + 1}`} className={inputCls} value={l.unit} onChange={e => set(i, { unit: e.target.value })}>{UNITS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}</select>
                )}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{readOnly ? eur(l.unitPrice) : <input aria-label={`Prix unitaire ligne ${i + 1}`} inputMode="decimal" className={`${inputCls} text-right`} value={l.unitPrice} onChange={e => set(i, { unitPrice: num(e.target.value) })} />}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{readOnly ? (l.discountPct ? `${l.discountPct} %` : '') : <input aria-label={`Remise ligne ${i + 1}`} inputMode="decimal" className={`${inputCls} text-right`} value={l.discountPct} onChange={e => set(i, { discountPct: Math.min(100, Math.max(0, num(e.target.value))) })} />}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{readOnly ? `${l.vatRate} %` : <input aria-label={`TVA ligne ${i + 1}`} inputMode="decimal" className={`${inputCls} text-right`} value={l.vatRate} onChange={e => set(i, { vatRate: Math.min(30, Math.max(0, num(e.target.value))) })} />}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums text-surface-900">{eur(lineAmount(l))}</td>
                {!readOnly && <td className="py-1.5"><button type="button" aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => onChange?.(lines.filter((_, j) => j !== i))} className="rounded p-1 text-surface-400 hover:bg-red-50 hover:text-red-600">✕</button></td>}
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-surface-500">Aucune ligne.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {!readOnly ? <button type="button" onClick={() => onChange?.([...lines, blankLine(lines[lines.length - 1]?.vatRate ?? 20)])} className="text-sm font-medium text-brand-600 hover:underline">+ Ajouter une ligne</button> : <span />}
        <dl className="ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-surface-500">Total HT</dt><dd className="tabular-nums">{eur(t.ht)}</dd></div>
          {t.vat.map(v => <div key={v.rate} className="flex justify-between"><dt className="text-surface-500">TVA {v.rate} %</dt><dd className="tabular-nums">{eur(v.vat)}</dd></div>)}
          <div className="flex justify-between border-t border-surface-200 pt-1 font-semibold text-surface-900"><dt>Total TTC</dt><dd className="tabular-nums">{eur(t.ttc)}</dd></div>
        </dl>
      </div>
    </div>
  )
}
