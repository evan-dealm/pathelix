'use client'

import { useState, useRef, useEffect } from 'react'
import { Modal, Btn } from './ui'
import type { MissionType } from '@/lib/types'

export interface ParsedMissionFields {
  type?:                 MissionType
  address?:              string
  clientName?:           string
  estimatedDurationMin?: number
  priority?:             1 | 2 | 3
  timeWindow?:           { openMin: number; closeMin: number }
  notes?:                string
  binSize?:              string
  /** YYYY-MM-DD when the text names a day. */
  date?:                 string
}

interface ParseInfo { source: 'llm' | 'rules'; warnings: string[]; missing: string[] }

interface Props {
  date:      string
  onParsed:  (_fields: ParsedMissionFields) => void
  onClose:   () => void
}

const EXAMPLES = [
  'Poser une benne 8m3 chez Dupont BTP, 14 rue des Artisans Lyon, demain avant 10h, urgent',
  'Retirer la benne chez Martin Construction avenue de la Paix Grenoble',
  'Echanger benne ampliroll chez Garage Renard, priorité normale, créneau 13h-16h',
]

export function NaturalMissionInput({ date, onParsed, onClose }: Props) {
  const [text, setText]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<ParsedMissionFields | null>(null)
  const [info, setInfo]       = useState<ParseInfo | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  async function handleParse() {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/missions/parse-natural', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: text.trim(), date }),
      })

      const data = await res.json() as { mission?: ParsedMissionFields; error?: unknown } & Partial<ParseInfo>

      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Texte non analysable : saisissez la mission dans le formulaire.')
        return
      }

      setResult(data.mission ?? null)
      setInfo({ source: data.source ?? 'rules', warnings: data.warnings ?? [], missing: data.missing ?? [] })
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion.')
    } finally {
      setLoading(false)
    }
  }

  function handleConfirm() {
    if (result) onParsed(result)
  }

  function minToHhmm(min: number): string {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  }

  return (
    <Modal title="Saisie rapide" onClose={onClose} size="md">
      <div className="space-y-4">

        {}
        <p className="text-surface-500 text-xs leading-relaxed">
          Décrivez la mission comme vous la diriez au téléphone. Les champs reconnus pré-remplissent
          le formulaire : rien n&apos;est créé avant que vous l&apos;ayez vérifié et enregistré.
        </p>

        {}
        <div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleParse()
            }}
            placeholder="Ex: Poser une benne 8m3 chez Dupont BTP, 14 rue des Artisans Lyon, demain avant 10h, urgent"
            rows={3}
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-[#0055A4] resize-none transition-colors"
            disabled={loading}
          />
          <p className="text-[10px] text-surface-400 mt-1">Ctrl+Entrée pour analyser</p>
        </div>

        {}
        <div className="space-y-1">
          <p className="text-[10px] text-surface-400 font-medium uppercase tracking-wide">Exemples</p>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setText(ex)}
              className="w-full text-left text-xs text-surface-500 hover:text-[#0055A4] hover:bg-brand-50 px-2 py-1 rounded-lg transition-colors truncate"
            >
              {ex}
            </button>
          ))}
        </div>

        {}
        <Btn
          onClick={() => void handleParse()}
          variant="primary"
          disabled={loading || !text.trim()}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Analyse en cours…
            </span>
          ) : 'Analyser le texte'}
        </Btn>

        {}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 space-y-3">
            <p className="text-green-700 font-semibold text-sm">Champs reconnus{info?.source === 'llm' ? ' par l\'assistant IA' : ''} — vérifiez avant de valider</p>
            {info && (info.warnings.length > 0 || info.missing.length > 0) && (
              <ul className="space-y-0.5 text-xs text-amber-800">
                {info.warnings.map(w => <li key={w}>{w}</li>)}
                {info.missing.length > 0 && <li>À compléter : {info.missing.join(', ')}</li>}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {result.type && (
                <div>
                  <span className="text-surface-400">Type</span>
                  <p className="font-medium text-surface-900">{result.type}</p>
                </div>
              )}
              {result.clientName && (
                <div>
                  <span className="text-surface-400">Client</span>
                  <p className="font-medium text-surface-900">{result.clientName}</p>
                </div>
              )}
              {result.address && (
                <div className="col-span-2">
                  <span className="text-surface-400">Adresse</span>
                  <p className="font-medium text-surface-900">{result.address}</p>
                </div>
              )}
              {result.date && (
                <div>
                  <span className="text-surface-400">Date</span>
                  <p className="font-medium text-surface-900">{result.date.split('-').reverse().join('/')}</p>
                </div>
              )}
              {result.estimatedDurationMin && (
                <div>
                  <span className="text-surface-400">Durée estimée</span>
                  <p className="font-medium text-surface-900">{result.estimatedDurationMin} min</p>
                </div>
              )}
              {result.priority && (
                <div>
                  <span className="text-surface-400">Priorité</span>
                  <p className={`font-bold ${result.priority === 1 ? 'text-red-600' : result.priority === 2 ? 'text-amber-600' : 'text-surface-600'}`}>
                    {result.priority === 1 ? 'P1 — Urgent' : result.priority === 2 ? 'P2 — Normal' : 'P3 — Basse'}
                  </p>
                </div>
              )}
              {result.timeWindow && (
                <div>
                  <span className="text-surface-400">Créneau</span>
                  <p className="font-medium text-surface-900">
                    {minToHhmm(result.timeWindow.openMin)} – {minToHhmm(result.timeWindow.closeMin)}
                  </p>
                </div>
              )}
              {result.binSize && (
                <div>
                  <span className="text-surface-400">Benne</span>
                  <p className="font-medium text-surface-900">{result.binSize}</p>
                </div>
              )}
              {result.notes && (
                <div className="col-span-2">
                  <span className="text-surface-400">Notes</span>
                  <p className="font-medium text-surface-900">{result.notes}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Btn onClick={handleConfirm} variant="primary">
                Ouvrir le formulaire pré-rempli
              </Btn>
              <Btn onClick={() => { setResult(null); setInfo(null) }} variant="ghost">
                Recommencer
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
