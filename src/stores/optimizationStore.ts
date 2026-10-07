import { create } from 'zustand'
import type { OptimizationResult } from '@/lib/types'

interface OptimizationState {
  isOptimizing: boolean
  progress: number
  elapsed: number
  error: string | null
  stats: { assigned: number; total: number; score: number; routingSource?: string } | null

  date: string | null

  startOptimization: (
    _date: string,
    _existingPlans: Record<string, string[]>,
    _weights: { distance: number; punctuality: number; balance: number; stability?: number },
    _onComplete: (_result: OptimizationResult) => void,
    _usePareto?: boolean,
  ) => void
  cancel: () => void
  reset: () => void
}

let _pollInterval: ReturnType<typeof setInterval> | null = null
let _timerInterval: ReturnType<typeof setInterval> | null = null
let _cancelled = false
let _t0 = 0
let _currentJobNonce = 0
let _waitingStart = 0

const WAITING_TIMEOUT_MS = 20_000

function stopTimers() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null }
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null }
  _waitingStart = 0
}

export const useOptimizationStore = create<OptimizationState>((set, _get) => ({
  isOptimizing: false,
  progress: 0,
  elapsed: 0,
  error: null,
  stats: null,
  date: null,

  reset() {
    stopTimers()
    _cancelled = false
    set({ isOptimizing: false, progress: 0, elapsed: 0, error: null, stats: null, date: null })
  },

  cancel() {
    _cancelled = true
    stopTimers()
    set({ isOptimizing: false, progress: 0, error: 'Optimisation annulée' })
  },

  async startOptimization(date, existingPlans, weights, onComplete, usePareto) {

    stopTimers()
    _cancelled = false
    _waitingStart = 0
    _t0 = Date.now()

    const myNonce = ++_currentJobNonce
    set({ isOptimizing: true, progress: 0, elapsed: 0, error: null, stats: null, date })

    _timerInterval = setInterval(() => {
      if (_cancelled) return
      set({ elapsed: Math.round((Date.now() - _t0) / 1000) })
    }, 500)

    try {

      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, existingPlans, options: { weights, usePareto } }),
      })
      const data = await res.json() as {
        status: string
        jobId?: string
        result?: OptimizationResult
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Erreur serveur')
      if (_cancelled || myNonce !== _currentJobNonce) return

      if (data.status === 'completed' && data.result) {
        if (myNonce !== _currentJobNonce) return
        stopTimers()
        const result = data.result
        set({
          isOptimizing: false,
          progress: 100,
          stats: {
            assigned: result.stats.assignedMissions,
            total: result.stats.totalMissions,
            score: Math.round(result.stats.globalScore ?? result.stats.score ?? 0),
            routingSource: result.stats.routingSource,
          },
        })
        onComplete(result)
        return
      }

      const jobId = data.jobId
      if (!jobId) { set({ isOptimizing: false, error: 'Job ID manquant' }); return }
      set({ progress: 5 })

      const POLL_TIMEOUT_MS = 10 * 60 * 1000
      _pollInterval = setInterval(async () => {
        if (_cancelled || myNonce !== _currentJobNonce) { stopTimers(); return }
        if (Date.now() - _t0 > POLL_TIMEOUT_MS) {
          stopTimers()
          set({ isOptimizing: false, progress: 0, error: 'Délai dépassé (10 min). Le calcul a peut-être échoué.' })
          return
        }

        try {
          const pollRes = await fetch(`/api/optimize/${jobId}`)
          const pollData = await pollRes.json() as {
            status: string
            progress?: number
            result?: OptimizationResult
            error?: string
          }

          if (_cancelled) return

          if (pollData.status === 'waiting') {

            if (!_waitingStart) _waitingStart = Date.now()
            if (Date.now() - _waitingStart > WAITING_TIMEOUT_MS) {
              stopTimers()
              set({
                isOptimizing: false, progress: 0,
                error: 'Serveur de calcul indisponible. Réessayez dans un instant ; si le problème persiste, contactez votre administrateur.',
              })
            }
            return
          }

          _waitingStart = 0

          if (pollData.status === 'active' && typeof pollData.progress === 'number') {
            set({ progress: Math.max(5, pollData.progress) })
          }

          if (pollData.status === 'completed' && pollData.result) {
            stopTimers()
            if (myNonce !== _currentJobNonce) return
            const result = pollData.result
            set({
              isOptimizing: false,
              progress: 100,
              stats: {
                assigned: result.stats.assignedMissions,
                total: result.stats.totalMissions,
                score: Math.round(result.stats.globalScore ?? result.stats.score ?? 0),
                routingSource: result.stats.routingSource,
              },
            })
            onComplete(result)
          } else if (pollData.status === 'failed') {
            stopTimers()
            set({ isOptimizing: false, progress: 0, error: pollData.error ?? 'Le calcul a échoué' })
          } else if (pollData.status === 'unknown') {
            stopTimers()
            set({ isOptimizing: false, progress: 0, error: 'Job introuvable ou expiré' })
          }
        } catch {

          if (_cancelled) stopTimers()
        }
      }, 500)

    } catch (err) {
      stopTimers()
      if (!_cancelled) {
        set({
          isOptimizing: false,
          progress: 0,
          error: err instanceof Error ? err.message : 'Erreur réseau',
        })
      }
    }
  },
}))
