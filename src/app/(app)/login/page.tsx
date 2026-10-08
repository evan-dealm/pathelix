'use client'

import { useState, FormEvent } from 'react'
import Image from 'next/image'
import { BRAND_LOGO_SRC } from '@/lib/branding'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [pwd, setPwd]           = useState('')
  // Second factor: only asked when the server says the account has one (superadmin).
  const [totp, setTotp]         = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [navigating, setNavigating] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, password: pwd, totp: totp.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 429) setError('Trop de tentatives. Réessayez dans une minute.')
        else if (res.status === 401 && data.totpRequired) {
          // First pass: show the code field without an error. Second pass: the code was wrong.
          if (needsTotp) setError('Code de vérification incorrect')
          setNeedsTotp(true)
          setTotp('')
        }
        else if (res.status === 401) setError('Email ou mot de passe incorrect')
        else setError(data.error || 'Erreur serveur')
        return
      }
      const data = await res.json()
      setNavigating(true)
      // Full navigation, not router.push: the router may hold a prefetch of /admin made before
      // the session existed (a redirect back to /login), which left this screen loading forever.
      window.location.assign(data.redirectTo || '/admin')
    } catch {
      setError('Erreur réseau — réessayez')
    } finally {
      setLoading(false)
    }
  }

  if (navigating) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-surface-50">
        <div className="flex flex-col items-center gap-5">
          <div className="w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-black/10">
            <Image src={BRAND_LOGO_SRC} alt="PATHÉLIX" width={56} height={56} className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-surface-900 text-base font-semibold tracking-tight font-display">PATHÉLIX</span>
            <span className="text-surface-400 text-sm">Chargement de l&apos;espace de travail…</span>
          </div>
          <div className="w-40 h-[2px] bg-surface-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full animate-loading-bar" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <main
      id="main-content"
      className="min-h-screen bg-surface-50 flex items-center justify-center p-6 overflow-hidden"
    >

      {}
      <div className="w-full max-w-[380px] flex flex-col items-center gap-8 relative z-10">

        {}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-[80px] h-[80px] rounded-[20px] overflow-hidden ring-1 ring-black/10 shadow-elevated">
            <Image
              src={BRAND_LOGO_SRC}
              alt="PATHÉLIX"
              width={80}
              height={80}
              className="w-full h-full object-cover"
              priority
            />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-[30px] font-bold tracking-[-0.025em] leading-none text-surface-900 font-display">
              PATHÉLIX
            </h1>
            <p className="text-[13px] text-surface-400">
              Plateforme d&apos;orchestration logistique
            </p>
          </div>
        </div>

        {}
        <div className="w-full bg-white rounded-3xl border border-surface-200 overflow-hidden shadow-card">

          {}
          <div className="h-[2px] bg-gradient-to-r from-brand-400 via-brand-500 to-brand-400" />

          <form
            onSubmit={handleSubmit}
            aria-label="Formulaire de connexion"
            className="p-8 space-y-5"
          >
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-[11px] font-semibold text-surface-500 uppercase tracking-[0.08em]"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@pathelix.io"
                autoComplete="email"
                required
                aria-describedby={error ? 'login-error' : undefined}
                className="w-full h-11 bg-surface-50 border border-surface-200 rounded-xl px-4
                           text-surface-900 placeholder-surface-300 text-[14px]
                           focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10
                           transition-all duration-120"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-[11px] font-semibold text-surface-500 uppercase tracking-[0.08em]"
              >
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                aria-describedby={error ? 'login-error' : undefined}
                className="w-full h-11 bg-surface-50 border border-surface-200 rounded-xl px-4
                           text-surface-900 placeholder-surface-300 text-[14px]
                           focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10
                           transition-all duration-120"
              />
            </div>

            {needsTotp && (
              <div className="space-y-2">
                <label
                  htmlFor="totp"
                  className="block text-[11px] font-semibold text-surface-500 uppercase tracking-[0.08em]"
                >
                  Code de vérification
                </label>
                <input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  value={totp}
                  onChange={e => setTotp(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
                  placeholder="123 456"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  aria-describedby="totp-help"
                  className="w-full h-11 bg-surface-50 border border-surface-200 rounded-xl px-4
                             text-surface-900 placeholder-surface-300 text-[14px] tracking-[0.2em]
                             focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10
                             transition-all duration-120"
                />
                <p id="totp-help" className="text-[12px] text-surface-400">
                  Saisissez le code à 6 chiffres affiché par votre application d&apos;authentification.
                </p>
              </div>
            )}

            {error && (
              <p
                id="login-error"
                role="alert"
                className="text-danger-500 text-[13px] bg-danger-50 border border-danger-500/20 rounded-xl px-4 py-3"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed
                         text-white font-semibold rounded-xl text-[14px]
                         transition-all duration-120 shadow-soft hover:shadow-elevated
                         active:scale-[0.985] mt-1"
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connexion…
                </span>
              ) : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="text-[11px] text-surface-400 tracking-wide">
          PATHÉLIX · Interface de dispatch
        </p>

      </div>
    </main>
  )
}
