'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readingFromJob, type TicketReading } from '@/lib/ocr/ticket'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS  = 60_000

type Phase = 'idle' | 'uploading' | 'reading' | 'error'

/**
 * Reads the weighing ticket from a photo when an OCR engine is running (asked to the server, so
 * the button disappears as soon as the engine is down) and hands back a *suggestion*: the weight
 * form shows it prefilled and the driver confirms or corrects it — nothing is recorded from here.
 * Needs the network: offline, the driver types the weight.
 */
export function ScanTicketButton({ missionId, onReading }: { missionId: string; onReading: (_r: TicketReading, _jobId: string) => void }) {
  const [available, setAvailable] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/ai/ocr')
      .then(r => (r.ok ? r.json() as Promise<{ available?: boolean }> : { available: false }))
      .then(d => { if (live) setAvailable(d.available === true) })
      .catch(() => undefined)
    return () => { live = false; if (timer.current) clearTimeout(timer.current) }
  }, [])

  const fail = useCallback((msg: string) => { setPhase('error'); setMessage(msg) }, [])

  const poll = useCallback((jobId: string, startedAt: number) => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) { fail('Lecture trop longue — saisissez le poids.'); return }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`)
        if (!res.ok) { fail('Lecture impossible — saisissez le poids.'); return }
        const job = await res.json() as { status: string; outputData?: unknown }
        if (job.status === 'done') {
          const reading = readingFromJob(job.outputData)
          if (reading?.netKg) { setPhase('idle'); onReading(reading, jobId) } else fail('Poids illisible sur la photo — saisissez-le.')
        } else if (job.status === 'failed' || job.status === 'expired') {
          fail('Lecture impossible — saisissez le poids.')
        } else {
          poll(jobId, startedAt)
        }
      } catch {
        fail('Réseau indisponible — saisissez le poids.')
      }
    }, POLL_INTERVAL_MS)
  }, [fail, onReading])

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

  if (!available) return null

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
