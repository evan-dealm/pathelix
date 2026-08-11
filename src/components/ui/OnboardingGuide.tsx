'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'pathelix-onboarding-v1'

export interface OnboardingStep {
  title: string
  description: string
  icon?: string
}

const ADMIN_STEPS: OnboardingStep[] = [
  {
    icon: '🗺️',
    title: 'Planifiez vos tournées',
    description: 'Glissez les missions sur le planning (onglet Tournées). Lancez l\'optimisation VRP en un clic pour générer des itinéraires optimaux.',
  },
  {
    icon: '🚛',
    title: 'Gérez votre flotte',
    description: 'Ajoutez chauffeurs et véhicules dans les onglets dédiés. Chaque chauffeur reçoit son plan journalier sur son téléphone.',
  },
  {
    icon: '📊',
    title: 'Suivez les indicateurs',
    description: 'Le tableau de bord affiche KPIs, retards et taux de complétion en temps réel. Le moteur ML affine les estimations de temps automatiquement.',
  },
  {
    icon: '❓',
    title: 'Besoin d\'aide ?',
    description: 'Consultez la page Aide (menu gauche) pour les définitions métier (exutoire, VIDER, secteur…) et les procédures pas-à-pas.',
  },
]

const DRIVER_STEPS: OnboardingStep[] = [
  {
    icon: '📋',
    title: 'Votre plan du jour',
    description: 'Toutes vos missions du jour s\'affichent ici dans l\'ordre. Appuyez sur une mission pour voir les détails et démarrer.',
  },
  {
    icon: '▶️',
    title: 'Avancer une mission',
    description: 'Appuyez sur "Démarrer", puis "Arrivée", puis "Terminé". Chaque étape est enregistrée même sans connexion internet.',
  },
  {
    icon: '📶',
    title: 'Mode hors-ligne',
    description: 'Si vous perdez le réseau, vos actions sont sauvegardées localement et envoyées automatiquement dès la reconnexion.',
  },
]

interface OnboardingGuideProps {
  mode?: 'admin' | 'driver'
  forceShow?: boolean
  onClose?: () => void
}

export function OnboardingGuide({ mode = 'admin', forceShow = false, onClose }: OnboardingGuideProps) {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const steps = mode === 'driver' ? DRIVER_STEPS : ADMIN_STEPS

  useEffect(() => {
    if (forceShow) {
      setVisible(true)
      return
    }
    try {
      const done = localStorage.getItem(STORAGE_KEY)
      if (!done) setVisible(true)
    } catch {
      // localStorage unavailable (SSR or private mode) — skip
    }
  }, [forceShow])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // ignore
    }
    setVisible(false)
    onClose?.()
  }, [onClose])

  const next = useCallback(() => {
    if (step < steps.length - 1) {
      setStep(s => s + 1)
    } else {
      dismiss()
    }
  }, [step, steps.length, dismiss])

  const prev = useCallback(() => {
    setStep(s => Math.max(0, s - 1))
  }, [])

  if (!visible) return null

  const current = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-8 flex flex-col gap-6">

        {/* Progress dots */}
        <div className="flex justify-center gap-2" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-blue-600' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="text-center">
          {current.icon && (
            <div className="text-4xl mb-4" aria-hidden="true">{current.icon}</div>
          )}
          <h2 id="onboarding-title" className="text-xl font-bold text-gray-900 mb-3">
            {current.title}
          </h2>
          <p className="text-gray-600 leading-relaxed text-sm">
            {current.description}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-gray-400 hover:text-gray-600 underline focus:outline-none focus:ring-2 focus:ring-gray-300 rounded"
            aria-label="Passer le guide"
          >
            Passer
          </button>

          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={prev}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
                aria-label="Étape précédente"
              >
                Précédent
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              aria-label={isLast ? 'Terminer le guide' : 'Étape suivante'}
            >
              {isLast ? 'Commencer' : 'Suivant'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400">
          Étape {step + 1} sur {steps.length} — Rejouable depuis la page Aide
        </p>
      </div>
    </div>
  )
}

/** Call this to reset the onboarding (for replay from the Help page) */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
