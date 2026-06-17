'use client'

import { useState, useCallback } from 'react'
import { TRADES, type TradeId, TRADE_IDS } from '@/lib/trades'

interface WizardState {
  trade:            TradeId | null
  companyName:      string
  timezone:         string
  defaultStartTime: string
  seedData:         boolean
}

const TIMEZONES = [
  'Europe/Paris', 'Europe/London', 'Europe/Brussels', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Zurich', 'Africa/Casablanca', 'Africa/Tunis',
]

export default function OnboardingPage() {
  const [step, setStep]   = useState<1 | 2 | 3 | 4>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const [state, setState] = useState<WizardState>({
    trade:            null,
    companyName:      '',
    timezone:         'Europe/Paris',
    defaultStartTime: '07:00',
    seedData:         true,
  })

  const update = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  async function handleFinish() {
    if (!state.trade) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/onboarding', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          trade:            state.trade,
          companyName:      state.companyName || undefined,
          timezone:         state.timezone,
          defaultStartTime: state.defaultStartTime,
          seedData:         state.seedData,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(typeof data.error === 'string' ? data.error : 'Erreur serveur')
        return
      }
      window.location.replace('/admin')
    } catch {
      setError('Impossible de contacter le serveur')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="relative z-[1] max-w-3xl w-full">

        {}
        <div className="flex items-center gap-2 mb-10">
          {([1, 2, 3] as const).map(s => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-all
                ${step > s ? 'bg-green-600 text-white' : step === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                {step > s ? '✓' : s}
              </div>
              {s < 3 && (
                <div className={`flex-1 h-0.5 rounded transition-all ${step > s ? 'bg-green-600' : 'bg-gray-800'}`} />
              )}
            </div>
          ))}
        </div>

        {}
        {step === 1 && (
          <div>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black tracking-tight">Bienvenue sur Pathélix</h1>
              <p className="text-gray-400 mt-2 text-lg">Quel est votre secteur d&apos;activité ?</p>
              <p className="text-gray-500 text-sm mt-1">
                Ce choix adapte le vocabulaire et les fonctionnalités à votre métier.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {TRADE_IDS.map(id => {
                const trade      = TRADES[id]
                const isSelected = state.trade === id
                return (
                  <button key={id} type="button" onClick={() => update('trade', id)}
                    className={`relative text-left p-5 rounded-2xl border-2 transition-all duration-200
                      ${isSelected
                        ? 'border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/30 shadow-lg shadow-blue-500/10'
                        : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/80'}`}>
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    <div className="text-3xl mb-3">{trade.vocabulary.tradeIcon}</div>
                    <div className="font-bold text-white text-lg">{trade.vocabulary.tradeName}</div>
                    <div className="text-gray-400 text-sm mt-1 leading-relaxed">{trade.vocabulary.tradeDescription}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{trade.vocabulary.driver}</span>
                      <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{trade.vocabulary.mission}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="text-center">
              <button type="button" onClick={() => setStep(2)} disabled={!state.trade}
                className={`px-8 py-3 rounded-xl font-bold text-lg transition-all
                  ${state.trade ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}>
                Continuer →
              </button>
            </div>
          </div>
        )}

        {}
        {step === 2 && (
          <div>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black tracking-tight">Votre entreprise</h1>
              <p className="text-gray-400 mt-2">Quelques informations pour personnaliser l&apos;interface.</p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5 mb-8">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">
                  Nom de l&apos;entreprise <span className="text-gray-500 font-normal">(optionnel)</span>
                </label>
                <input
                  type="text"
                  value={state.companyName}
                  onChange={e => update('companyName', e.target.value)}
                  placeholder="Ex: Transports Dupont"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Fuseau horaire</label>
                <select
                  value={state.timezone}
                  onChange={e => update('timezone', e.target.value)}
                  title="Fuseau horaire"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">
                  Heure de départ par défaut
                </label>
                <input
                  type="time"
                  value={state.defaultStartTime}
                  onChange={e => update('defaultStartTime', e.target.value)}
                  title="Heure de départ par défaut"
                  className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                />
                <p className="text-gray-500 text-xs mt-1">Heure à laquelle vos chauffeurs commencent leur tournée.</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setStep(1)}
                className="px-6 py-2.5 rounded-xl font-semibold text-gray-400 hover:text-white transition-colors">
                ← Retour
              </button>
              <button type="button" onClick={() => setStep(3)}
                className="px-8 py-3 rounded-xl font-bold text-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-all">
                Continuer →
              </button>
            </div>
          </div>
        )}

        {}
        {step === 3 && (
          <div>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black tracking-tight">Données de démarrage</h1>
              <p className="text-gray-400 mt-2">Voulez-vous créer des exemples pour commencer ?</p>
            </div>

            <div className="space-y-4 mb-8">
              <button type="button" onClick={() => update('seedData', true)}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all
                  ${state.seedData ? 'border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/30' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
                    ${state.seedData ? 'border-blue-500 bg-blue-500' : 'border-gray-600'}`}>
                    {state.seedData && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <span className="font-bold text-white">🚀 Oui, créer des exemples</span>
                </div>
                <p className="text-gray-400 text-sm ml-8">
                  Nous créerons 2 chauffeurs et 3 missions exemples pour demain, afin que vous puissiez
                  explorer les fonctionnalités immédiatement.
                </p>
              </button>

              <button type="button" onClick={() => update('seedData', false)}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all
                  ${!state.seedData ? 'border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/30' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
                    ${!state.seedData ? 'border-blue-500 bg-blue-500' : 'border-gray-600'}`}>
                    {!state.seedData && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <span className="font-bold text-white">🧹 Non, partir de zéro</span>
                </div>
                <p className="text-gray-400 text-sm ml-8">
                  Démarrez avec une interface vierge et ajoutez vos données réelles directement.
                </p>
              </button>
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-800/30 rounded-xl p-3 text-red-300 text-sm text-center mb-4">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setStep(2)}
                className="px-6 py-2.5 rounded-xl font-semibold text-gray-400 hover:text-white transition-colors">
                ← Retour
              </button>
              <button type="button" onClick={handleFinish} disabled={saving}
                className="px-8 py-3 rounded-xl font-bold text-lg bg-green-600 hover:bg-green-500 disabled:opacity-60 disabled:cursor-not-allowed text-white shadow-lg transition-all flex items-center gap-2">
                {saving ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Configuration…
                  </>
                ) : '✓ Terminer la configuration'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
