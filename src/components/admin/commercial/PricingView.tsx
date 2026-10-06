'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { useCommercialCatalog } from './useCatalog'
import { Empty, eur, inputCls } from './shared'

interface Rule { id: string; code: string; label: string; unit: string; amount: number; vatRate: number; conditions: Record<string, string | number | undefined>; priority: number; active: boolean }
interface PriceList { id: string; name: string; isDefault: boolean; client: { id: string; name: string } | null; validFrom: string | null; validTo: string | null; rules: Rule[] }

const CODES: Array<[string, string, string]> = [
  ['POSE', 'Pose', 'UNIT'], ['RETRAIT', 'Retrait', 'UNIT'], ['ECHANGE', 'Échange', 'UNIT'], ['ALLER_RETOUR', 'Rotation (aller-retour exutoire)', 'UNIT'],
  ['TRANSPORT', 'Transport par déplacement', 'UNIT'], ['ZONE', 'Forfait de zone (codes postaux)', 'UNIT'], ['KM', 'Transport au km', 'KM'],
  ['RENTAL_DAY', 'Location par jour', 'DAY'], ['TREATMENT_TON', 'Traitement à la tonne', 'TON'], ['EXUTOIRE', 'Frais d\'exutoire par passage', 'UNIT'],
  ['FUEL_PCT', 'Surcharge carburant (%)', 'PCT'], ['URGENCY_PCT', 'Majoration urgence (%)', 'PCT'], ['WEEKEND_PCT', 'Majoration week-end (%)', 'PCT'],
  ['DISCOUNT_PCT', 'Remise client (%)', 'PCT'], ['MINIMUM', 'Minimum de facturation', 'FLAT'],
]
const CODE_LABEL = Object.fromEntries(CODES.map(([c, l]) => [c, l]))

/**
 * Price grids: the default grid, and grids negotiated per customer (which win). Each rule can be
 * narrowed to a bin type, a material, a postal zone or a franchise of free rental days.
 */
export function PricingView() {
  const cat = useCommercialCatalog()
  const [lists, setLists] = useState<PriceList[]>([])
  const [error, setError] = useState('')
  const [newList, setNewList] = useState({ name: '', clientId: '' })
  const load = useCallback(async () => {
    const r = await apiRequest<{ data: PriceList[] }>('/api/price-lists')
    if (r.ok) setLists(r.data.data); else setError(r.error)
  }, [])
  useEffect(() => { void load() }, [load])

  async function createList() {
    setError('')
    const r = await apiRequest('/api/price-lists', { method: 'POST', json: { name: newList.name, clientId: newList.clientId || null, isDefault: lists.length === 0 || !newList.clientId && !lists.some(l => l.isDefault) } })
    if (!r.ok) { setError(r.error); return }
    setNewList({ name: '', clientId: '' }); void load()
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {lists.length === 0 && <Empty title="Aucune grille tarifaire">Créez la grille par défaut : pose, retrait, location, traitement à la tonne… Devis et factures la lisent pour proposer les prix.</Empty>}
      {lists.map(l => <ListCard key={l.id} list={l} onChanged={() => void load()} containerTypes={cat.containerTypes} materials={cat.materials} />)}
      <section className="flex flex-wrap items-end gap-2 rounded-xl bg-surface-50 p-4">
        <label className="text-xs text-surface-600">Nouvelle grille<input className={inputCls} value={newList.name} onChange={e => setNewList(n => ({ ...n, name: e.target.value }))} placeholder="Tarifs 2026" /></label>
        <label className="text-xs text-surface-600">Propre à un client (facultatif)
          <select className={inputCls} value={newList.clientId} onChange={e => setNewList(n => ({ ...n, clientId: e.target.value }))}>
            <option value="">Grille générale</option>{cat.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Btn onClick={() => void createList()} size="sm" disabled={!newList.name.trim()}>Créer la grille</Btn>
      </section>
    </div>
  )
}

function ListCard({ list, onChanged, containerTypes, materials }: { list: PriceList; onChanged: () => void; containerTypes: Array<{ id: string; name: string }>; materials: Array<{ id: string; name: string }> }) {
  const [form, setForm] = useState({ code: 'POSE', label: 'Pose', amount: '', vatRate: '20', containerTypeId: '', materialId: '', zipPrefix: '', freeDays: '' })
  const [error, setError] = useState('')
  const typeName = (id?: string | number) => containerTypes.find(t => t.id === id)?.name
  const matName = (id?: string | number) => materials.find(m => m.id === id)?.name

  async function addRule() {
    setError('')
    const unit = CODES.find(c => c[0] === form.code)?.[2]
    const conditions: Record<string, string | number> = {}
    if (form.containerTypeId) conditions.containerTypeId = form.containerTypeId
    if (form.materialId) conditions.materialId = form.materialId
    if (form.zipPrefix) conditions.zipPrefix = form.zipPrefix
    if (form.freeDays) conditions.freeDays = Number(form.freeDays)
    const r = await apiRequest(`/api/price-lists/${list.id}/rules`, { method: 'POST', json: { code: form.code, label: form.label || CODE_LABEL[form.code], unit, amount: Number(form.amount.replace(',', '.')), vatRate: Number(form.vatRate), conditions } })
    if (!r.ok) { setError(r.error); return }
    setForm(f => ({ ...f, amount: '', containerTypeId: '', materialId: '', zipPrefix: '', freeDays: '' })); onChanged()
  }
  async function removeRule(id: string) {
    const r = await apiRequest(`/api/price-rules/${id}`, { method: 'DELETE' })
    if (!r.ok) setError(r.error); else onChanged()
  }
  async function makeDefault() {
    const r = await apiRequest(`/api/price-lists/${list.id}`, { method: 'PUT', json: { isDefault: true } })
    if (!r.ok) setError(r.error); else onChanged()
  }

  return (
    <section aria-label={`Grille ${list.name}`} className="rounded-xl ring-1 ring-surface-200">
      <header className="flex flex-wrap items-center gap-2 border-b border-surface-100 px-4 py-3">
        <h3 className="font-display text-base font-semibold text-surface-900">{list.name}</h3>
        {list.isDefault && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 ring-1 ring-brand-200">Grille par défaut</span>}
        {list.client && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 ring-1 ring-violet-200">Client : {list.client.name}</span>}
        {!list.isDefault && !list.client && <Btn onClick={() => void makeDefault()} variant="ghost" size="xs">Définir par défaut</Btn>}
      </header>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-surface-100">
          {list.rules.map(r => (
            <tr key={r.id}>
              <td className="px-4 py-2"><div className="font-medium text-surface-900">{r.label}</div><div className="text-xs text-surface-500">{CODE_LABEL[r.code] ?? r.code}
                {[typeName(r.conditions.containerTypeId), matName(r.conditions.materialId), r.conditions.zipPrefix ? `CP ${r.conditions.zipPrefix}` : '', r.conditions.freeDays ? `${r.conditions.freeDays} j offerts` : ''].filter(Boolean).map(x => ` · ${x}`).join('')}</div></td>
              <td className="px-4 py-2 text-right tabular-nums">{r.unit === 'PCT' ? `${r.amount} %` : `${eur(r.amount)}${r.unit === 'DAY' ? ' / j' : r.unit === 'TON' ? ' / t' : r.unit === 'KM' ? ' / km' : ''}`}</td>
              <td className="px-4 py-2 text-right text-xs text-surface-500">TVA {r.vatRate} %</td>
              <td className="w-10 px-2"><button type="button" aria-label={`Supprimer ${r.label}`} onClick={() => void removeRule(r.id)} className="rounded p-1 text-surface-400 hover:bg-red-50 hover:text-red-600">✕</button></td>
            </tr>
          ))}
          {list.rules.length === 0 && <tr><td className="px-4 py-3 text-surface-500">Aucun tarif dans cette grille.</td></tr>}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-2 border-t border-surface-100 px-4 py-3 md:grid-cols-8">
        <select aria-label="Type de tarif" className={`${inputCls} md:col-span-2`} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value, label: CODE_LABEL[e.target.value] ?? '' }))}>{CODES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
        <input aria-label="Libellé" className={`${inputCls} md:col-span-2`} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        <input aria-label="Montant" className={inputCls} inputMode="decimal" placeholder={form.code.endsWith('_PCT') ? '%' : '€ HT'} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        <select aria-label="Pour le type de benne" className={inputCls} value={form.containerTypeId} onChange={e => setForm(f => ({ ...f, containerTypeId: e.target.value }))}><option value="">Toutes bennes</option>{containerTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select aria-label="Pour la matière" className={inputCls} value={form.materialId} onChange={e => setForm(f => ({ ...f, materialId: e.target.value }))}><option value="">Toutes matières</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        {form.code === 'ZONE' ? <input aria-label="Codes postaux" className={inputCls} placeholder="38, 69" value={form.zipPrefix} onChange={e => setForm(f => ({ ...f, zipPrefix: e.target.value }))} />
          : form.code === 'RENTAL_DAY' ? <input aria-label="Jours offerts" className={inputCls} inputMode="numeric" placeholder="Jours offerts" value={form.freeDays} onChange={e => setForm(f => ({ ...f, freeDays: e.target.value }))} />
          : <input aria-label="TVA" className={inputCls} inputMode="decimal" value={form.vatRate} onChange={e => setForm(f => ({ ...f, vatRate: e.target.value }))} />}
        <div className="col-span-2 flex items-center gap-2 md:col-span-8"><Btn onClick={() => void addRule()} size="sm" disabled={!form.amount}>Ajouter le tarif</Btn>{error && <p role="alert" className="text-xs text-red-600">{error}</p>}</div>
      </div>
    </section>
  )
}
