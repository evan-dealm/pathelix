'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiRequest } from '@/lib/apiClient'

function InviteForm() {
  const token = useSearchParams()?.get('token') ?? ''
  const [info, setInfo] = useState<{ email: string; client: string; company: string } | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  useEffect(() => {
    void apiRequest<{ email: string; client: string; company: string }>(`/api/portal/invite?token=${encodeURIComponent(token)}`).then(r => {
      if (r.ok) setInfo(r.data); else setError(r.error)
    })
  }, [token])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Les deux mots de passe ne correspondent pas'); return }
    const r = await apiRequest('/api/portal/invite', { method: 'POST', json: { token, password, name: name || undefined } })
    if (!r.ok) { setError(r.error); return }
    window.location.href = '/portal'
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-surface-50 px-4">
      <form onSubmit={e => void submit(e)} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-surface-200">
        <h1 className="font-display text-xl font-semibold">Créer votre accès</h1>
        {info ? <p className="text-sm text-surface-600">{info.company} vous ouvre un espace client pour <strong>{info.client}</strong> ({info.email}).</p> : !error && <p className="text-sm text-surface-500">Vérification du lien…</p>}
        {info && <>
          <label className="block text-sm">Votre nom<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2" /></label>
          <label className="block text-sm">Mot de passe (10 caractères minimum)<input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2" /></label>
          <label className="block text-sm">Confirmation<input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2" /></label>
          <button type="submit" className="w-full rounded-lg bg-brand-500 py-2 font-medium text-white hover:bg-brand-600">Créer mon accès</button>
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>
    </main>
  )
}

export default function PortalInvitePage() {
  return <Suspense><InviteForm /></Suspense>
}
