'use client'

import { MissionContainerPanel } from '@/components/admin/containers/MissionContainerPanel'
import { useState, useEffect, useCallback } from 'react'
import { Mission } from '@/lib/types'
import { usePlanningStore } from '@/stores/planningStore'
import { formatDuration } from '@/lib/algorithm'
import { Modal, TypeBadge, P1Badge, Btn } from '../ui'
import { mTitle, displayFull } from '../hooks'

interface Comment {
  id: string
  content: string
  role: string
  createdAt: string
}

function MissionCommentPanel({ missionId }: { missionId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/mission-comments?missionId=${missionId}`)
      if (res.ok) setComments(await res.json())
    } finally {
      setLoading(false)
    }
  }, [missionId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function handleSend() {
    const content = text.trim()
    if (!content) return
    setSending(true)
    try {
      const res = await fetch('/api/mission-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, content }),
      })
      if (res.ok) {
        setText('')
        void load()
      }
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await fetch(`/api/mission-comments/${id}`, { method: 'DELETE' })
      void load()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="border-t border-surface-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 text-xs font-medium transition-colors w-full"
      >
        <span>💬 Commentaires</span>
        {!loading && open && <span className="text-surface-400">({comments.length})</span>}
        <span className="ml-auto text-surface-300">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {}
          {loading ? (
            <div className="text-surface-400 text-xs text-center py-2">Chargement…</div>
          ) : comments.length === 0 ? (
            <div className="text-surface-400 text-xs text-center py-2">Aucun commentaire</div>
          ) : (
            <div className="space-y-2">
              {comments.map(c => (
                <div key={c.id} className="bg-surface-50 border border-surface-100 rounded-lg px-3 py-2 flex items-start gap-2 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold text-brand-600 uppercase">{c.role}</span>
                      <span className="text-[10px] text-surface-400">
                        {new Date(c.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-surface-700 whitespace-pre-wrap break-words">{c.content}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    disabled={deleting === c.id}
                    title="Supprimer ce commentaire"
                    className="opacity-0 group-hover:opacity-100 text-surface-300 hover:text-red-400 transition-all text-xs px-1 py-0.5 rounded disabled:opacity-40"
                  >
                    {deleting === c.id ? '…' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {}
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
              }}
              placeholder="Ajouter un commentaire… (Entrée pour envoyer)"
              rows={2}
              className="flex-1 bg-surface-50 border border-surface-200 rounded-lg px-3 py-2 text-surface-900 placeholder-surface-400 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 resize-none"
            />
            <Btn onClick={handleSend} variant="primary" size="sm" disabled={sending || !text.trim()}>
              {sending ? '…' : 'Envoyer'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

export function MissionDetailModal({ mission, onEdit, onDelete, onDuplicate, onClose, onAssign }: {
  mission: Mission
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onClose: () => void
  onAssign?: (_driverId: string, _date: string) => void
}) {
  const drivers = usePlanningStore(s => s.drivers)
  const [assignDriver, setAssignDriver] = useState('')
  const [assignDate, setAssignDate]     = useState(mission.date)
  const [showAssign, setShowAssign]     = useState(false)

  const totalMin = mission.estimatedDurationMin + mission.maneuverTimeMin
  const hasCoords = mission.latitude !== 0 || mission.longitude !== 0
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${mission.latitude},${mission.longitude}`
    : `https://www.google.com/maps/search/${encodeURIComponent(mission.address)}`
  return (
    <Modal title="Détail de la mission" onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap">
        <TypeBadge type={mission.type} />
        {mission.priority === 1 && <P1Badge />}
        {!hasCoords && <span className="text-yellow-500 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-0.5">⚠ GPS manquant</span>}
      </div>
      <div className="space-y-3 pt-1">
        <div>
          <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">{mission.type === 'VIDER' ? 'Exutoire' : 'Client'}</div>
          <div className="text-surface-900 font-semibold text-base">{mTitle(mission)}</div>
        </div>
        <div>
          <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Adresse</div>
          <div className="text-surface-900 text-sm">{mission.address}</div>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[#0055A4] hover:underline text-xs mt-0.5 inline-block">Ouvrir dans Google Maps →</a>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Date prévue</div>
            <div className="text-surface-900 text-sm capitalize">{displayFull(mission.date)}</div>
          </div>
          <div>
            <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Durée totale</div>
            <div className="text-surface-900 text-sm font-bold">{formatDuration(totalMin)}</div>
            <div className="text-surface-400 text-xs">dont {formatDuration(mission.maneuverTimeMin)} manœuvre</div>
          </div>
        </div>
        {(mission.wasteTypeLabel || mission.binSize) && (
          <div className="grid grid-cols-2 gap-3">
            {mission.wasteTypeLabel && <div>
              <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Déchets</div>
              <div className="text-surface-900 text-sm">{mission.wasteTypeLabel}</div>
            </div>}
            {mission.binSize && <div>
              <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Benne</div>
              <div className="text-surface-900 text-sm">{mission.binSize}</div>
            </div>}
          </div>
        )}
        {!mission.archived && <MissionContainerPanel mission={mission} />}
        {hasCoords && (
          <div>
            <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Coordonnées GPS</div>
            <div className="text-surface-500 text-xs font-mono">{mission.latitude}, {mission.longitude}</div>
          </div>
        )}
        {mission.accessNotes && (
          <div>
            <div className="text-surface-400 text-[11px] uppercase tracking-wider mb-1">Notes d'accès</div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-yellow-300 text-sm">{mission.accessNotes}</div>
          </div>
        )}
      </div>
      {showAssign && (
        <div className="bg-surface-100 rounded-xl p-3 space-y-2 border border-surface-200">
          <div className="text-surface-500 text-xs font-medium uppercase tracking-wider">Assigner à un chauffeur</div>
          <select
            value={assignDriver}
            onChange={e => setAssignDriver(e.target.value)}
            aria-label="Chauffeur"
            title="Chauffeur"
            className="w-full bg-surface-200 border border-gray-600 rounded-lg px-3 py-2 text-surface-900 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">— Choisir un chauffeur —</option>
            {drivers.map(d => (
              <option key={d.id} value={d.id}>{d.firstName} {d.lastName} · {d.sector}</option>
            ))}
          </select>
          <input
            type="date"
            value={assignDate}
            onChange={e => setAssignDate(e.target.value)}
            aria-label="Date d'assignation"
            title="Date d'assignation"
            className="w-full bg-surface-200 border border-gray-600 rounded-lg px-3 py-2 text-surface-900 text-sm focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <Btn
              onClick={() => {
                if (assignDriver && assignDate && onAssign) {
                  onAssign(assignDriver, assignDate)
                  setShowAssign(false)
                  onClose()
                }
              }}
              variant="primary"
              size="sm"
              disabled={!assignDriver || !assignDate}
            >
              ✓ Confirmer
            </Btn>
            <Btn onClick={() => setShowAssign(false)} variant="ghost" size="sm">Annuler</Btn>
          </div>
        </div>
      )}
      <MissionCommentPanel missionId={mission.id} />

      <div className="flex gap-2 pt-2 border-t border-surface-200 flex-wrap">
        <Btn onClick={() => { onEdit(); onClose() }} variant="primary" size="sm">✏ Modifier</Btn>
        {onAssign && (
          <Btn onClick={() => setShowAssign(v => !v)} variant="ghost" size="sm">📋 Assigner</Btn>
        )}
        <Btn onClick={onDuplicate} variant="ghost" size="sm">⎘ Dupliquer</Btn>
        <Btn onClick={() => { onDelete(); onClose() }} variant="danger" size="sm">✕ Supprimer</Btn>
      </div>
    </Modal>
  )
}
