'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { DEFECT_CATEGORY_LABEL, PLAN_DEFAULTS, PLAN_KINDS, PLAN_KIND_LABEL, type PlanKind } from '@/lib/fleet/maintenance'
import type { FleetVehicleStatus } from '@/lib/fleet/service'

const input = 'rounded-lg border border-surface-200 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100'
const today = () => new Date().toISOString().slice(0, 10)
const fr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const STATE: Record<string, [string, string]> = {
  OK: ['À jour', 'bg-emerald-50 text-emerald-700'],
  DUE_SOON: ['À prévoir', 'bg-amber-50 text-amber-800'],
  OVERDUE: ['Échu', 'bg-red-50 text-red-700'],
  UNKNOWN: ['À renseigner', 'bg-surface-100 text-surface-600'],
}
const SEVERITY: Record<string, [string, string]> = {
  CRITICAL: ['Bloquant', 'bg-red-600 text-white'], MAJOR: ['Important', 'bg-amber-100 text-amber-900'], MINOR: ['Mineur', 'bg-surface-100 text-surface-700'],
}

type Plan = FleetVehicleStatus['plans'][number]

/**
 * Maintenance board: what each truck needs and what keeps it off the road. Recording an
 * intervention restarts its follow-up; a fixed critical defect gives the truck back to planning.
 */
export function MaintenanceBoard() {
  const [vehicles, setVehicles] = useState<FleetVehicleStatus[]>([])
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ vehicle: FleetVehicleStatus; plan: Plan } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [onlyAttention, setOnlyAttention] = useState(true)

  const load = useCallback(async () => {
    const r = await apiRequest<{ vehicles: FleetVehicleStatus[] }>('/api/fleet/maintenance')
    if (r.ok) { setVehicles(r.data.vehicles); setError('') } else setError(r.error)
  }, [])
  useEffect(() => { void load() }, [load])

  async function setDefect(id: string, status: 'IN_REPAIR' | 'FIXED' | 'DISMISSED') {
    const r = await apiRequest(`/api/vehicle-defects/${id}`, { method: 'PUT', json: { status } })
    if (!r.ok) setError(r.error); else void load()
  }

  const needsAttention = (v: FleetVehicleStatus) => v.blockers.length > 0 || v.defects.length > 0 || v.plans.some(p => p.state !== 'OK')
  const shown = onlyAttention ? vehicles.filter(needsAttention) : vehicles
  const blockedCount = vehicles.filter(v => v.blockers.length > 0).length

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-surface-700">
          {blockedCount > 0 ? <strong className="text-red-700">{blockedCount} camion{blockedCount > 1 ? 's' : ''} ne peu{blockedCount > 1 ? 'vent' : 't'} pas rouler</strong> : 'Aucun camion immobilisé'}
          {' · '}{vehicles.filter(needsAttention).length} à surveiller sur {vehicles.length}
        </p>
        <label className="ml-auto inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyAttention} onChange={e => setOnlyAttention(e.target.checked)} />Seulement ceux qui demandent une action</label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {shown.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-surface-600 ring-1 ring-surface-200">{vehicles.length === 0 ? 'Aucun véhicule.' : 'Tout est à jour. Décochez le filtre pour voir le suivi de chaque camion.'}</p>}

      {shown.map(v => (
        <section key={v.id} aria-labelledby={`veh-${v.id}`} className={`rounded-xl bg-white ring-1 ${v.blockers.length ? 'ring-red-300' : 'ring-surface-200'}`}>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-surface-100 px-4 py-3">
            <h3 id={`veh-${v.id}`} className="font-display text-base font-semibold">{v.licensePlate}</h3>
            <span className="text-sm text-surface-600">{[v.brand, v.model].filter(Boolean).join(' ')} · {v.mileageKm.toLocaleString('fr-FR')} km</span>
            {v.blockers.length > 0 && <p className="w-full text-sm font-medium text-red-700">Immobilisé : {v.blockers.join(' ; ')}</p>}
          </header>

          {v.defects.length > 0 && (
            <ul className="divide-y divide-surface-100 border-b border-surface-100 text-sm">
              {v.defects.map(d => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY[d.severity]?.[1] ?? ''}`}>{SEVERITY[d.severity]?.[0] ?? d.severity}</span>
                  <span>{DEFECT_CATEGORY_LABEL[d.category as keyof typeof DEFECT_CATEGORY_LABEL] ?? d.category} — {d.description}</span>
                  <span className="text-xs text-surface-500">signalé le {new Date(d.createdAt).toLocaleDateString('fr-FR')}{d.status === 'IN_REPAIR' ? ' · en réparation' : ''}</span>
                  <span className="ml-auto flex gap-1">
                    {d.status === 'OPEN' && <Btn size="xs" variant="ghost" onClick={() => void setDefect(d.id, 'IN_REPAIR')}>En réparation</Btn>}
                    <Btn size="xs" onClick={() => void setDefect(d.id, 'FIXED')}>Réparé</Btn>
                    <Btn size="xs" variant="ghost" onClick={() => void setDefect(d.id, 'DISMISSED')}>Écarter</Btn>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <table className="w-full text-sm">
            <caption className="sr-only">Suivis d&apos;entretien de {v.licensePlate}</caption>
            <thead className="text-left text-xs text-surface-500"><tr><th className="px-4 py-2 font-medium">Suivi</th><th className="px-2 py-2 font-medium">Dernière fois</th><th className="px-2 py-2 font-medium">Prochaine échéance</th><th className="px-2 py-2 font-medium">État</th><th /></tr></thead>
            <tbody className="divide-y divide-surface-100">
              {v.plans.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2">{p.label}<span className="block text-xs text-surface-500">{[p.everyMonths ? `tous les ${p.everyMonths} mois` : '', p.everyKm ? `tous les ${p.everyKm.toLocaleString('fr-FR')} km` : ''].filter(Boolean).join(' ou ') || 'échéance fixe'}</span></td>
                  <td className="px-2 py-2 tabular-nums">{fr(p.lastDoneAt)}{p.lastDoneKm !== null ? <span className="block text-xs text-surface-500">{p.lastDoneKm.toLocaleString('fr-FR')} km</span> : null}</td>
                  <td className="px-2 py-2 tabular-nums">{fr(p.nextDate)}{p.nextKm !== null ? <span className="block text-xs text-surface-500">{p.nextKm.toLocaleString('fr-FR')} km</span> : null}</td>
                  <td className="px-2 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATE[p.state][1]}`}>{STATE[p.state][0]}</span>{p.blocking && <span className="block text-xs text-red-700">bloque le camion</span>}</td>
                  <td className="px-4 py-2 text-right"><Btn size="xs" variant="ghost" onClick={() => setDone({ vehicle: v, plan: p })}>Marquer fait</Btn></td>
                </tr>
              ))}
              {v.plans.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-surface-500">Aucun suivi : ajoutez au moins le contrôle technique, le chronotachygraphe et l&apos;assurance.</td></tr>}
            </tbody>
          </table>
          <div className="border-t border-surface-100 px-4 py-2">
            {adding === v.id ? <AddPlan vehicleId={v.id} onDone={() => { setAdding(null); void load() }} onCancel={() => setAdding(null)} /> : <Btn size="xs" variant="ghost" onClick={() => setAdding(v.id)}>Ajouter un suivi</Btn>}
          </div>
        </section>
      ))}

      {done && <DoneForm vehicle={done.vehicle} plan={done.plan} onClose={() => setDone(null)} onSaved={() => { setDone(null); void load() }} />}
    </div>
  )
}

function AddPlan({ vehicleId, onDone, onCancel }: { vehicleId: string; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<PlanKind>('CT')
  const [label, setLabel] = useState(PLAN_KIND_LABEL.CT)
  const [everyMonths, setEveryMonths] = useState<string>(String(PLAN_DEFAULTS.CT?.everyMonths ?? ''))
  const [everyKm, setEveryKm] = useState('')
  const [lastDoneAt, setLastDoneAt] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState('')
  function pick(k: PlanKind) {
    setKind(k); setLabel(PLAN_KIND_LABEL[k])
    setEveryMonths(PLAN_DEFAULTS[k]?.everyMonths ? String(PLAN_DEFAULTS[k]?.everyMonths) : '')
    setEveryKm(PLAN_DEFAULTS[k]?.everyKm ? String(PLAN_DEFAULTS[k]?.everyKm) : '')
  }
  async function save() {
    const r = await apiRequest('/api/maintenance-plans', {
      method: 'POST',
      json: { vehicleId, kind, label, everyMonths: everyMonths ? Number(everyMonths) : null, everyKm: everyKm ? Number(everyKm) : null, lastDoneAt: lastDoneAt || null, dueDate: dueDate || null },
    })
    if (!r.ok) setError(r.error); else onDone()
  }
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <label>Type<select className={`${input} block`} value={kind} onChange={e => pick(e.target.value as PlanKind)}>{PLAN_KINDS.map(k => <option key={k} value={k}>{PLAN_KIND_LABEL[k]}</option>)}</select></label>
      <label>Libellé<input className={`${input} block w-40`} value={label} onChange={e => setLabel(e.target.value)} /></label>
      <label>Tous les (mois)<input className={`${input} block w-20`} inputMode="numeric" value={everyMonths} onChange={e => setEveryMonths(e.target.value.replace(/\D/g, ''))} /></label>
      <label>Tous les (km)<input className={`${input} block w-24`} inputMode="numeric" value={everyKm} onChange={e => setEveryKm(e.target.value.replace(/\D/g, ''))} /></label>
      <label>Dernière fois<input type="date" className={`${input} block`} value={lastDoneAt} onChange={e => setLastDoneAt(e.target.value)} /></label>
      {kind === 'INSURANCE' && <label>Échéance<input type="date" className={`${input} block`} value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>}
      <Btn size="xs" onClick={() => void save()}>Ajouter</Btn>
      <Btn size="xs" variant="ghost" onClick={onCancel}>Annuler</Btn>
      {error && <p role="alert" className="w-full text-red-700">{error}</p>}
    </div>
  )
}

function DoneForm({ vehicle, plan, onClose, onSaved }: { vehicle: FleetVehicleStatus; plan: Plan; onClose: () => void; onSaved: () => void }) {
  const [doneAt, setDoneAt] = useState(today())
  const [km, setKm] = useState(String(vehicle.mileageKm || ''))
  const [cost, setCost] = useState('')
  const [by, setBy] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [error, setError] = useState('')
  async function save() {
    const r = await apiRequest('/api/maintenance', {
      method: 'POST',
      json: {
        vehicleId: vehicle.id, planId: plan.id, type: plan.kind === 'CT' || plan.kind === 'TACHOGRAPH' ? 'inspection' : plan.kind === 'TIRES' ? 'tire' : plan.kind === 'SERVICE' ? 'oil_change' : 'other',
        description: plan.label, doneAt, mileageKm: km ? Number(km) : null, costEur: cost ? Number(cost.replace(',', '.')) : null, doneBy: by,
        ...(nextDue ? { nextDueDate: nextDue } : {}),
      },
    })
    if (!r.ok) setError(r.error); else onSaved()
  }
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="done-title" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="done-title" className="font-display text-lg font-semibold">{plan.label} — {vehicle.licensePlate}</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>Fait le<input type="date" className={`${input} mt-1 block w-full`} value={doneAt} onChange={e => setDoneAt(e.target.value)} /></label>
          <label>Kilométrage<input inputMode="numeric" className={`${input} mt-1 block w-full`} value={km} onChange={e => setKm(e.target.value.replace(/\D/g, ''))} /></label>
          <label>Coût HT (€)<input inputMode="decimal" className={`${input} mt-1 block w-full`} value={cost} onChange={e => setCost(e.target.value)} /></label>
          <label>Par<input className={`${input} mt-1 block w-full`} value={by} onChange={e => setBy(e.target.value)} placeholder="Garage, centre…" /></label>
          {(plan.kind === 'INSURANCE' || !(plan.everyMonths || plan.everyKm)) && <label className="col-span-2">Nouvelle échéance<input type="date" className={`${input} mt-1 block w-full`} value={nextDue} onChange={e => setNextDue(e.target.value)} /></label>}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Annuler</Btn><Btn onClick={() => void save()}>Enregistrer</Btn></div>
      </div>
    </div>
  )
}
