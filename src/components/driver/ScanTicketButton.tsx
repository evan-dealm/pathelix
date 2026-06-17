'use client'

import { useState, useRef, useCallback } from 'react'

interface ScanTicketButtonProps {
  missionId:   string
  driverId:    string
  missionType: string
  status:      string
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'polling'; jobId: string; attempt: number }
  | { phase: 'done'; weight: string }
  | { phase: 'manual' }
  | { phase: 'error'; message: string }

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS  = 60_000

export function ScanTicketButton({ missionId, driverId, missionType, status }: ScanTicketButtonProps) {
  if (missionType !== 'VIDER' || status !== 'done' || !process.env.NEXT_PUBLIC_AI_ENGINE_URL) {
    return null
  }

  return <ScanTicketCore missionId={missionId} driverId={driverId} />
}

function ScanTicketCore({ missionId, driverId }: { missionId: string; driverId: string }) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' })
  const [manualWeight, setManualWeight] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef<number>(0)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const pollJob = useCallback((jobId: string) => {
    stopPolling()
    const elapsed = Date.now() - startTimeRef.current
    if (elapsed >= POLL_TIMEOUT_MS) {
      setState({ phase: 'manual' })
      return
    }

    pollTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${jobId}`)
        if (!res.ok) {
          setState({ phase: 'manual' })
          return
        }
        const job = await res.json()

        if (job.status === 'done') {
          const weight = (job.outputData as Record<string, unknown>)?.weight as string | undefined
          if (weight) {
            setState({ phase: 'done', weight: String(weight) })
          } else {
            setState({ phase: 'manual' })
          }
        } else if (job.status === 'failed' || job.status === 'expired') {
          setState({ phase: 'manual' })
        } else {
          setState(prev =>
            prev.phase === 'polling'
              ? { phase: 'polling', jobId, attempt: prev.attempt + 1 }
              : prev,
          )
          pollJob(jobId)
        }
      } catch {
        setState({ phase: 'manual' })
      }
    }, POLL_INTERVAL_MS)
  }, [stopPolling])

  const handleFile = useCallback(async (file: File) => {
    setState({ phase: 'uploading' })
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('missionId', missionId)

      const res = await fetch('/api/ai/ocr', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setState({ phase: 'error', message: (err as Record<string, string>).error ?? `Erreur ${res.status}` })
        return
      }
      const { jobId } = await res.json()
      startTimeRef.current = Date.now()
      setState({ phase: 'polling', jobId, attempt: 0 })
      pollJob(jobId)
    } catch {
      setState({ phase: 'error', message: 'Erreur réseau' })
    }
  }, [missionId, pollJob])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }, [handleFile])

  const handleSaveManual = useCallback(() => {
    if (!manualWeight.trim()) return
    fetch('/api/driver-status/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, missionId, manualWeight: manualWeight.trim() }),
    }).catch(() => {})
    setState({ phase: 'done', weight: manualWeight.trim() })
  }, [driverId, missionId, manualWeight])

  if (state.phase === 'done') {
    return (
      <div className="bg-green-900/40 border border-green-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
        <span className="text-2xl">✅</span>
        <div>
          <div className="text-green-300 text-sm font-semibold">Poids enregistré</div>
          <div className="text-green-400 text-lg font-bold">{state.weight}</div>
        </div>
      </div>
    )
  }

  if (state.phase === 'manual') {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 space-y-2">
        <div className="text-zinc-300 text-sm">Saisie manuelle du poids</div>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={manualWeight}
            onChange={e => setManualWeight(e.target.value)}
            placeholder="ex: 1.42t"
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={handleSaveManual}
            disabled={!manualWeight.trim()}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            OK
          </button>
        </div>
        <button
          type="button"
          onClick={() => setState({ phase: 'idle' })}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Annuler
        </button>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="bg-red-900/30 border border-red-700/30 rounded-xl px-4 py-3 space-y-2">
        <div className="text-red-400 text-sm">{state.message}</div>
        <button
          type="button"
          onClick={() => setState({ phase: 'idle' })}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          Réessayer
        </button>
      </div>
    )
  }

  if (state.phase === 'uploading' || state.phase === 'polling') {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-4 flex items-center gap-3">
        <span className="inline-block w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span className="text-zinc-400 text-sm">
          {state.phase === 'uploading' ? 'Envoi du ticket...' : 'Lecture en cours...'}
        </span>
        <button
          type="button"
          onClick={() => { stopPolling(); setState({ phase: 'manual' }) }}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
        >
          Saisie manuelle
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        title="Scanner le ticket"
        aria-label="Scanner le ticket de pesée"
        onChange={handleInputChange}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-300 text-sm font-semibold active:bg-zinc-700 transition flex items-center justify-center gap-2"
      >
        <span className="text-lg">📷</span>
        Scanner le ticket de pesée
      </button>
    </div>
  )
}
