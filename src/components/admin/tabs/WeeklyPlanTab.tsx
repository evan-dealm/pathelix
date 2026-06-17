'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'

interface DayStat {
  date: string
  dayName: string
  missions: number
  drivers: number
  totalKm: number
  score: number
  error?: string
}

interface WeeklyPlanResult {
  id: string
  weekStart: string
  status: string
  result?: Record<string, {
    missions?: number
    drivers?: number
    totalKm?: number
    score?: number
    error?: string
  }>
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function isMonday(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.getUTCDay() === 1
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const DAY_NAMES_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']

function resultToDayStats(weekStart: string, result: WeeklyPlanResult['result']): DayStat[] {
  return DAY_NAMES_FR.map((dayName, i) => {
    const date = addDays(weekStart, i)
    const day = result?.[date] ?? result?.[dayName] ?? {}
    return {
      date,
      dayName,
      missions: day.missions ?? 0,
      drivers:  day.drivers ?? 0,
      totalKm:  day.totalKm ?? 0,
      score:    day.score ?? 0,
      error:    day.error,
    }
  })
}

export function WeeklyPlanTab({ onNavigateToTours }: { onNavigateToTours?: (_date: string) => void }) {
  const { success: toastSuccess, error: toastError } = useToast()

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date().toISOString().slice(0, 10)
    return getMondayOfWeek(today)
  })
  const [dateError, setDateError] = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)
  const [plan, setPlan]           = useState<WeeklyPlanResult | null>(null)

  const handleDateChange = useCallback((value: string) => {
    setSelectedDate(value)
    if (value && !isMonday(value)) {
      setDateError('La date doit être un lundi')
    } else {
      setDateError(null)
    }
  }, [])

  const handleOptimize = useCallback(async () => {
    if (!selectedDate || !isMonday(selectedDate)) {
      setDateError('La date doit être un lundi')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: selectedDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError(typeof data?.error === 'string' ? data.error : 'Erreur serveur')
        return
      }
      setPlan(data as WeeklyPlanResult)
      toastSuccess('Planning hebdomadaire optimisé')
    } catch {
      toastError('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [selectedDate, toastSuccess, toastError])

  const dayStats: DayStat[] = plan?.result
    ? resultToDayStats(plan.weekStart, plan.result)
    : []

  const totalMissions = dayStats.reduce((s, d) => s + d.missions, 0)
  const totalKm       = dayStats.reduce((s, d) => s + d.totalKm, 0)
  const hasError      = dayStats.some(d => d.error)

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-surface-900 mb-1">Planning hebdomadaire</h2>
        <p className="text-sm text-surface-500">
          Lance le moteur VRP sur les 5 jours de la semaine sélectionnée et sauvegarde les plans.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-5 max-w-lg space-y-4">
        <div className="space-y-1">
          <label htmlFor="week-start" className="text-sm font-medium text-surface-700">
            Semaine (sélectionner un lundi)
          </label>
          <input
            id="week-start"
            type="date"
            value={selectedDate}
            onChange={e => handleDateChange(e.target.value)}
            className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {dateError && (
            <p className="text-xs text-red-500">{dateError}</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleOptimize}
          disabled={loading || !!dateError || !selectedDate}
          className="w-full px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? 'Optimisation en cours (5 jours)...' : plan ? 'Recalculer' : 'Optimiser la semaine'}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-sm text-surface-500">
          <span className="inline-block w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          Optimisation en cours — veuillez patienter...
        </div>
      )}

      {plan && !loading && (
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              plan.status === 'published' ? 'bg-emerald-100 text-emerald-700' :
              plan.status === 'failed'    ? 'bg-red-100 text-red-700' :
              'bg-surface-100 text-surface-500'
            }`}>
              {plan.status}
            </span>
            <span className="text-sm text-surface-500">
              Semaine du {plan.weekStart} — {totalMissions} missions · {Math.round(totalKm)} km total
            </span>
          </div>

          {hasError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700">
              Certains jours n'ont pas pu être optimisés. Vérifiez les erreurs ci-dessous.
            </div>
          )}

          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-surface-500 uppercase tracking-wider">Jour</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-500 uppercase tracking-wider">Missions</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-500 uppercase tracking-wider">Chauffeurs</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-500 uppercase tracking-wider">Km total</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-500 uppercase tracking-wider">Score</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {dayStats.map(day => (
                  <tr key={day.date} className={day.error ? 'bg-red-50' : ''}>
                    <td className="px-4 py-3 font-medium text-surface-900">
                      {day.dayName}
                      <span className="ml-1.5 text-xs text-surface-400">{day.date}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-700">{day.error ? '—' : day.missions}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-700">{day.error ? '—' : day.drivers}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-700">{day.error ? '—' : `${Math.round(day.totalKm)} km`}</td>
                    <td className="px-4 py-3 text-right">
                      {day.error
                        ? <span className="text-xs text-red-500">Erreur</span>
                        : <span className={`text-xs font-semibold ${day.score >= 80 ? 'text-emerald-600' : day.score >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                            {day.score}/100
                          </span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!day.error && onNavigateToTours && (
                        <button
                          type="button"
                          onClick={() => onNavigateToTours(day.date)}
                          className="text-xs text-brand-500 hover:text-brand-700 font-medium"
                        >
                          Voir →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
