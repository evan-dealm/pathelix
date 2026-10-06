'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { usePermissions, hasPerm } from '@/hooks/usePermissions'
import { SubTabs, eur } from '../commercial/shared'
import type { Kpis } from '@/lib/insights/kpis'
import type { Forecast } from '@/lib/insights/forecast'
import type { ProfitGroup, MissionProfit, GroupKey } from '@/lib/insights/profitability'
import { SimulationView } from './SimulationView'

type View = 'kpis' | 'profit' | 'forecast' | 'simulate'
const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000))
const fr = (d: string) => d.split('-').reverse().join('/')
const num = (n: number | null | undefined, unit = '') => (n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR')}${unit}`)

/** Pilotage: operations cockpit, profitability (view_costs), volume forecast and what-if simulation (optimize). */
export function InsightsTab() {
  const { permissions } = usePermissions()
  const canCosts = hasPerm(permissions, 'view_costs')
  const canOptimize = hasPerm(permissions, 'optimize')
  const [view, setView] = useState<View>('kpis')
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(iso(new Date()))
  const tabs: Array<[View, string]> = [['kpis', 'Indicateurs'], ...(canCosts ? [['profit', 'Rentabilité'] as [View, string]] : []), ['forecast', 'Prévisions'], ...(canOptimize ? [['simulate', 'Simulation'] as [View, string]] : [])]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-surface-200 px-4 py-3">
        <h1 className="font-display text-lg font-semibold text-surface-900">Pilotage</h1>
        <SubTabs label="Pilotage" value={view} onChange={setView} tabs={tabs} />
        {(view === 'kpis' || view === 'profit') && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">Du<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-surface-200 px-2 py-1" /></label>
            <label className="flex items-center gap-1">au<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="rounded-lg border border-surface-200 px-2 py-1" /></label>
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {view === 'kpis' && <KpiView from={from} to={to} />}
        {view === 'profit' && canCosts && <ProfitView from={from} to={to} />}
        {view === 'forecast' && <ForecastView />}
        {view === 'simulate' && canOptimize && <SimulationView />}
      </div>
    </div>
  )
}

function useData<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setData(null)
    const r = await apiRequest<T>(url)
    if (r.ok) { setData(r.data); setError('') } else setError(r.error)
  }, [url])
  useEffect(() => { void load() }, [load])
  return { data, error }
}

function Delta({ cur, prev, better = 'up' }: { cur: number | null; prev: number | null; better?: 'up' | 'down' }) {
  if (cur === null || prev === null || prev === 0) return null
  const d = Math.round((cur - prev) / Math.abs(prev) * 100)
  if (d === 0) return <span className="text-xs text-surface-500">stable</span>
  const good = better === 'up' ? d > 0 : d < 0
  return <span className={`text-xs ${good ? 'text-emerald-700' : 'text-red-700'}`}>{d > 0 ? '+' : ''}{d} % vs période précédente</span>
}

function Stat({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-surface-200">
      <dt className="text-xs text-surface-500">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-surface-900">{value}</dd>
      {sub && <p className="text-xs text-surface-500">{sub}</p>}
      {children}
    </div>
  )
}

function KpiView({ from, to }: { from: string; to: string }) {
  const { data, error } = useData<{ current: Kpis; previous: Kpis }>(`/api/insights/kpis?from=${from}&to=${to}`)
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!data) return <p role="status" className="text-sm text-surface-500">Calcul…</p>
  const c = data.current; const p = data.previous
  return (
    <div className="space-y-6">
      <section aria-labelledby="k-ops">
        <h2 id="k-ops" className="mb-2 text-sm font-medium text-surface-800">Exploitation</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Interventions réalisées" value={num(c.missions.done)} sub={`${num(c.missions.planned)} planifiées · ${num(c.missions.failed)} en échec`}><Delta cur={c.missions.done} prev={p.missions.done} /></Stat>
          <Stat label="Taux de réalisation" value={num(c.missions.completionPct, ' %')} sub={`${num(c.missions.notPlanned)} mission(s) jamais planifiée(s)`} />
          <Stat label="Ponctualité (créneaux client)" value={num(c.punctuality.pct, ' %')} sub={c.punctuality.withWindow ? `${c.punctuality.onTime}/${c.punctuality.withWindow} arrivées dans le créneau` : 'Aucune arrivée horodatée sur créneau'}><Delta cur={c.punctuality.pct} prev={p.punctuality.pct} /></Stat>
          <Stat label="Interventions par tournée" value={num(c.tours.missionsPerTour)} sub={`${num(c.tours.count)} tournées`}><Delta cur={c.tours.missionsPerTour} prev={p.tours.missionsPerTour} /></Stat>
          <Stat label="Kilomètres" value={num(c.tours.km, ' km')} sub={c.tours.kmMeasured ? `dont ${num(c.tours.kmMeasured)} km mesurés` : 'estimés (aucun relevé GPS)'}><Delta cur={c.tours.km} prev={p.tours.km} better="down" /></Stat>
          <Stat label="Heures de tournée" value={num(c.tours.hours, ' h')} />
          <Stat label="Tonnage pesé" value={num(c.tonnage.tonnes, ' t')} sub={`${c.tonnage.tickets} tickets${c.tonnage.pendingReview ? ` · ${c.tonnage.pendingReview} à vérifier` : ''}`}><Delta cur={c.tonnage.tonnes} prev={p.tonnage.tonnes} /></Stat>
          <Stat label="Bennes chez les clients" value={num(c.bins.utilisationPct, ' %')} sub={`${c.bins.atCustomers}/${c.bins.total} · ${num(c.bins.avgDaysOnSite)} j en moyenne`} />
        </dl>
      </section>
      {c.money && p.money && (
        <section aria-labelledby="k-money">
          <h2 id="k-money" className="mb-2 text-sm font-medium text-surface-800">Commercial</h2>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Facturé (HT)" value={eur(c.money.invoicedHT)}><Delta cur={c.money.invoicedHT} prev={p.money.invoicedHT} /></Stat>
            <Stat label="Encaissé" value={eur(c.money.collected)}><Delta cur={c.money.collected} prev={p.money.collected} /></Stat>
            <Stat label="Retards de paiement (TTC)" value={eur(c.money.overdueTTC)} sub="à ce jour, toutes périodes" />
            <Stat label="Interventions non facturées" value={num(c.money.unbilledDone)} sub="réalisées sur la période" />
          </dl>
        </section>
      )}
      <p className="text-xs text-surface-500">Du {fr(c.from)} au {fr(c.to)}, comparé au {fr(p.from)} – {fr(p.to)}. Chiffres issus des tournées enregistrées, des statuts terrain, des pesées et de la facturation.</p>
    </div>
  )
}

interface ProfitResponse {
  totals: { revenueHT: number; cost: number; margin: number; missions: number }
  groups: Array<ProfitGroup & { label: string }>
  worst: Array<MissionProfit & { driver: string }>
  gaps: string[]
  rates: { driverHourlyCostEur: number | null; wearPerKm: number; fuelPerKm: number }
}
const GROUP_LABEL: Record<GroupKey, string> = { client: 'Client', driver: 'Chauffeur', vehicle: 'Camion', type: 'Type', day: 'Jour' }

function ProfitView({ from, to }: { from: string; to: string }) {
  const [by, setBy] = useState<GroupKey>('client')
  const { data, error } = useData<ProfitResponse>(`/api/insights/profitability?from=${from}&to=${to}&by=${by}`)
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!data) return <p role="status" className="text-sm text-surface-500">Calcul…</p>
  const pct = data.totals.revenueHT > 0 ? Math.round(data.totals.margin / data.totals.revenueHT * 100) : null
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Chiffre d'affaires (HT)" value={eur(data.totals.revenueHT)} sub={`${data.totals.missions} interventions`} />
        <Stat label="Coût estimé" value={eur(data.totals.cost)} sub={`${data.rates.driverHourlyCostEur !== null ? `${data.rates.driverHourlyCostEur} €/h` : 'main-d\'œuvre non comptée'} · ${(data.rates.wearPerKm + data.rates.fuelPerKm).toFixed(2)} €/km`} />
        <Stat label="Marge" value={eur(data.totals.margin)} sub={pct !== null ? `${pct} % du CA` : undefined} />
      </dl>
      {data.gaps.length > 0 && <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.gaps.map(g => <li key={g}>{g}</li>)}</ul>}
      <div className="flex items-center gap-2 text-sm">
        <span>Regrouper par</span>
        {(Object.keys(GROUP_LABEL) as GroupKey[]).map(k => (
          <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={`rounded-lg px-2.5 py-1 ${by === k ? 'bg-brand-50 font-medium text-brand-700' : 'text-surface-600 hover:bg-surface-100'}`}>{GROUP_LABEL[k]}</button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-surface-200">
        <table className="w-full text-sm">
          <caption className="sr-only">Rentabilité par {GROUP_LABEL[by].toLowerCase()}, de la moins rentable à la plus rentable</caption>
          <thead className="text-left text-xs text-surface-500"><tr>
            <th className="px-4 py-2 font-medium">{GROUP_LABEL[by]}</th><th className="px-2 py-2 text-right font-medium">Interv.</th><th className="px-2 py-2 text-right font-medium">Heures</th><th className="px-2 py-2 text-right font-medium">km</th>
            <th className="px-2 py-2 text-right font-medium">CA HT</th><th className="px-2 py-2 text-right font-medium">Coût</th><th className="px-2 py-2 text-right font-medium">Marge</th><th className="px-4 py-2 text-right font-medium">Marge %</th>
          </tr></thead>
          <tbody className="divide-y divide-surface-100 tabular-nums">
            {data.groups.map(g => (
              <tr key={g.key}>
                <td className="px-4 py-2">{by === 'day' ? fr(g.label) : g.label}{g.invoicedMissions < g.missions && <span className="block text-xs text-amber-700">{g.missions - g.invoicedMissions} non facturée(s)</span>}</td>
                <td className="px-2 py-2 text-right">{g.missions}</td><td className="px-2 py-2 text-right">{(g.minutes / 60).toFixed(1)}</td><td className="px-2 py-2 text-right">{g.km}</td>
                <td className="px-2 py-2 text-right">{eur(g.revenueHT)}</td><td className="px-2 py-2 text-right">{eur(g.cost)}</td>
                <td className={`px-2 py-2 text-right font-medium ${g.margin < 0 ? 'text-red-700' : ''}`}>{eur(g.margin)}</td>
                <td className="px-4 py-2 text-right">{g.marginPct === null ? '—' : `${g.marginPct} %`}</td>
              </tr>
            ))}
            {data.groups.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-surface-500">Aucune tournée réalisée sur la période.</td></tr>}
          </tbody>
        </table>
      </div>
      {data.worst.length > 0 && (
        <section aria-labelledby="worst">
          <h2 id="worst" className="mb-2 text-sm font-medium text-surface-800">Interventions facturées les moins rentables</h2>
          <ul className="divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
            {data.worst.map(w => (
              <li key={w.missionId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span>{fr(w.date)} · {w.clientName || 'Sans client'} · {w.type}<span className="block text-xs text-surface-500">{w.driver} · {(w.minutes / 60).toFixed(1)} h · {w.km} km{w.dumpCost ? ` · traitement ${eur(w.dumpCost)}` : ''}</span></span>
                <span className="tabular-nums">{eur(w.revenueHT)} − {eur(w.cost)} = <strong className={w.margin < 0 ? 'text-red-700' : ''}>{eur(w.margin)}</strong></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

interface Recurrence { siteId: string; siteName: string; clientName: string; predictedDate: string; confidence: number; avgIntervalDays: number; lastCollectDate: string }

function ForecastView() {
  const { data, error } = useData<{ forecast: Forecast; recurrences: Recurrence[] }>('/api/insights/forecast?days=14')
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!data) return <p role="status" className="text-sm text-surface-500">Calcul…</p>
  const f = data.forecast
  const max = Math.max(1, ...f.days.map(d => d.high))
  return (
    <div className="space-y-6">
      <section aria-labelledby="f-vol" className="rounded-xl bg-white p-4 ring-1 ring-surface-200">
        <h2 id="f-vol" className="text-sm font-medium text-surface-800">Volume attendu — 14 prochains jours</h2>
        {f.reason ? <p className="mt-2 text-sm text-surface-600">{f.reason}. La prévision apparaîtra quand l&apos;historique le permettra.</p> : (
          <>
            <p className="mt-1 text-xs text-surface-500">Moyenne du même jour de la semaine sur les {Math.min(8, f.weeksOfHistory)} dernières semaines, fourchette à 80 %. Erreur mesurée sur les 4 dernières semaines : {f.mae ?? '—'} intervention(s)/jour{f.mape !== null ? ` (${f.mape} %)` : ''}.</p>
            <ol className="mt-4 grid grid-cols-7 gap-2 sm:[grid-template-columns:repeat(14,minmax(0,1fr))]" aria-label="Prévision par jour">
              {f.days.map(d => (
                <li key={d.date} className="flex flex-col items-center gap-1 text-xs">
                  <div className="relative h-28 w-6 rounded bg-surface-50" aria-hidden>
                    <div className="absolute inset-x-0 rounded bg-brand-100" style={{ bottom: `${d.low / max * 100}%`, height: `${Math.max(2, (d.high - d.low) / max * 100)}%` }} />
                    <div className="absolute inset-x-0 h-0.5 bg-brand-600" style={{ bottom: `${d.expected / max * 100}%` }} />
                    {d.booked > 0 && <div className="absolute inset-x-1 rounded-sm bg-surface-400/60" style={{ bottom: 0, height: `${d.booked / max * 100}%` }} />}
                  </div>
                  <span className="font-medium tabular-nums">{d.expected}</span>
                  <span className="text-surface-500">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}</span>
                  <span className="sr-only">{d.low} à {d.high} attendues, {d.booked} déjà enregistrées</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-surface-500">Trait : valeur attendue · bande : fourchette · gris : déjà enregistrées.</p>
          </>
        )}
      </section>
      <section aria-labelledby="f-sites">
        <h2 id="f-sites" className="mb-2 text-sm font-medium text-surface-800">Sites qui devraient appeler bientôt</h2>
        <ul className="divide-y divide-surface-100 rounded-xl bg-white text-sm ring-1 ring-surface-200">
          {data.recurrences.slice(0, 20).map(r => (
            <li key={r.siteId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
              <span>{r.siteName}{r.clientName ? ` · ${r.clientName}` : ''}<span className="block text-xs text-surface-500">rotation tous les {r.avgIntervalDays} j en général · dernière le {fr(r.lastCollectDate)}</span></span>
              <span className="text-right">vers le {fr(r.predictedDate)}<span className="block text-xs text-surface-500">régularité {Math.round(r.confidence * 100)} %</span></span>
            </li>
          ))}
          {data.recurrences.length === 0 && <li className="px-4 py-3 text-surface-500">Aucun site au rythme assez régulier pour être anticipé.</li>}
        </ul>
      </section>
    </div>
  )
}
