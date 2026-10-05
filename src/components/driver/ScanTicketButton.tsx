'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS  = 60_000

/** Parses an OCR weight ("1.42 t", "1 420 kg", "1420") into kg. */
export function parseTicketWeightKg(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) return null
  if (s.includes('kg')) return Math.round(n)
  if (s.includes('t')) return Math.round(n * 1000)
  return n < 100 ? Math.round(n * 1000) : Math.round(n) // bare number: tonnes if small
}

type Phase = 'idle' | 'uploading' | 'reading' | 'error'

/**
 * Reads the weighing ticket with the OCR engine (only when it is deployed —
 * NEXT_PUBLIC_AI_ENGINE_URL) and hands the weight back to the form, which the driver confirms.
 * Needs the network: offline, the driver types the weight instead.
 */
export function ScanTicketButton({ missionId, onWeight }: { missionId: string; onWeight: (_kg: number) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const fail = useCallback((msg: string) => { setPhase('error'); setMessage(msg) }, [])

  const poll = useCallback((jobId: string, startedAt: number) => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) { fail('Lecture trop longue — saisissez le poids.'); return }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`)
        if (!res.ok) { fail('Lecture impossible — saisissez le poids.'); return }
        const job = await res.json() as { status: string; outputData?: { weight?: unknown } }
        if (job.status === 'done') {
          const w = job.outputData?.weight
          const kg = w !== null && w !== undefined ? parseTicketWeightKg(String(w)) : null
          if (kg) { setPhase('idle'); onWeight(kg) } else fail('Poids illisible — saisissez-le.')
        } else if (job.status === 'failed' || job.status === 'expired') {
          fail('Lecture impossible — saisissez le poids.')
        } else {
          poll(jobId, startedAt)
        }
      } catch {
        fail('Réseau indisponible — saisissez le poids.')
      }
    }, POLL_INTERVAL_MS)
  }, [fail, onWeight])

  const upload = useCallback(async (file: File) => {
    setPhase('uploading')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('missionId', missionId)
      const res = await fetch('/api/ai/ocr', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: unknown }
        fail(typeof err.error === 'string' ? err.error : `Envoi refusé (${res.status})`)
        return
      }
      const { jobId } = await res.json() as { jobId: string }
      setPhase('reading')
      poll(jobId, Date.now())
    } catch {
      fail('Réseau indisponible — saisissez le poids.')
    }
  }, [missionId, poll, fail])

  if (!process.env.NEXT_PUBLIC_AI_ENGINE_URL) return null

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Photographier le ticket de pesée"
        onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }}
      />
      <button
        type="button"
        disabled={phase === 'uploading' || phase === 'reading'}
        onClick={() => inputRef.current?.click()}
        className="min-h-12 w-full rounded-xl border border-white/15 bg-black/20 font-semibold disabled:opacity-60"
      >
        {phase === 'uploading' ? 'Envoi du ticket…' : phase === 'reading' ? 'Lecture du ticket…' : 'Lire le ticket avec l’appareil photo'}
      </button>
      {phase === 'error' && <p className="mt-2 text-sm text-[#FFB4AE]" role="alert">{message}</p>}
    </div>
  )
}
