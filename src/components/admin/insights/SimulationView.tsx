'use client'

import { useEffect, useState } from 'react'
import { apiRequest, fetchAllPages } from '@/lib/apiClient'
import type { PlanSummary } from '@/lib/vrp/summary'

interface DriverRow { id: string; firstName: string; lastName: string; archived?: boolean }
interface Result { budgetMs: number; baseline: PlanSummary; scenario: PlanSummary; scenarioUnassigned: Array<{ id: string; clientName: string; address: string; reason: string }> }

const ROWS: Array<[keyof PlanSummary, string, 'up' | 'down']> = [
  ['assigned', 'Missions planifiées', 'up'], ['unassigned', 'Non planifiées', 'down'], ['p1Unassigned', 'Urgences non planifiées', 'down'],
  ['driversUsed', 'Chauffeurs utilisés', 'down'], ['km', 'Kilomètres', 'down'], ['hours', 'Heures de tournée', 'down'],
  ['longestTourH', 'Tournée la plus longue (h)', 'down'], ['lateStops', 'Arrivées hors créneau', 'down'], ['regulatoryIssues', 'Alertes CE 561 / temps de travail', 'down'],
]

/** What-if on a day: nothing is saved; both plans are computed with the same budget and seed. */
export function SimulationView() {
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [date, setDate] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
  const [absent, setAbsent] = useState<string[]>([])
  const [like, setLike] = useState('')
  const [extra, setExtra] = useState(0)
  const [start, setStart] = useState('')
  const [surge, setSurge] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => { void fetchAllPages<DriverRow>('/api/drivers').then(d => setDrivers(d.filter(x => !x.archived))).catch(() => undefined) }, [])

  async function run() {
    setBusy(true); setError(''); setResult(null)
    const r = await apiRequest<Result>('/api/optimize/simulate', {
      method: 'POST',
      json: { date, scenario: { removeDriverIds: absent, ...(extra > 0 && like ? { addTrucks: { like, count: extra } } : {}), ...(start ? { startTime: start } : {}), surgePct: surge } },
    })
    setBusy(false)
    if (r.ok) setResult(r.data); else setError(r.error)
  }
  const name = (d: DriverRow) => `${d.firstName} ${d.lastName}`.trim()

  return (
    <div className="space-y-5">
      <section aria-labelledby="sim-form" className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-surface-200">
        <h2 id="sim-form" className="text-sm font-medium text-surface-800">Et si…</h2>
        <p className="text-xs text-surface-500">Les missions du jour sont planifiées deux fois, telles quelles puis avec votre scénario. Rien n&apos;est enregistré ni envoyé aux chauffeurs.</p>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <label>Jour<input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-200 px-2 py-1" /></label>
          <label>Début de journée<input type="time" value={start} onChange={e => setStart(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-200 px-2 py-1" /></label>
          <label>Hausse du volume (%)<input type="number" min={0} max={100} value={surge} onChange={e => setSurge(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="mt-1 block w-full rounded-lg border border-surface-200 px-2 py-1" /></label>
          <div className="flex items-end gap-2">
            <label className="flex-1">Camions en plus<input type="number" min={0} max={10} value={extra} onChange={e => setExtra(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} className="mt-1 block w-full rounded-lg border border-surface-200 px-2 py-1" /></label>
            <label className="flex-1">comme<select value={like} onChange={e => setLike(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-200 px-2 py-1"><option value="">—</option>{drivers.map(d => <option key={d.id} value={d.id}>{name(d)}</option>)}</select></label>
          </div>
        </div>
        <fieldset>
          <legend className="text-sm">Chauffeurs absents</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {drivers.map(d => (
              <label key={d.id} className={`cursor-pointer rounded-lg px-2 py-1 text-xs ring-1 ${absent.includes(d.id) ? 'bg-red-50 text-red-800 ring-red-200' : 'ring-surface-200'}`}>
                <input type="checkbox" className="sr-only" checked={absent.includes(d.id)} onChange={e => setAbsent(a => e.target.checked ? [...a, d.id] : a.filter(x => x !== d.id))} />{name(d)}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="button" disabled={busy} onClick={() => void run()} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">{busy ? 'Calcul des deux plannings… (environ 15 s)' : 'Comparer'}</button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>
      {result && (
        <section aria-labelledby="sim-res" className="rounded-xl bg-white ring-1 ring-surface-200">
          <h2 id="sim-res" className="px-4 pt-3 text-sm font-medium text-surface-800">Résultat</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-surface-500"><tr><th className="px-4 py-2 font-medium">Indicateur</th><th className="px-2 py-2 text-right font-medium">Tel quel</th><th className="px-4 py-2 text-right font-medium">Scénario</th></tr></thead>
            <tbody className="divide-y divide-surface-100 tabular-nums">
              {ROWS.map(([k, label, better]) => {
                const a = result.baseline[k]; const b = result.scenario[k]
                const tone = a === b ? '' : (b > a) === (better === 'up') ? 'text-emerald-700' : 'text-red-700'
                return <tr key={k}><td className="px-4 py-2">{label}</td><td className="px-2 py-2 text-right">{a.toLocaleString('fr-FR')}</td><td className={`px-4 py-2 text-right font-medium ${tone}`}>{b.toLocaleString('fr-FR')}</td></tr>
              })}
            </tbody>
          </table>
          {result.scenarioUnassigned.length > 0 && (
            <div className="border-t border-surface-100 px-4 py-3 text-sm">
              <p className="font-medium">Non planifiées dans le scénario</p>
              <ul className="mt-1 space-y-0.5 text-xs text-surface-700">{result.scenarioUnassigned.map(u => <li key={u.id}>{u.clientName || u.address}{u.reason ? ` — ${u.reason}` : ''}</li>)}</ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
