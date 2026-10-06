'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { Btn } from '../ui'
import { inputCls } from './shared'

interface PortalUser { id: string; email: string; name: string; disabled: boolean; activated: boolean; lastLoginAt: string | null; inviteExpiresAt: string | null }

/** Customer-portal accesses of one client: invite, resend a link, disable, remove. */
export function PortalAccess({ clientId }: { clientId: string }) {
  const [users, setUsers] = useState<PortalUser[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<{ text: string; link?: string; error?: boolean } | null>(null)

  const load = useCallback(async () => {
    const r = await apiRequest<{ data: PortalUser[] }>(`/api/clients/${clientId}/portal-users`)
    if (r.ok) setUsers(r.data.data)
  }, [clientId])
  useEffect(() => { void load() }, [load])

  function linkMessage(r: { inviteUrl: string; emailed: boolean }) {
    setMsg(r.emailed ? { text: 'Invitation envoyée par e-mail.' } : { text: 'E-mail non configuré : transmettez ce lien (valable 7 jours, usage unique) :', link: r.inviteUrl })
  }
  async function invite() {
    const r = await apiRequest<{ inviteUrl: string; emailed: boolean }>(`/api/clients/${clientId}/portal-users`, { method: 'POST', json: { email } })
    if (!r.ok) { setMsg({ text: r.error, error: true }); return }
    setEmail(''); linkMessage(r.data); void load()
  }
  async function act(id: string, action: 'disable' | 'enable' | 'reset') {
    const r = await apiRequest<{ inviteUrl?: string; emailed?: boolean }>(`/api/portal-users/${id}`, { method: 'POST', json: { action } })
    if (!r.ok) { setMsg({ text: r.error, error: true }); return }
    if (action === 'reset' && r.data.inviteUrl) linkMessage({ inviteUrl: r.data.inviteUrl, emailed: !!r.data.emailed })
    void load()
  }
  async function remove(id: string) {
    if (!window.confirm('Supprimer cet accès portail ?')) return
    const r = await apiRequest(`/api/portal-users/${id}`, { method: 'DELETE' })
    if (!r.ok) setMsg({ text: r.error, error: true }); else void load()
  }

  return (
    <section aria-labelledby="c-portal">
      <h3 id="c-portal" className="text-sm font-medium text-surface-800">Accès à l&apos;espace client</h3>
      <ul className="mt-2 divide-y divide-surface-100 rounded-xl ring-1 ring-surface-200 text-sm">
        {users.map(u => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>{u.name || u.email}{u.name && <span className="text-surface-500"> · {u.email}</span>}
              <span className="block text-xs text-surface-500">{u.disabled ? 'Désactivé' : !u.activated ? 'Invitation en attente' : u.lastLoginAt ? `Dernière connexion le ${new Date(u.lastLoginAt).toLocaleDateString('fr-FR')}` : 'Jamais connecté'}</span>
            </span>
            <span className="flex gap-1">
              <Btn size="sm" variant="ghost" onClick={() => void act(u.id, 'reset')}>{u.activated ? 'Nouveau mot de passe' : 'Renvoyer le lien'}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => void act(u.id, u.disabled ? 'enable' : 'disable')}>{u.disabled ? 'Réactiver' : 'Désactiver'}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => void remove(u.id)}>Supprimer</Btn>
            </span>
          </li>
        ))}
        {users.length === 0 && <li className="px-3 py-2 text-surface-500">Aucun accès : invitez un contact pour qu&apos;il suive ses bennes et ses factures.</li>}
      </ul>
      <div className="mt-2 flex gap-2">
        <input type="email" aria-label="E-mail à inviter" className={inputCls} placeholder="E-mail du contact" value={email} onChange={e => setEmail(e.target.value)} />
        <Btn size="sm" onClick={() => void invite()} disabled={!email.includes('@')}>Inviter</Btn>
      </div>
      {msg && <p role={msg.error ? 'alert' : 'status'} className={`mt-2 text-xs ${msg.error ? 'text-red-700' : 'text-surface-700'}`}>{msg.text}{msg.link && <input readOnly aria-label="Lien d'invitation" className={`${inputCls} mt-1 font-mono text-xs`} value={msg.link} onFocus={e => e.currentTarget.select()} />}</p>}
    </section>
  )
}
