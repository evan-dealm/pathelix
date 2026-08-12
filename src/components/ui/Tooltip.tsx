'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface TooltipProps {
  content: string
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'right'
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 200)
  }, [])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const posClass = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    right:  'left-full top-1/2 -translate-y-1/2 ml-2',
  }[position]

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`absolute z-50 ${posClass} w-56 rounded-lg bg-zinc-900 text-white text-xs leading-relaxed px-3 py-2 shadow-xl pointer-events-none`}
        >
          {content}
        </span>
      )}
    </span>
  )
}

/**
 * Inline help icon with tooltip for jargon terms.
 * Usage: <JargonTip term="exutoire" />
 */

const JARGON: Record<string, string> = {
  exutoire:        'Point de dépôt ou de vidage où la benne est déchargée (centre de tri, déchetterie, etc.).',
  vider:           'Mission synthétique insérée automatiquement par l\'optimiseur quand une benne doit être vidée avant la prochaine collecte.',
  pause:           'Pause légale obligatoire CE 561/2006 insérée automatiquement (45 min après 4h30 de conduite).',
  p1:              'Mission urgente : doit être servie avant 10h. Priorité maximale dans l\'optimiseur.',
  p2:              'Mission importante : priorité standard. Servie dans la fenêtre horaire si possible.',
  p3:              'Mission normale : priorité basse. Peut être reportée si la capacité est dépassée.',
  valhallaFactor:  'Facteur de correction du temps de trajet calculé par le moteur ML. Défaut 1.60 = +60 % par rapport au temps brut Valhalla (trafic, manœuvres, etc.).',
  mvalns:          'MV-ALNS : algorithme d\'optimisation de tournées interne (Adaptive Large Neighborhood Search multi-véhicules). Vous n\'avez pas à le configurer.',
}

export function JargonTip({ term, position = 'top' }: { term: keyof typeof JARGON; position?: 'top' | 'bottom' | 'right' }) {
  const text = JARGON[term]
  if (!text) return null
  return (
    <Tooltip content={text} position={position}>
      <span
        tabIndex={0}
        aria-label={`Aide : ${term}`}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold cursor-help focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        ?
      </span>
    </Tooltip>
  )
}
