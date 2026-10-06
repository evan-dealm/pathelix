'use client'

import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'

interface Step { id: string; done: boolean; count: number | null; tab: string }

const COPY: Record<string, { title: string; how: string }> = {
  company: { title: 'Votre entreprise', how: 'Nom affiché sur les devis, factures et l’espace client (Paramètres).' },
  drivers: { title: 'Chauffeurs', how: 'Ajoutez-les un par un ou importez un fichier CSV / Excel.' },
  vehicles: { title: 'Camions', how: 'Plaque, PTAC, tare et charge utile : l’optimiseur respecte les poids.' },
  exutoires: { title: 'Exutoires', how: 'Centres de tri, déchèteries : horaires, déchets acceptés, prix à la tonne.' },
  clients: { title: 'Clients et chantiers', how: 'Importez votre fichier clients, puis leurs sites.' },
  containers: { title: 'Parc de bennes', how: 'Types de bennes (volume, tare) puis numéros de bennes ; étiquettes QR à imprimer.' },
  pricing: { title: 'Tarifs', how: 'Une grille de prix pour chiffrer devis et factures automatiquement.' },
  missions: { title: 'Premières missions', how: 'Saisissez, importez ou dictez vos interventions.' },
  'first-plan': { title: 'Première tournée', how: 'Lancez l’optimisation sur une journée et envoyez les tournées aux chauffeurs.' },
}

const DISMISS_KEY = 'pathelix-setup-dismissed'

/** "Mise en route" checklist for a new account, computed from what is really recorded. */
export function SetupChecklist({ onNavigate }: { onNavigate: (_tab: string) => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1' } catch { /* storage unavailable */ }
    if (dismissed) return
    void apiRequest<{ steps: Step[]; complete: boolean }>('/api/onboarding/status').then(r => {
      if (r.ok && !r.data.complete) { setSteps(r.data.steps); setHidden(false) }
    })
  }, [])

  if (hidden || !steps) return null
  const done = steps.filter(s => s.done).length
  const next = steps.find(s => !s.done)
  return (
    <section aria-labelledby="setup-title" className="mx-4 mt-3 rounded-xl bg-white p-4 ring-1 ring-surface-200">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="setup-title" className="font-display text-base font-semibold text-surface-900">Mise en route</h2>
        <span className="text-sm text-surface-600">{done} étape{done > 1 ? 's' : ''} sur {steps.length}</span>
        <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-100" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Avancement de la mise en route">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${done / steps.length * 100}%` }} />
        </div>
        <button type="button" className="text-xs text-surface-500 hover:text-surface-800" onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ } setHidden(true) }}>Masquer</button>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" onClick={() => onNavigate(s.tab)}
              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm ring-1 ${s.done ? 'ring-surface-100' : s === next ? 'bg-brand-50 ring-brand-200' : 'ring-surface-200 hover:bg-surface-50'}`}>
              <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${s.done ? 'bg-emerald-600 text-white' : 'bg-surface-100 text-surface-700'}`}>{s.done ? '✓' : i + 1}</span>
              <span>
                <span className={`font-medium ${s.done ? 'text-surface-500 line-through decoration-surface-300' : 'text-surface-900'}`}>{COPY[s.id]?.title ?? s.id}</span>
                <span className="sr-only">{s.done ? ' — fait' : ' — à faire'}</span>
                {!s.done && <span className="block text-xs text-surface-600">{COPY[s.id]?.how}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
