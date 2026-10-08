'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'

interface TotpStatus { enabled: boolean; enabledAt: string | null; pending: boolean }
interface Enrolment { secret: string; qr: string }

const inputClass =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none'
const buttonClass =
  'px-4 py-2 rounded-lg text-sm font-bold text-white transition disabled:opacity-50 disabled:cursor-not-allowed'

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : fallback
}

/** Superadmin console → Sécurité: second factor (TOTP) of the signed-in superadmin account. */
export function SuperadminSecurityPanel() {
  const [status, setStatus] = useState<TotpStatus | null>(null)
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/superadmin/security/totp')
      if (!res.ok) throw new Error(await errorOf(res, `Chargement impossible (${res.status})`))
      setStatus((await res.json()) as TotpStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function call(method: 'POST' | 'PUT' | 'DELETE', body: Record<string, string>): Promise<Response | null> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/superadmin/security/totp', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setError(await errorOf(res, `Action refusée (${res.status})`))
        return null
      }
      return res
    } catch {
      setError('Erreur réseau — réessayez')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    const res = await call('POST', { password })
    if (!res) return
    setEnrolment((await res.json()) as Enrolment)
    setPassword('')
    setCode('')
  }

  async function confirm() {
    const res = await call('PUT', { code })
    if (!res) return
    setEnrolment(null)
    setCode('')
    setNotice('Double authentification activée : un code sera demandé à chaque connexion.')
    await load()
  }

  async function disable() {
    const res = await call('DELETE', { code })
    if (!res) return
    setCode('')
    setNotice('Double authentification désactivée.')
    await load()
  }

  const digits = (v: string) => v.replace(/[^\d\s]/g, '').slice(0, 7)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Sécurité du compte superadmin</h2>
        <p className="mt-1 text-xs text-zinc-600">
          Ce compte ouvre les données de toutes les organisations : protégez-le par un second facteur.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-400 bg-red-900/30 px-3 py-2 rounded-lg">{error}</p>}
      {notice && <p className="text-sm text-green-400 bg-green-900/30 px-3 py-2 rounded-lg">{notice}</p>}
      {status === null && !error && <p className="text-sm text-zinc-500">Chargement…</p>}

      {status && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-bold">Double authentification (code à 6 chiffres)</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${status.enabled ? 'bg-green-900/50 text-green-300' : 'bg-amber-900/50 text-amber-300'}`}>
              {status.enabled ? 'Active' : 'Inactive'}
            </span>
          </div>

          {status.enabled && (
            <>
              <p className="text-sm text-zinc-400">
                Active depuis le{' '}
                {status.enabledAt ? new Date(status.enabledAt).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : '—'}.
                Un code de votre application d&apos;authentification est demandé à chaque connexion.
              </p>
              <label className="block text-xs text-zinc-400">
                Pour la désactiver, saisissez un code en cours de validité
                <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
                  onChange={e => setCode(digits(e.target.value))} placeholder="123 456"
                  className={`${inputClass} mt-2 font-mono tracking-[0.2em]`} />
              </label>
              <button type="button" onClick={() => void disable()} disabled={busy || code.replace(/\s/g, '').length !== 6}
                className={`${buttonClass} bg-red-600 hover:bg-red-700`}>
                {busy ? 'Vérification…' : 'Désactiver'}
              </button>
            </>
          )}

          {!status.enabled && !enrolment && (
            <>
              <p className="text-sm text-zinc-400">
                Installez une application d&apos;authentification sur votre téléphone (Google Authenticator,
                Microsoft Authenticator, Aegis, 1Password…), puis confirmez votre mot de passe pour commencer.
              </p>
              <label className="block text-xs text-zinc-400">
                Mot de passe actuel
                <input type="password" autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} className={`${inputClass} mt-2`} />
              </label>
              <button type="button" onClick={() => void start()} disabled={busy || !password}
                className={`${buttonClass} bg-blue-600 hover:bg-blue-700`}>
                {busy ? 'Vérification…' : 'Configurer'}
              </button>
            </>
          )}

          {!status.enabled && enrolment && (
            <>
              <p className="text-sm text-zinc-400">
                1. Scannez ce QR code avec l&apos;application, ou saisissez la clé à la main.
              </p>
              <div className="flex flex-wrap items-center gap-5">
                <Image src={enrolment.qr} alt="QR code de configuration" width={176} height={176} unoptimized
                  className="rounded-lg bg-white p-1" />
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Clé de configuration</div>
                  <code className="block break-all font-mono text-sm text-zinc-200">
                    {enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}
                  </code>
                  <p className="text-xs text-zinc-500">Elle n&apos;est affichée qu&apos;une fois.</p>
                </div>
              </div>
              <label className="block text-xs text-zinc-400">
                2. Saisissez le code à 6 chiffres affiché par l&apos;application
                <input type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code}
                  onChange={e => setCode(digits(e.target.value))} placeholder="123 456"
                  className={`${inputClass} mt-2 font-mono tracking-[0.2em]`} />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void confirm()} disabled={busy || code.replace(/\s/g, '').length !== 6}
                  className={`${buttonClass} bg-green-600 hover:bg-green-700`}>
                  {busy ? 'Vérification…' : 'Activer'}
                </button>
                <button type="button" onClick={() => { setEnrolment(null); setCode(''); setError(null) }}
                  className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition">
                  Annuler
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-2 text-sm text-zinc-400">
        <h3 className="text-base font-bold text-zinc-100">Bon à savoir</h3>
        <p>
          <span className="text-zinc-200">Mot de passe :</span> 12 caractères au moins, avec minuscules, majuscules et chiffres.
        </p>
        <p>
          <span className="text-zinc-200">Téléphone perdu :</span> depuis le serveur, relancez{' '}
          <code className="font-mono text-zinc-200">npm run db:seed-superadmin</code> : le mot de passe est
          réinitialisé, les sessions ouvertes sont déconnectées et la double authentification est retirée.
        </p>
        <p>
          <span className="text-zinc-200">Traçabilité :</span> chaque action de cette console, y compris la
          consultation des données d&apos;une organisation, est inscrite dans l&apos;onglet Historique.
        </p>
      </div>
    </div>
  )
}
