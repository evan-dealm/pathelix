'use client'

import { useState, useMemo, useEffect } from 'react'
import { Btn, Modal, Field, Input, SelectInput } from '../ui'
import { useDebounce, logErr } from '../hooks'
import { useToast } from '@/components/ui/Toast'
import { usePlanningStore } from '@/stores/planningStore'
import { cachedFetch, invalidateClientCache } from '@/lib/clientCache'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'ADMIN' | 'DISPATCHER' | 'DRIVER'
  driverRef?: string
  createdAt: string
}

type UserForm = {
  email: string
  password: string
  firstName: string
  lastName: string
  role: 'ADMIN' | 'DISPATCHER' | 'DRIVER'
  driverRef: string
}

const BLANK_FORM: UserForm = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  role: 'DISPATCHER',
  driverRef: '',
}

const PERMISSION_LABELS: Record<string, string> = {
  optimize:             'Lancer une optimisation VRP',
  manage_drivers:       'Gérer les chauffeurs',
  manage_exutoires:     'Gérer les exutoires',
  manage_missions:      'Gérer les missions',
  manage_vehicles:      'Gérer les véhicules',
  manage_users:         'Gérer les utilisateurs',
  view_reports:         'Voir les rapports',
  view_costs:           'Voir les coûts',
  manage_settings:      'Gérer les paramètres',
  api_access:           'Accès API (clés)',
  manage_integrations:  'Gérer les intégrations',
}

export function UsersTab() {
  const { error: toastError } = useToast()
  const drivers = usePlanningStore(s => s.drivers)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; user: User } | null>(null)
  const [form, setForm] = useState<UserForm>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [resetPwdId, setResetPwdId] = useState<string | null>(null)
  const [resetPwdValue, setResetPwdValue] = useState('')
  const [resetPwdStatus, setResetPwdStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const [allPermissions, setAllPermissions] = useState<string[]>([])
  const [perms, setPerms] = useState<string[]>([])
  const [permsIsCustom, setPermsIsCustom] = useState(false)
  const [permsLoading, setPermsLoading] = useState(false)
  const [permsSaving, setPermsSaving] = useState(false)
  const [permsStatus, setPermsStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  function load() {
    setLoading(true)
    cachedFetch<User[] | { data?: User[] }>('/api/users', 30_000)
      .then(d => { setUsers(Array.isArray(d) ? d : (d as { data?: User[] })?.data ?? []) })
      .catch(logErr('users'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setForm(BLANK_FORM)
    setError('')
    setModal({ kind: 'new' })
  }

  function openEdit(u: User) {
    setForm({
      email: u.email,
      password: '',
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      driverRef: u.driverRef || '',
    })
    setError('')
    setResetPwdStatus('idle')
    setPermsStatus('idle')
    setModal({ kind: 'edit', user: u })
    loadPermissions(u.id)
  }

  function loadPermissions(userId: string) {
    setPermsLoading(true)
    Promise.all([
      allPermissions.length > 0
        ? Promise.resolve({ allPermissions })
        : fetch('/api/permissions').then(r => r.json()) as Promise<{ allPermissions: string[] }>,
      fetch(`/api/permissions?userId=${userId}`).then(r => r.json()) as Promise<{ permissions: string[]; isCustom: boolean }>,
    ])
      .then(([all, current]) => {
        setAllPermissions(all.allPermissions)
        setPerms(current.permissions ?? [])
        setPermsIsCustom(Boolean(current.isCustom))
      })
      .catch(logErr('permissions'))
      .finally(() => setPermsLoading(false))
  }

  async function savePermissions(userId: string, next: string[]) {
    setPermsSaving(true)
    setPermsStatus('idle')
    try {
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, permissions: next }),
      })
      if (!res.ok) throw new Error()
      setPerms(next)
      setPermsIsCustom(next.length > 0)
      setPermsStatus('ok')
      setTimeout(() => setPermsStatus('idle'), 3000)
    } catch {
      setPermsStatus('error')
      setTimeout(() => setPermsStatus('idle'), 3000)
    } finally {
      setPermsSaving(false)
    }
  }

  function togglePermission(userId: string, permission: string) {
    const next = perms.includes(permission)
      ? perms.filter(p => p !== permission)
      : [...perms, permission]
    savePermissions(userId, next)
  }

  async function handleSave() {
    setError('')
    if (!form.email || !form.firstName || !form.lastName) {
      setError('Veuillez remplir tous les champs obligatoires.')
      return
    }
    if (modal?.kind === 'new' && !form.password) {
      setError('Le mot de passe est obligatoire pour un nouvel utilisateur.')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        driverRef: form.role === 'DRIVER' ? form.driverRef || undefined : undefined,
      }
      if (form.password) body.password = form.password

      if (modal?.kind === 'edit') {
        const res = await fetch(`/api/users/${modal.user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error || 'Erreur serveur')
        }
      } else {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error || 'Erreur serveur')
        }
      }
      setModal(null)
      invalidateClientCache('/api/users')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cet utilisateur ? Cette action est irreversible.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toastError((data as { error?: string }).error || 'Erreur lors de la suppression')
      }
      invalidateClientCache('/api/users')
      load()
    } catch {
      toastError('Erreur réseau')
    } finally {
      setDeleting(null)
    }
  }

  async function handleResetPassword(id: string) {
    if (!resetPwdValue || resetPwdValue.length < 12) {
      setResetPwdStatus('error')
      return
    }
    setResetPwdId(id)
    setResetPwdStatus('idle')
    try {
      const res = await fetch(`/api/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPwdValue }),
      })
      if (!res.ok) throw new Error()
      setResetPwdStatus('ok')
      setResetPwdValue('')
      setTimeout(() => setResetPwdStatus('idle'), 3000)
    } catch {
      setResetPwdStatus('error')
      setTimeout(() => setResetPwdStatus('idle'), 3000)
    } finally {
      setResetPwdId(null)
    }
  }

  const [roleFilter, setRoleFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return users.filter(u => {
      if (q && !`${u.email} ${u.firstName} ${u.lastName} ${u.role}`.toLowerCase().includes(q)) return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      return true
    })
  }, [users, debouncedSearch, roleFilter])

  const roleBadge = (role: string) => {
    const cls = {
      ADMIN: 'bg-violet-50 text-violet-700 border-violet-200',
      DISPATCHER: 'bg-blue-50 text-blue-700 border-blue-200',
      DRIVER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    }[role] || 'bg-surface-100 text-surface-500 border-surface-200'
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}`}>{role}</span>
  }

  const activeDrivers = drivers.filter(d => !d.archived)

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
          {users.length} utilisateur{users.length !== 1 ? 's' : ''}
        </span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-36" />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} title="Filtrer par rôle"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous les rôles</option>
          <option value="ADMIN">Admin</option>
          <option value="DISPATCHER">Dispatcher</option>
          <option value="DRIVER">Chauffeur</option>
        </select>
        <div className="ml-auto">
          <Btn onClick={openNew} variant="primary" size="sm">
            <span className="hidden sm:inline">+ Nouvel utilisateur</span><span className="sm:hidden">+</span>
          </Btn>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-surface-400 text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 gap-2">
            <div className="text-3xl">👤</div>
            <div className="text-sm">Aucun utilisateur trouve</div>
          </div>
        ) : (
          <>
            {}
            <div className="md:hidden space-y-2 px-2 py-2">
              {filtered.map(u => (
                <div key={u.id} className="bg-white border border-surface-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-surface-900 font-semibold text-sm">{u.firstName} {u.lastName}</div>
                      <div className="text-surface-500 text-xs truncate">{u.email}</div>
                    </div>
                    {roleBadge(u.role)}
                  </div>
                  <div className="text-surface-400 text-[10px]">Cree le {new Date(u.createdAt).toLocaleDateString('fr-FR')}</div>
                  <div className="flex items-center gap-1 pt-1">
                    <Btn onClick={() => openEdit(u)} variant="ghost" size="xs">Modifier</Btn>
                    <Btn onClick={() => handleDelete(u.id)} variant="danger" size="xs" disabled={deleting === u.id}>
                      {deleting === u.id ? '...' : 'Supprimer'}
                    </Btn>
                  </div>
                </div>
              ))}
            </div>

            {}
            <table className="w-full text-sm border-collapse hidden md:table">
              <thead className="sticky top-0 bg-surface-50 z-10">
                <tr>
                  {['Email', 'Nom', 'Prenom', 'Role', 'Date creation', 'Actions'].map(h => (
                    <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="text-surface-900 font-semibold text-sm">{u.email}</div>
                      <div className="text-surface-300 text-[10px] font-mono">{u.id}</div>
                    </td>
                    <td className="px-4 py-3 text-surface-600 text-sm">{u.lastName}</td>
                    <td className="px-4 py-3 text-surface-600 text-sm">{u.firstName}</td>
                    <td className="px-4 py-3">{roleBadge(u.role)}</td>
                    <td className="px-4 py-3 text-surface-400 text-xs">{new Date(u.createdAt).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Btn onClick={() => openEdit(u)} variant="ghost" size="xs">Modifier</Btn>
                        <Btn onClick={() => handleDelete(u.id)} variant="danger" size="xs" disabled={deleting === u.id}>
                          {deleting === u.id ? '...' : 'Supprimer'}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {}
      {modal && (
        <Modal title={modal.kind === 'new' ? 'Nouvel utilisateur' : 'Modifier l\'utilisateur'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="Email *">
              <Input value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="email@exemple.com" type="text" />
            </Field>
            <Field label={modal.kind === 'new' ? 'Mot de passe *' : 'Nouveau mot de passe (laisser vide pour ne pas changer)'}>
              <Input value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder={modal.kind === 'new' ? 'Min. 12 caractères' : 'Optionnel'} type="password" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prenom *">
                <Input value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} placeholder="Jean" />
              </Field>
              <Field label="Nom *">
                <Input value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} placeholder="Dupont" />
              </Field>
            </div>
            <Field label="Role">
              <SelectInput value={form.role} onChange={v => setForm(f => ({ ...f, role: v as UserForm['role'] }))} options={[
                { value: 'ADMIN', label: 'Administrateur' },
                { value: 'DISPATCHER', label: 'Dispatcher' },
                { value: 'DRIVER', label: 'Chauffeur' },
              ]} />
            </Field>
            {form.role === 'DRIVER' && (
              <Field label="Chauffeur associe">
                <SelectInput value={form.driverRef} onChange={v => setForm(f => ({ ...f, driverRef: v }))} options={[
                  { value: '', label: '-- Aucun --' },
                  ...activeDrivers.map(d => ({ value: d.id, label: `${d.firstName} ${d.lastName}` })),
                ]} />
              </Field>
            )}

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            {modal.kind === 'edit' && (
              <div className="border-t border-surface-200 pt-3">
                <div className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">Reinitialiser le mot de passe</div>
                <div className="flex items-center gap-2">
                  <Input value={resetPwdValue} onChange={v => setResetPwdValue(v)} placeholder="Nouveau mot de passe (min. 12 car.)" />
                  <Btn
                    onClick={() => handleResetPassword(modal.user.id)}
                    variant="warning"
                    size="sm"
                    disabled={resetPwdId === modal.user.id || !resetPwdValue || resetPwdValue.length < 12}
                  >
                    {resetPwdId === modal.user.id ? '...' : 'Changer'}
                  </Btn>
                </div>
                {resetPwdStatus === 'ok' && <p className="text-emerald-600 text-xs mt-1.5">Mot de passe modifie avec succes</p>}
                {resetPwdStatus === 'error' && <p className="text-red-600 text-xs mt-1.5">Erreur — min. 12 caractères</p>}
              </div>
            )}

            {modal.kind === 'edit' && (
              <div className="border-t border-surface-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-surface-500 uppercase tracking-wider">
                    Permissions
                  </div>
                  {permsIsCustom && (
                    <button
                      type="button"
                      onClick={() => savePermissions(modal.user.id, [])}
                      disabled={permsSaving}
                      className="text-[11px] text-surface-400 hover:text-surface-600 underline"
                    >
                      Réinitialiser aux valeurs par défaut du rôle
                    </button>
                  )}
                </div>
                {permsLoading ? (
                  <p className="text-surface-400 text-xs">Chargement...</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                    {allPermissions.map(p => (
                      <label key={p} className="flex items-center gap-2 text-xs text-surface-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={perms.includes(p)}
                          disabled={permsSaving}
                          onChange={() => togglePermission(modal.user.id, p)}
                          className="rounded border-surface-300"
                        />
                        {PERMISSION_LABELS[p] ?? p}
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-surface-400 text-[10px] mt-1.5">
                  {permsIsCustom
                    ? 'Permissions personnalisées — remplacent les valeurs par défaut du rôle.'
                    : 'Valeurs par défaut du rôle actuel — cocher/décocher personnalise cet utilisateur.'}
                </p>
                {permsStatus === 'ok' && <p className="text-emerald-600 text-xs mt-1">Permissions mises à jour</p>}
                {permsStatus === 'error' && <p className="text-red-600 text-xs mt-1">Erreur lors de la mise à jour</p>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Btn onClick={() => setModal(null)} variant="ghost" size="sm">Annuler</Btn>
              <Btn onClick={handleSave} variant="primary" size="sm" disabled={saving}>
                {saving ? 'Enregistrement...' : modal.kind === 'new' ? 'Creer' : 'Enregistrer'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
