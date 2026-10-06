'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from './ui'

interface Material { id: string; name: string; wasteCode: string; densityKgM3: number | null; fillFactor: number; uncertaintyPct: number; hazardous: boolean }

const blank = { name: '', wasteCode: '', densityKgM3: '', fillFactor: '80', uncertaintyPct: '25' }

/**
 * Materials collected and their bulk density. When a mission's content weight is unknown, the
 * optimiser estimates it as density × bin volume × fill ratio and adds the uncertainty on top
 * before checking the truck's payload — the estimate is shown as such, never as a weighing.
 */
export function MaterialsPanel() {
  const [items, setItems] = useState<Material[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await apiRequest<{ data: Material[] }>('/api/materials')
    if (res.ok) setItems(res.data.data)
  }, [])
  useEffect(() => { if (open) void load() }, [open, load])

  async function add() {
    setError('')
    const res = await apiRequest('/api/materials', { method: 'POST', json: {
      name: form.name,
      wasteCode: form.wasteCode || undefined,
      densityKgM3: form.densityKgM3 ? Number(form.densityKgM3) : null,
      fillFactor: Number(form.fillFactor) / 100,
      uncertaintyPct: Number(form.uncertaintyPct) / 100,
    } })
    if (!res.ok) { setError(res.error); return }
    setForm(blank)
    void load()
  }
  async function archive(id: string) {
    const res = await apiRequest(`/api/materials/${id}`, { method: 'DELETE' })
    if (!res.ok) setError(res.error)
    void load()
  }

  const inp = 'bg-white border border-surface-200 rounded-lg px-2 py-1 text-xs w-full focus:outline-none focus:border-[#0055A4]'
  return (
    <section className="border-t border-surface-200 flex-shrink-0">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-surface-600 hover:bg-surface-50">
        <span>Matières et densités (estimation des poids)</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-surface-500">
              <tr><th className="text-left font-medium py-1">Matière</th><th className="text-left font-medium">Code déchet</th><th className="text-right font-medium">Densité (kg/m³)</th><th className="text-right font-medium">Remplissage</th><th className="text-right font-medium">Incertitude</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {items.map(m => (
                <tr key={m.id}>
                  <td className="py-1.5 font-medium text-surface-800">{m.name}{m.hazardous ? ' ⚠' : ''}</td>
                  <td className="font-mono text-surface-600">{m.wasteCode || '—'}</td>
                  <td className="text-right font-mono">{m.densityKgM3 ?? '—'}</td>
                  <td className="text-right font-mono">{Math.round(m.fillFactor * 100)} %</td>
                  <td className="text-right font-mono">± {Math.round(m.uncertaintyPct * 100)} %</td>
                  <td className="text-right"><Btn onClick={() => void archive(m.id)} variant="ghost" size="xs" title={`Archiver ${m.name}`}>Archiver</Btn></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="py-2 text-surface-500">Aucune matière : sans densité, aucun poids n&apos;est estimé (seuls les poids pesés ou déclarés comptent).</td></tr>}
            </tbody>
          </table>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <label className="text-[11px] text-surface-500 md:col-span-2">Nom<input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Gravats" /></label>
            <label className="text-[11px] text-surface-500">Code déchet<input className={inp} value={form.wasteCode} onChange={e => setForm(f => ({ ...f, wasteCode: e.target.value }))} placeholder="17 01 07" /></label>
            <label className="text-[11px] text-surface-500">Densité kg/m³<input className={inp} type="number" min={1} max={5000} value={form.densityKgM3} onChange={e => setForm(f => ({ ...f, densityKgM3: e.target.value }))} placeholder="1500" /></label>
            <label className="text-[11px] text-surface-500">Remplissage %<input className={inp} type="number" min={5} max={100} value={form.fillFactor} onChange={e => setForm(f => ({ ...f, fillFactor: e.target.value }))} /></label>
            <label className="text-[11px] text-surface-500">Incertitude %<input className={inp} type="number" min={0} max={100} value={form.uncertaintyPct} onChange={e => setForm(f => ({ ...f, uncertaintyPct: e.target.value }))} /></label>
          </div>
          <div className="flex items-center gap-3">
            <Btn onClick={() => void add()} variant="primary" size="sm" disabled={!form.name.trim()}>Ajouter la matière</Btn>
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
