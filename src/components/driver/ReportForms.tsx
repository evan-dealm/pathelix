'use client'

import { useState } from 'react'
import { INCIDENT_TYPES, type IncidentType } from './driverUi'
import type { TicketReading } from '@/lib/ocr/ticket'

export function IncidentForm({ onSubmit }: { onSubmit: (_type: IncidentType, _notes: string) => void }) {
  const [type, setType] = useState<IncidentType | null>(null)
  const [notes, setNotes] = useState('')

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (type) onSubmit(type, notes.trim()) }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="mb-2 text-sm text-white/60">Que se passe-t-il ?</legend>
        <div className="grid grid-cols-2 gap-2">
          {INCIDENT_TYPES.map(t => (
            <label
              key={t.value}
              className={`flex min-h-12 cursor-pointer items-center rounded-xl border px-3 text-sm font-medium ${
                type === t.value ? 'border-[#F0483E] bg-[#F0483E]/15 text-white' : 'border-white/10 bg-black/20 text-white/80'
              }`}
            >
              <input type="radio" name="incident-type" value={t.value} className="sr-only" onChange={() => setType(t.value)} />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-2 block text-sm text-white/60">Précisions pour le dispatch (facultatif)</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-base focus:border-[#FFC21A] focus:outline-none"
        />
      </label>
      <button type="submit" disabled={!type} className="min-h-12 w-full rounded-xl bg-[#F0483E] font-semibold text-white disabled:opacity-40">
        Signaler l’incident
      </button>
    </form>
  )
}

export function NoteForm({ onSubmit }: { onSubmit: (_content: string) => void }) {
  const [content, setContent] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); if (content.trim()) onSubmit(content.trim()) }} className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-sm text-white/60">Visible par le dispatch sur la fiche de la mission.</span>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          maxLength={2000}
          rows={4}
          autoFocus
          className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-base focus:border-[#FFC21A] focus:outline-none"
        />
      </label>
      <button type="submit" disabled={!content.trim()} className="min-h-12 w-full rounded-xl bg-[#FFC21A] font-semibold text-black disabled:opacity-40">
        Envoyer la note
      </button>
    </form>
  )
}

/** Weighing ticket of a dump (VIDER) step, in tonnes as printed on the ticket. */
/**
 * Net weight of the ticket. A reading of the ticket photo only prefills the field: the driver
 * checks it against the paper and confirms (or corrects) it.
 */
export function WeightForm({ initialKg, suggestion, onSubmit }: { initialKg?: number; suggestion?: TicketReading | null; onSubmit: (_kg: number) => void }) {
  const start = suggestion?.netKg ?? initialKg
  const [value, setValue] = useState(start ? String(start / 1000).replace('.', ',') : '')
  const tonnes = Number(value.replace(',', '.').replace(/[^\d.]/g, ''))
  const valid = Number.isFinite(tonnes) && tonnes > 0 && tonnes <= 100
  return (
    <form onSubmit={e => { e.preventDefault(); if (valid) onSubmit(Math.round(tonnes * 1000)) }} className="space-y-4">
      {suggestion?.netKg && (
        <div role="status" className={`rounded-xl px-3 py-2 text-sm ${suggestion.needsReview ? 'bg-[#FFC21A]/15 text-[#FFE08A]' : 'bg-white/10 text-white/80'}`}>
          <p>Lu sur la photo : <strong>{(suggestion.netKg / 1000).toLocaleString('fr-FR')} t</strong>{suggestion.ticketNumber ? ` (ticket ${suggestion.ticketNumber})` : ''}. Vérifiez avec le ticket avant d&apos;enregistrer.</p>
          {suggestion.issues.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{suggestion.issues.map(i => <li key={i}>{i}</li>)}</ul>}
        </div>
      )}
      <div>
        <label htmlFor="ticket-weight" className="mb-2 block text-sm text-white/60">Poids net du ticket de pesée</label>
        <div className="flex items-center gap-2">
          <input
            id="ticket-weight"
            inputMode="decimal"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="1,42"
            className="min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-2xl font-semibold tabular-nums focus:border-[#FFC21A] focus:outline-none"
          />
          <span className="text-lg text-white/60" aria-hidden>t</span>
        </div>
      </div>
      <button type="submit" disabled={!valid} className="min-h-12 w-full rounded-xl bg-[#FFC21A] font-semibold text-black disabled:opacity-40">
        {suggestion?.netKg ? 'Confirmer le poids' : 'Enregistrer le poids'}
      </button>
    </form>
  )
}
