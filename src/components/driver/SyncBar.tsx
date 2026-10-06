'use client'

import { useState } from 'react'
import Image from 'next/image'
import { BRAND_LOGO_SRC } from '@/lib/branding'
import type { QueuedAction } from '@/lib/syncQueue'
import { Sheet } from './Sheet'

interface SyncBarProps {
  online: boolean
  pending: number
  failed: QueuedAction[]
  authRequired: boolean
  lastSynced: string | null
  driverName: string
  loginHref: string
  onSyncNow: () => void
  onRetry: (_id: string) => void
  onDiscard: (_id: string) => void
  onLogout: () => void
}

export function SyncBar({
  online, pending, failed, authRequired, lastSynced, driverName, loginHref,
  onSyncNow, onRetry, onDiscard, onLogout,
}: SyncBarProps) {
  const [showFailed, setShowFailed] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const tone = authRequired || failed.length > 0 || !online
    ? 'bg-[#3A1D1C] text-[#FFB4AE]'
    : pending > 0 ? 'bg-[#3A3018] text-[#FFD970]' : 'bg-[#1A1D21] text-white/60'

  const state = !online
    ? `Hors ligne${pending > 0 ? ` · ${pending} à envoyer` : ''}`
    : authRequired ? 'Session expirée'
    : pending > 0 ? `${pending} envoi${pending > 1 ? 's' : ''} en attente`
    : lastSynced ? `À jour (${lastSynced})` : 'Connecté'

  return (
    <>
      <header className={`sticky top-0 z-40 flex min-h-12 items-center gap-3 border-b border-white/5 px-4 pt-[env(safe-area-inset-top)] ${tone}`}>
        <Image src={BRAND_LOGO_SRC} alt="PATHÉLIX" width={28} height={28} className="shrink-0 rounded-md" />
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? (pending > 0 ? 'bg-[#FFC21A]' : 'bg-[#2FBF71]') : 'bg-[#F0483E]'}`}
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium" role="status" aria-live="polite">{state}</p>
        {failed.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFailed(true)}
            className="min-h-9 rounded-full bg-[#F0483E] px-3 text-sm font-semibold text-white"
          >
            {failed.length} refusé{failed.length > 1 ? 's' : ''}
          </button>
        )}
        {online && pending > 0 && !authRequired && (
          <button type="button" onClick={onSyncNow} className="min-h-9 rounded-full bg-[#FFC21A] px-3 text-sm font-semibold text-black">
            Envoyer
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowMenu(true)}
          className="flex min-h-9 items-center gap-1 rounded-full px-2 text-sm text-white/70 hover:bg-white/5"
          aria-label="Menu du compte"
        >
          {driverName}
          <span aria-hidden>▾</span>
        </button>
      </header>

      {authRequired && (
        <div className="border-b border-[#F0483E]/30 bg-[#3A1D1C] px-4 py-3 text-sm text-[#FFD6D2]">
          <p>Votre session a expiré. {pending > 0 ? `Vos ${pending} action${pending > 1 ? 's' : ''} sont gardées sur le téléphone et partiront après reconnexion.` : 'Reconnectez-vous pour continuer.'}</p>
          <a href={loginHref} className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-[#FFC21A] px-4 font-semibold text-black">
            Se reconnecter
          </a>
        </div>
      )}

      <Sheet open={showFailed} title="Actions refusées par le serveur" onClose={() => setShowFailed(false)}>
        <p className="mb-4 text-sm text-white/60">
          Ces actions n&apos;ont pas pu être enregistrées. Réessayez-les, ou abandonnez-les si elles ne sont plus utiles.
        </p>
        <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
          {failed.map(a => (
            <li key={a.id} className="rounded-2xl bg-black/20 p-4">
              <p className="font-semibold">{a.label ?? 'Action'}</p>
              <p className="mt-1 text-sm text-[#FFB4AE]">{a.lastError ?? 'Refusée'}</p>
              <p className="mt-1 text-xs text-white/40">{new Date(a.timestamp).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => onRetry(a.id)} className="min-h-11 flex-1 rounded-xl bg-[#FFC21A] font-semibold text-black">Réessayer</button>
                <button type="button" onClick={() => onDiscard(a.id)} className="min-h-11 flex-1 rounded-xl bg-white/10 font-semibold">Abandonner</button>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet open={showMenu} title={driverName} onClose={() => setShowMenu(false)}>
        <button
          type="button"
          onClick={() => { setShowMenu(false); onLogout() }}
          className="min-h-12 w-full rounded-xl bg-white/10 text-left px-4 font-semibold"
        >
          Se déconnecter
        </button>
      </Sheet>
    </>
  )
}
