'use client'

import { ConfirmOverrideState } from '../types'
import { Modal, Btn } from '../ui'

export function ConfirmOverrideModal({ state, onConfirm, onCancel }: {
  state: ConfirmOverrideState
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!state) return null
  return (
    <Modal title="Modifier l'heure de l'algorithme ?" onClose={onCancel} size="sm">
      <p className="text-surface-600 text-sm">
        L'algorithme a placé cette mission à <span className="text-surface-900 font-bold">{state.algoTimeStr}</span>.
        Êtes-vous sûr de vouloir forcer une heure manuellement ?
      </p>
      <p className="text-surface-400 text-xs">L'optimisation automatique ne s'appliquera plus à cette mission.</p>
      <div className="flex gap-3 pt-1">
        <Btn onClick={onConfirm} variant="warning">Oui, modifier</Btn>
        <Btn onClick={onCancel} variant="ghost">Annuler</Btn>
      </div>
    </Modal>
  )
}
