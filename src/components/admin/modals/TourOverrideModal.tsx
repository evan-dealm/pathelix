'use client'

import { TourOverrideState } from '../types'
import { Modal, Btn } from '../ui'

export function TourOverrideModal({ state, onConfirm, onCancel }: {
  state:     TourOverrideState
  onConfirm: () => void
  onCancel:  () => void
}) {
  if (!state) return null
  return (
    <Modal title="Modification de la tournée optimisée" onClose={onCancel} size="sm">
      <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2.5">
        <span className="text-orange-400 text-lg flex-shrink-0 mt-0.5">⚠</span>
        <p className="text-orange-200 text-sm leading-relaxed">
          Vous êtes sur le point de modifier la proposition de l&apos;algorithme. Cela pourrait impacter les temps de trajet,
          faire rater des fenêtres horaires, ou annuler des pauses légales.
        </p>
      </div>
      <p className="text-surface-500 text-xs">Êtes-vous sûr de vouloir forcer cette modification ?</p>
      <div className="flex gap-3 pt-1">
        <Btn onClick={onConfirm} variant="warning">Forcer le déplacement</Btn>
        <Btn onClick={onCancel} variant="ghost">Annuler</Btn>
      </div>
    </Modal>
  )
}
