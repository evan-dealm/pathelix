'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import Image from 'next/image'
import { BRAND_LOGO_SRC } from '@/lib/branding'
import { TRADES, TRADE_IDS } from '@/lib/trades'
import { usePlanningStore } from '@/stores/planningStore'
import { DemoRequestsPanel } from '@/components/admin/DemoRequestsPanel'

interface TenantStats {
  id: string; name: string; slug: string; plan: string
  trade: string | null; maxDrivers: number | null; maxMissions: number | null
  createdAt: string; suspendedAt: string | null; suspendedBy: string | null
  stats: { users: number; drivers: number; missions: number; vehicles: number; plans: number }
}

interface GlobalStats {
  global: { totalTenants: number; totalUsers: number; totalDrivers: number; totalMissions: number; totalVehicles: number; totalPlans: number }
  recent: { missions30d: number; plans30d: number; newUsers7d: number }
  tenantsByPlan: Record<string, number>
  topTenants: Array<{ tenantId: string; missions30d: number; name?: string; slug?: string; plan?: string }>
  dailyActivity: Array<{ date: string; missions: number; plans: number }>
  recentAudit: Array<{ id: string; tenantName: string; userId: string; action: string; entityType: string; entityId: string; createdAt: string }>
  suspendedTenants: number
  totalExutoires: number
  totalClients: number
  totalSites: number
}

interface AuditLogRow {
  id: string; tenantId: string; userId: string; action: string
  entityType: string; entityId: string; createdAt: string
  changes: Record<string, unknown>
  tenant: { name: string; slug: string }
}

interface SystemHealth {
  timestamp: string
  uptime: { seconds: number; formatted: string }
  memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number; usagePercent: number }
  redis: { status: string; memoryUsed?: string; memoryPeak?: string; connectedClients?: number; totalKeys?: number }
  queue: { status: string; waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number }
  routing: { status: string; engine?: string; url?: string; httpStatus?: number; error?: string; fallbackUrl?: string; note?: string }
  database: { status: string; responseTimeMs?: number }
  node: { version: string; platform: string; arch: string }
}

interface ToastItem { id: number; message: string; type: 'success' | 'error' | 'info' }

function useToastLocal() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const show = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(p => [...p.slice(-3), { id, message, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])
  return { toasts, show }
}

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-6 right-6 z-[60] space-y-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-xl text-sm font-medium shadow-lg border animate-slide-up ${
          t.type === 'success' ? 'bg-green-900/90 text-green-200 border-green-700/50' :
          t.type === 'error' ? 'bg-red-900/90 text-red-200 border-red-700/50' :
          'bg-blue-900/90 text-blue-200 border-blue-700/50'
        }`}>{t.message}</div>
      ))}
    </div>
  )
}

function ConfirmModal({ open, title, message, confirmLabel, danger, onConfirm, onCancel, children }: {
  open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void; children?: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold">{title}</h3>
        <p className="text-sm text-zinc-400">{message}</p>
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition">Annuler</button>
          <button type="button" onClick={onConfirm} className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{confirmLabel ?? 'Confirmer'}</button>
        </div>
      </div>
    </div>
  )
}

function FormModal({ open, title, onClose, onSubmit, submitLabel, error, children }: {
  open: boolean; title: string; onClose: () => void; onSubmit: () => void
  submitLabel?: string; error?: string; children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold">{title}</h3>
        {error && <div className="text-red-400 text-xs bg-red-900/30 px-3 py-2 rounded-lg">{error}</div>}
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition">Annuler</button>
          <button type="button" onClick={onSubmit} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-green-600 hover:bg-green-700 transition">{submitLabel ?? 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}

function ModalInput({ label, value, onChange, type, placeholder }: {
  label: string; value: string; onChange: (_v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
      <input type={type ?? 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
    </div>
  )
}

function ModalSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (_v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} title={label}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none">
        {options.map(o => <option key={o.value} value={o.value} className="bg-zinc-800">{o.label}</option>)}
      </select>
    </div>
  )
}

function StatCard({ label, value, sub, trend }: { label: string; value: number | string; sub?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 shadow-sm hover:border-zinc-700 transition">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</div>
        {trend === 'up' && <span className="text-green-400 text-[10px]">&#9650;</span>}
        {trend === 'down' && <span className="text-red-400 text-[10px]">&#9660;</span>}
      </div>
      <div className="text-2xl font-bold mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-1">{sub}</div>}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok' || status === 'connected'
    ? 'bg-green-500' : status === 'degraded'
    ? 'bg-yellow-500' : status === 'error'
    ? 'bg-red-500' : 'bg-zinc-400'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
}

const PLAN_LABELS: Record<string, string> = { FREE: 'Starter', PRO: 'Pro', ENTERPRISE: 'Enterprise' }
const PLAN_OPTIONS = [
  { value: 'FREE', label: 'Starter' },
  { value: 'PRO', label: 'Pro' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
]

function PlanBadge({ plan }: { plan: string }) {
  const c: Record<string, string> = {
    FREE: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
    PRO: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    ENTERPRISE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  }
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${c[plan] ?? c.FREE}`}>{PLAN_LABELS[plan] ?? plan}</span>
}

function SuspendedBadge() {
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 animate-pulse">SUSPENDU</span>
}

function TenantDetailPanel({ data, tenantName, tenantId, toast, onRefresh }: { data: Record<string, unknown>; tenantName: string; tenantId: string; toast: (_msg: string, _type?: 'success' | 'error' | 'info') => void; onRefresh: () => void }) {
  const [activeTab, setActiveTab] = useState<'users' | 'drivers' | 'vehicles' | 'missions' | 'exutoires' | 'clients' | 'sites' | 'templates' | 'settings'>('users')
  const [deleteRes, setDeleteRes] = useState<{ entity: string; id: string; label: string } | null>(null)
  const [editRes, setEditRes] = useState<{ entity: string; id: string; label: string; data: Record<string, unknown> } | null>(null)
  const [editResForm, setEditResForm] = useState<Record<string, string>>({})
  const [editResSaving, setEditResSaving] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({})
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [userFormOpen, setUserFormOpen] = useState(false)
  const [newUserForm, setNewUserForm] = useState({ email: '', password: '', firstName: '', lastName: '', role: 'DRIVER' })
  const [newUserError, setNewUserError] = useState('')
  const [newUserLoading, setNewUserLoading] = useState(false)
  const [editUserModal, setEditUserModal] = useState<Record<string, unknown> | null>(null)
  const [editUserForm, setEditUserForm] = useState({ firstName: '', lastName: '', email: '', role: '' })
  const [editUserLoading, setEditUserLoading] = useState(false)
  const [deleteUserConfirm, setDeleteUserConfirm] = useState<{ id: string; email: string } | null>(null)
  const [resetPwdUser, setResetPwdUser] = useState<{ id: string; email: string } | null>(null)
  const [resetPwdValue, setResetPwdValue] = useState('')
  const [resetPwdLoading, setResetPwdLoading] = useState(false)

  const users     = (data.users     as Array<Record<string, unknown>>) ?? []
  const drivers   = (data.drivers   as Array<Record<string, unknown>>) ?? []
  const vehicles  = (data.vehicles  as Array<Record<string, unknown>>) ?? []
  const missions  = (data.missions  as Array<Record<string, unknown>>) ?? []
  const exutoires = (data.exutoires as Array<Record<string, unknown>>) ?? []
  const clients   = (data.clients   as Array<Record<string, unknown>>) ?? []
  const sites     = (data.sites     as Array<Record<string, unknown>>) ?? []
  const templates = (data.templates as Array<Record<string, unknown>>) ?? []
  const settings  = (data.settings  as Record<string, unknown>) ?? null
  const missionsTotal = (data.missionsTotal as number) ?? missions.length

  async function deleteResource() {
    if (!deleteRes) return
    const r = await fetch(`/api/superadmin/tenants/${tenantId}/resources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: deleteRes.entity, action: 'delete', id: deleteRes.id }),
    })
    if (r.ok) { toast(`${deleteRes.label} supprimé`, 'success'); onRefresh() }
    else toast('Erreur lors de la suppression', 'error')
    setDeleteRes(null)
  }

  async function saveResource() {
    if (!editRes) return
    setEditResSaving(true)
    const r = await fetch(`/api/superadmin/tenants/${tenantId}/resources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: editRes.entity, action: 'update', id: editRes.id, data: editResForm }),
    })
    if (r.ok) { toast(`${editRes.label} modifié`, 'success'); onRefresh() }
    else toast('Erreur lors de la modification', 'error')
    setEditResSaving(false)
    setEditRes(null)
  }

  function openEdit(entity: string, id: string, label: string, row: Record<string, unknown>) {
    const form: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) {
      if (k === 'id' || k === 'tenantId' || k === 'createdAt' || k === 'updatedAt') continue
      if (v === null || v === undefined) form[k] = ''
      else if (typeof v === 'object') form[k] = JSON.stringify(v)
      else form[k] = String(v)
    }
    setEditRes({ entity, id, label, data: row })
    setEditResForm(form)
  }

  async function saveSettings() {
    setSettingsSaving(true)
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(settingsForm)) {
      if (v === '') continue
      if (['defaultSpeedKmh', 'maxWorkDayMin', 'pauseAfterMin', 'pauseDurationMin', 'maxOptimizationsPerDay'].includes(k)) payload[k] = parseInt(v, 10)
      else if (['costPerKm', 'fuelCostPerLiter', 'consumptionLPer100'].includes(k)) payload[k] = parseFloat(v)
      else payload[k] = v
    }
    const r = await fetch(`/api/superadmin/tenants/${tenantId}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) { toast('Paramètres enregistrés', 'success'); onRefresh() }
    else toast('Erreur lors de la sauvegarde', 'error')
    setSettingsSaving(false)
  }

  async function createUser() {
    setNewUserError('')
    setNewUserLoading(true)
    const r = await fetch('/api/superadmin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newUserForm, tenantId }),
    })
    setNewUserLoading(false)
    if (r.ok) {
      setUserFormOpen(false)
      setNewUserForm({ email: '', password: '', firstName: '', lastName: '', role: 'DRIVER' })
      toast('Utilisateur créé', 'success')
      onRefresh()
    } else {
      const d = await r.json() as Record<string, unknown>
      setNewUserError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error))
    }
  }

  async function doEditUser() {
    if (!editUserModal) return
    setEditUserLoading(true)
    await fetch(`/api/superadmin/users/${String(editUserModal.id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editUserForm),
    })
    setEditUserLoading(false)
    setEditUserModal(null)
    toast('Utilisateur modifié', 'success')
    onRefresh()
  }

  async function doDeleteUser() {
    if (!deleteUserConfirm) return
    await fetch(`/api/superadmin/users/${deleteUserConfirm.id}`, { method: 'DELETE' })
    toast('Utilisateur supprimé', 'success')
    setDeleteUserConfirm(null)
    onRefresh()
  }

  async function doResetPassword() {
    if (!resetPwdUser || resetPwdValue.length < 8) return
    setResetPwdLoading(true)
    await fetch(`/api/superadmin/users/${resetPwdUser.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: resetPwdValue }),
    })
    setResetPwdLoading(false)
    toast('Mot de passe modifié', 'success')
    setResetPwdUser(null)
    setResetPwdValue('')
  }

  const sections = [
    { key: 'users' as const,     label: `Utilisateurs (${users.length})` },
    { key: 'drivers' as const,   label: `Chauffeurs (${drivers.length})` },
    { key: 'vehicles' as const,  label: `Véhicules (${vehicles.length})` },
    { key: 'missions' as const,  label: `Missions (${missionsTotal})` },
    { key: 'exutoires' as const, label: `Exutoires (${exutoires.length})` },
    { key: 'clients' as const,   label: `Clients (${clients.length})` },
    { key: 'sites' as const,     label: `Sites (${sites.length})` },
    { key: 'templates' as const, label: `Templates (${templates.length})` },
    { key: 'settings' as const,  label: 'Paramètres' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-zinc-300">
        <span>Données de {tenantName}</span>
      </div>

      {}
      <div className="flex gap-1 border-b border-zinc-700 pb-1">
        {sections.map(s => (
          <button key={s.key} type="button" onClick={() => setActiveTab(s.key)}
            className={`px-3 py-1.5 text-[10px] font-bold rounded-t transition ${activeTab === s.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="max-h-64 overflow-y-auto">
        {activeTab === 'users' && (
          <div>
            {}
            {userFormOpen ? (
              <div className="bg-zinc-800/60 px-4 py-3 space-y-2 border-b border-zinc-700">
                <div className="text-[10px] font-bold text-zinc-400">Nouvel utilisateur dans {tenantName}</div>
                {newUserError && <div className="text-red-400 text-[10px] bg-red-900/30 px-2 py-1 rounded">{newUserError}</div>}
                <div className="grid grid-cols-5 gap-2">
                  <input placeholder="Email" value={newUserForm.email} onChange={e => setNewUserForm(p => ({ ...p, email: e.target.value }))}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] focus:border-red-500 focus:outline-none" />
                  <input placeholder="Mot de passe" type="password" value={newUserForm.password} onChange={e => setNewUserForm(p => ({ ...p, password: e.target.value }))}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] focus:border-red-500 focus:outline-none" />
                  <input placeholder="Prénom" value={newUserForm.firstName} onChange={e => setNewUserForm(p => ({ ...p, firstName: e.target.value }))}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] focus:border-red-500 focus:outline-none" />
                  <input placeholder="Nom" value={newUserForm.lastName} onChange={e => setNewUserForm(p => ({ ...p, lastName: e.target.value }))}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] focus:border-red-500 focus:outline-none" />
                  <select value={newUserForm.role} onChange={e => setNewUserForm(p => ({ ...p, role: e.target.value }))} title="Rôle"
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-100 focus:border-red-500 focus:outline-none">
                    <option value="ADMIN" className="bg-zinc-900">ADMIN</option>
                    <option value="DISPATCHER" className="bg-zinc-900">DISPATCHER</option>
                    <option value="DRIVER" className="bg-zinc-900">DRIVER</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={createUser} disabled={newUserLoading}
                    className="bg-green-600 text-white px-3 py-1 rounded text-[10px] font-bold hover:bg-green-700 transition disabled:opacity-50">
                    {newUserLoading ? 'Création...' : 'Créer'}
                  </button>
                  <button type="button" onClick={() => { setUserFormOpen(false); setNewUserError('') }} className="text-zinc-500 text-[10px] hover:text-zinc-300">Annuler</button>
                </div>
              </div>
            ) : (
              <div className="px-3 py-2 border-b border-zinc-700/50">
                <button type="button" onClick={() => setUserFormOpen(true)}
                  className="text-[10px] text-blue-400 hover:text-blue-300 font-bold">+ Ajouter un utilisateur</button>
              </div>
            )}
            <table className="w-full text-[11px]">
              <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
                <th className="px-3 py-1.5">Nom</th><th className="px-3 py-1.5">Email</th><th className="px-3 py-1.5">Rôle</th><th className="px-3 py-1.5">Créé le</th><th className="px-3 py-1.5 w-28">Actions</th>
              </tr></thead>
              <tbody>{users.map((u, i) => (
                <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                  <td className="px-3 py-1.5 font-medium">{String(u.firstName ?? '')} {String(u.lastName ?? '')}</td>
                  <td className="px-3 py-1.5 text-zinc-400 font-mono">{String(u.email ?? '')}</td>
                  <td className="px-3 py-1.5"><RoleBadge role={String(u.role ?? '')} /></td>
                  <td className="px-3 py-1.5 text-zinc-500 font-mono">{u.createdAt ? new Date(String(u.createdAt)).toLocaleDateString('fr-FR') : '-'}</td>
                  <td className="px-3 py-1.5 flex gap-1">
                    <button type="button" onClick={() => { setEditUserModal(u); setEditUserForm({ firstName: String(u.firstName ?? ''), lastName: String(u.lastName ?? ''), email: String(u.email ?? ''), role: String(u.role ?? '') }) }}
                      className="text-blue-400/70 hover:text-blue-400 text-[9px] font-bold">Modifier</button>
                    <button type="button" onClick={() => { setResetPwdUser({ id: String(u.id), email: String(u.email ?? '') }); setResetPwdValue('') }}
                      className="text-zinc-400/70 hover:text-zinc-300 text-[9px] font-bold">MDP</button>
                    <button type="button" onClick={() => setDeleteUserConfirm({ id: String(u.id), email: String(u.email ?? '') })}
                      className="text-red-400/70 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {activeTab === 'drivers' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Nom</th><th className="px-3 py-1.5">Secteur</th><th className="px-3 py-1.5">Tel</th><th className="px-3 py-1.5">Benne max</th><th className="px-3 py-1.5">Statut</th><th className="px-3 py-1.5 w-20">Actions</th>
            </tr></thead>
            <tbody>{drivers.map((d, i) => (
              <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                <td className="px-3 py-1.5 font-medium">{String(d.firstName ?? '')} {String(d.lastName ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{String(d.sector ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 font-mono">{String(d.phone ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{d.maxBinSizeM3 ? `${d.maxBinSizeM3} m3` : '-'}</td>
                <td className="px-3 py-1.5">{d.archived ? <span className="text-red-400">Archivé</span> : <span className="text-green-400">Actif</span>}</td>
                <td className="px-3 py-1.5 flex gap-1">
                  <button type="button" onClick={() => openEdit('driver', String(d.id), `${d.firstName} ${d.lastName}`, d)} className="text-blue-400/60 hover:text-blue-400 text-[9px] font-bold">Éditer</button>
                  <button type="button" onClick={() => setDeleteRes({ entity: 'driver', id: String(d.id), label: `${d.firstName} ${d.lastName}` })} className="text-red-400/60 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {activeTab === 'vehicles' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Plaque</th><th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Marque</th><th className="px-3 py-1.5">Capacité</th><th className="px-3 py-1.5">Statut</th><th className="px-3 py-1.5 w-20">Actions</th>
            </tr></thead>
            <tbody>{vehicles.map((v, i) => (
              <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                <td className="px-3 py-1.5 font-mono font-medium">{String(v.licensePlate ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{String(v.type ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{String(v.brand ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{v.capacityM3 ? `${v.capacityM3} m3` : '-'}</td>
                <td className="px-3 py-1.5">{v.status === 'active' ? <span className="text-green-400">Actif</span> : <span className="text-zinc-500">{String(v.status ?? '')}</span>}</td>
                <td className="px-3 py-1.5 flex gap-1">
                  <button type="button" onClick={() => openEdit('vehicle', String(v.id), String(v.licensePlate), v)} className="text-blue-400/60 hover:text-blue-400 text-[9px] font-bold">Éditer</button>
                  <button type="button" onClick={() => setDeleteRes({ entity: 'vehicle', id: String(v.id), label: String(v.licensePlate) })} className="text-red-400/60 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {activeTab === 'missions' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Client</th><th className="px-3 py-1.5">Adresse</th><th className="px-3 py-1.5">Déchet</th><th className="px-3 py-1.5">P</th>
            </tr></thead>
            <tbody>{missions.slice(0, 100).map((m, i) => (
              <tr key={i} className="border-t border-zinc-700/50">
                <td className="px-3 py-1.5 font-medium">{String(m.type ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 font-mono">{String(m.date ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 truncate max-w-[120px]">{String(m.clientName ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-500 truncate max-w-[200px]">{String(m.address ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{String(m.wasteTypeLabel ?? '')}</td>
                <td className="px-3 py-1.5">{m.priority === 1 ? <span className="text-red-400 font-bold">P1</span> : m.priority === 2 ? <span className="text-amber-400">P2</span> : <span className="text-zinc-500">P3</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {activeTab === 'exutoires' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Nom</th><th className="px-3 py-1.5">Adresse</th><th className="px-3 py-1.5">Déchets acceptés</th><th className="px-3 py-1.5 w-20">Actions</th>
            </tr></thead>
            <tbody>{exutoires.map((e, i) => (
              <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                <td className="px-3 py-1.5 font-medium">{String(e.name ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 truncate max-w-[250px]">{String(e.address ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-500 truncate max-w-[200px]">{Array.isArray(e.acceptedWasteTypes) ? (e.acceptedWasteTypes as string[]).join(', ') : '-'}</td>
                <td className="px-3 py-1.5 flex gap-1">
                  <button type="button" onClick={() => openEdit('exutoire', String(e.id), String(e.name), e)} className="text-blue-400/60 hover:text-blue-400 text-[9px] font-bold">Éditer</button>
                  <button type="button" onClick={() => setDeleteRes({ entity: 'exutoire', id: String(e.id), label: String(e.name) })} className="text-red-400/60 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {activeTab === 'clients' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Nom</th><th className="px-3 py-1.5">Contact</th><th className="px-3 py-1.5">Tel</th><th className="px-3 py-1.5">Email</th><th className="px-3 py-1.5">VIP</th><th className="px-3 py-1.5 w-20">Actions</th>
            </tr></thead>
            <tbody>{clients.map((c, i) => (
              <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                <td className="px-3 py-1.5 font-medium">{String(c.name ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{String(c.contact ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 font-mono">{String(c.phone ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400">{String(c.email ?? '')}</td>
                <td className="px-3 py-1.5">{c.vip ? <span className="text-amber-400 font-bold">VIP</span> : '-'}</td>
                <td className="px-3 py-1.5 flex gap-1">
                  <button type="button" onClick={() => openEdit('client', String(c.id), String(c.name), c)} className="text-blue-400/60 hover:text-blue-400 text-[9px] font-bold">Éditer</button>
                  <button type="button" onClick={() => setDeleteRes({ entity: 'client', id: String(c.id), label: String(c.name) })} className="text-red-400/60 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {activeTab === 'sites' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Nom</th><th className="px-3 py-1.5">Adresse</th><th className="px-3 py-1.5">GPS</th><th className="px-3 py-1.5 w-20">Actions</th>
            </tr></thead>
            <tbody>{sites.map((s, i) => (
              <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                <td className="px-3 py-1.5 font-medium">{String(s.name ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 truncate max-w-[250px]">{String(s.address ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-500 font-mono">{s.latitude ? `${Number(s.latitude).toFixed(4)}, ${Number(s.longitude).toFixed(4)}` : '-'}</td>
                <td className="px-3 py-1.5 flex gap-1">
                  <button type="button" onClick={() => openEdit('site', String(s.id), String(s.name), s)} className="text-blue-400/60 hover:text-blue-400 text-[9px] font-bold">Éditer</button>
                  <button type="button" onClick={() => setDeleteRes({ entity: 'site', id: String(s.id), label: String(s.name) })} className="text-red-400/60 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {activeTab === 'templates' && (
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500 text-left uppercase sticky top-0 bg-zinc-800/80"><tr>
              <th className="px-3 py-1.5">Label</th><th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Client</th><th className="px-3 py-1.5">Adresse</th><th className="px-3 py-1.5">Actif</th><th className="px-3 py-1.5 w-20">Actions</th>
            </tr></thead>
            <tbody>{templates.map((t, i) => (
              <tr key={i} className="border-t border-zinc-700/50 hover:bg-zinc-700/30">
                <td className="px-3 py-1.5 font-medium">{String(t.label ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 font-mono">{String(t.type ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-400 truncate max-w-[120px]">{String(t.clientName ?? '')}</td>
                <td className="px-3 py-1.5 text-zinc-500 truncate max-w-[200px]">{String(t.address ?? '')}</td>
                <td className="px-3 py-1.5">{t.enabled ? <span className="text-green-400">Oui</span> : <span className="text-red-400">Non</span>}</td>
                <td className="px-3 py-1.5 flex gap-1">
                  <button type="button" onClick={() => openEdit('missionTemplate', String(t.id), String(t.label), t)} className="text-blue-400/60 hover:text-blue-400 text-[9px] font-bold">Éditer</button>
                  <button type="button" onClick={() => setDeleteRes({ entity: 'missionTemplate', id: String(t.id), label: String(t.label) })} className="text-red-400/60 hover:text-red-400 text-[9px] font-bold">Suppr</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {}
        {activeTab === 'settings' && (
          <div className="space-y-3 py-2">
            {settings ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {([
                    ['defaultSpeedKmh', 'Vitesse par défaut (km/h)', String(settings.defaultSpeedKmh ?? 50)],
                    ['defaultStartTime', 'Heure de départ', String(settings.defaultStartTime ?? '07:00')],
                    ['maxWorkDayMin', 'Durée max journée (min)', String(settings.maxWorkDayMin ?? 600)],
                    ['pauseAfterMin', 'Pause après (min)', String(settings.pauseAfterMin ?? 270)],
                    ['pauseDurationMin', 'Durée pause (min)', String(settings.pauseDurationMin ?? 45)],
                    ['costPerKm', 'Coût / km', String(settings.costPerKm ?? 0.35)],
                    ['fuelCostPerLiter', 'Coût carburant / L', String(settings.fuelCostPerLiter ?? 1.80)],
                    ['consumptionLPer100', 'Consommation L/100km', String(settings.consumptionLPer100 ?? 30)],
                    ['maxOptimizationsPerDay', 'Max optimisations / jour', String(settings.maxOptimizationsPerDay ?? 10)],
                    ['companyDisplayName', 'Nom affiché', String(settings.companyDisplayName ?? '')],
                    ['primaryColor', 'Couleur primaire', String(settings.primaryColor ?? '#0055A4')],
                  ] as [string, string, string][]).map(([key, label, defaultVal]) => (
                    <div key={key}>
                      <label htmlFor={`setting-${key}`} className="block text-[10px] text-zinc-500 mb-0.5">{label}</label>
                      <input id={`setting-${key}`} value={settingsForm[key] ?? defaultVal}
                        onChange={e => setSettingsForm(p => ({ ...p, [key]: e.target.value }))}
                        aria-label={label}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs focus:border-red-500 focus:outline-none" />
                    </div>
                  ))}
                </div>
                <button type="button" onClick={saveSettings} disabled={settingsSaving}
                  className="bg-green-600 text-white px-4 py-1.5 rounded text-[10px] font-bold hover:bg-green-700 transition disabled:opacity-50">
                  {settingsSaving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
                </button>
              </>
            ) : (
              <div className="text-zinc-600 text-xs py-4 text-center">Aucun paramètre configuré pour ce tenant</div>
            )}
          </div>
        )}

        {}
        {activeTab !== 'settings' && (
          (activeTab === 'users' && users.length === 0) ||
          (activeTab === 'drivers' && drivers.length === 0) ||
          (activeTab === 'vehicles' && vehicles.length === 0) ||
          (activeTab === 'missions' && missions.length === 0) ||
          (activeTab === 'exutoires' && exutoires.length === 0) ||
          (activeTab === 'clients' && clients.length === 0) ||
          (activeTab === 'sites' && sites.length === 0) ||
          (activeTab === 'templates' && templates.length === 0) ? (
            <div className="text-zinc-600 text-xs py-4 text-center">Aucune donnée</div>
          ) : null
        )}
      </div>

      {}
      <ConfirmModal open={!!deleteRes} danger
        title="Supprimer la ressource"
        message={`Supprimer "${deleteRes?.label ?? ''}" ? Cette action est irréversible.`}
        confirmLabel="Supprimer" onConfirm={deleteResource} onCancel={() => setDeleteRes(null)} />

      {}
      {editRes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditRes(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Modifier — ${editRes.label}`} className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold">Modifier — {editRes.label}</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(editResForm).map(([key, val]) => (
                <div key={key}>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">{key}</label>
                  <input value={val} onChange={e => setEditResForm(p => ({ ...p, [key]: e.target.value }))}
                    title={key} aria-label={key}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditRes(null)} className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition">Annuler</button>
              <button type="button" onClick={saveResource} disabled={editResSaving} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50">
                {editResSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {}
      <FormModal open={!!editUserModal} title={`Modifier ${String(editUserModal?.email ?? '')}`}
        onClose={() => setEditUserModal(null)} onSubmit={doEditUser} submitLabel={editUserLoading ? 'Enregistrement...' : 'Enregistrer'}>
        <div className="grid grid-cols-2 gap-3">
          <ModalInput label="Prénom" value={editUserForm.firstName} onChange={v => setEditUserForm(p => ({ ...p, firstName: v }))} />
          <ModalInput label="Nom" value={editUserForm.lastName} onChange={v => setEditUserForm(p => ({ ...p, lastName: v }))} />
        </div>
        <ModalInput label="Email" value={editUserForm.email} onChange={v => setEditUserForm(p => ({ ...p, email: v }))} type="email" />
        <ModalSelect label="Rôle" value={editUserForm.role} onChange={v => setEditUserForm(p => ({ ...p, role: v }))}
          options={[{ value: 'ADMIN', label: 'Admin' }, { value: 'DISPATCHER', label: 'Dispatcher' }, { value: 'DRIVER', label: 'Chauffeur' }]} />
      </FormModal>

      {}
      <ConfirmModal open={!!deleteUserConfirm} danger
        title="Supprimer l'utilisateur"
        message={`Supprimer définitivement ${deleteUserConfirm?.email ?? ''} ? Action irréversible.`}
        confirmLabel="Supprimer" onConfirm={doDeleteUser} onCancel={() => setDeleteUserConfirm(null)} />

      {}
      <ConfirmModal open={!!resetPwdUser}
        title="Réinitialiser le mot de passe"
        message={`Nouveau mot de passe pour ${resetPwdUser?.email ?? ''}`}
        confirmLabel={resetPwdLoading ? 'Enregistrement...' : 'Réinitialiser'} danger
        onConfirm={doResetPassword} onCancel={() => { setResetPwdUser(null); setResetPwdValue('') }}>
        <input type="password" value={resetPwdValue} onChange={e => setResetPwdValue(e.target.value)}
          placeholder="Minimum 8 caractères" autoFocus
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none mt-2" />
        {resetPwdValue.length > 0 && resetPwdValue.length < 8 && (
          <p className="text-red-400 text-xs mt-1">Minimum 8 caractères</p>
        )}
      </ConfirmModal>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const c = role === 'SUPERADMIN' ? 'bg-red-900/50 text-red-300'
    : role === 'ADMIN' ? 'bg-amber-900/50 text-amber-300'
    : role === 'DISPATCHER' ? 'bg-blue-900/50 text-blue-300'
    : 'bg-zinc-700/50 text-zinc-400'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${c}`}>{role}</span>
}

function actionColor(action: string): string {
  if (action.includes('delete') || action.includes('suspend') || action.includes('purge')) return 'bg-red-900/40 text-red-400'
  if (action.includes('create') || action.includes('activate')) return 'bg-green-900/40 text-green-400'
  if (action.includes('update') || action.includes('status')) return 'bg-blue-900/40 text-blue-400'
  if (action.includes('superadmin') || action.includes('impersonate')) return 'bg-amber-900/40 text-amber-400'
  return 'bg-zinc-700/40 text-zinc-400'
}

function AuditHistoryTab({ logs, total, tenants, filter, onFilterChange }: {
  logs: AuditLogRow[]
  total: number
  tenants: TenantStats[]
  filter: string
  onFilterChange: (_tenantId: string) => void
}) {
  const [openTenants, setOpenTenants] = useState<Set<string>>(new Set())

  function exportCSV() {
    const header = 'Date,Tenant,User,Action,Entity Type,Entity ID\n'
    const rows = logs.map(l =>
      `"${new Date(l.createdAt).toLocaleString('fr-FR')}","${l.tenant?.name ?? l.tenantId}","${l.userId}","${l.action}","${l.entityType}","${l.entityId}"`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const grouped = new Map<string, { tenantName: string; tenantSlug: string; logs: AuditLogRow[] }>()
  for (const l of logs) {
    const key = l.tenantId
    if (!grouped.has(key)) {
      grouped.set(key, { tenantName: l.tenant?.name ?? key, tenantSlug: l.tenant?.slug ?? '', logs: [] })
    }
    grouped.get(key)!.logs.push(l)
  }
  const sortedGroups = [...grouped.entries()].sort((a, b) => a[1].tenantName.localeCompare(b[1].tenantName))

  function toggle(tid: string) {
    setOpenTenants(prev => {
      const n = new Set(prev)
      if (n.has(tid)) n.delete(tid); else n.add(tid)
      return n
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">{total} événement{total > 1 ? 's' : ''} au total</h2>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={e => onFilterChange(e.target.value)} title="Filtrer par tenant"
            className="bg-zinc-800 text-zinc-100 text-xs border border-zinc-700 rounded-lg px-3 py-1.5 focus:border-red-500 focus:outline-none">
            <option value="" className="bg-zinc-800 text-zinc-100">Toutes les entreprises</option>
            {tenants.filter(t => t.slug !== '__platform__').map(t => (
              <option key={t.id} value={t.id} className="bg-zinc-800 text-zinc-100">{t.name}</option>
            ))}
          </select>
          <button type="button" onClick={exportCSV}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded transition">Exporter CSV</button>
          <button type="button" onClick={() => setOpenTenants(new Set(sortedGroups.map(([k]) => k)))}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded transition">Tout ouvrir</button>
          <button type="button" onClick={() => setOpenTenants(new Set())}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded transition">Tout fermer</button>
        </div>
      </div>

      <div className="space-y-2">
        {sortedGroups.map(([tenantId, group]) => {
          const isOpen = openTenants.has(tenantId)
          return (
            <div key={tenantId} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <button type="button" onClick={() => toggle(tenantId)}
                className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-800/50 transition text-left">
                <span className={`text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm">{group.tenantName}</span>
                  {group.tenantSlug && <span className="ml-2 text-zinc-500 font-mono text-xs">{group.tenantSlug}</span>}
                </div>
                <span className="text-xs font-bold text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{group.logs.length} événements</span>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-800 max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-800/30 text-zinc-500 text-left uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="px-5 py-2 w-36">Date</th>
                        <th className="px-4 py-2 w-28">Utilisateur</th>
                        <th className="px-4 py-2 w-40">Action</th>
                        <th className="px-4 py-2 w-24">Entité</th>
                        <th className="px-4 py-2">Détails</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.logs.map(l => (
                        <tr key={l.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/30 transition">
                          <td className="px-5 py-2 text-zinc-500 font-mono">
                            {new Date(l.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-4 py-2 font-mono truncate max-w-[120px]" title={l.userId}>
                            {l.userId.startsWith('sa:') ? (
                              <span className="text-amber-400">{l.userId}</span>
                            ) : (
                              <span className="text-zinc-400">{l.userId.slice(0, 10)}...</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${actionColor(l.action)}`}>
                              {l.action}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-zinc-500">{l.entityType}</td>
                          <td className="px-4 py-2 text-zinc-600 truncate max-w-[200px]" title={l.entityId}>
                            {l.entityId ? l.entityId.slice(0, 30) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}

        {sortedGroups.length === 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-10 text-center text-zinc-600">
            Aucun événement dans l&apos;historique
          </div>
        )}
      </div>
    </div>
  )
}

const ALL_MISSION_TYPES = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'] as const

interface TradeEntry {
  id: string; tradeKey: string; tradeName: string; tradeDescription: string
  tradeIcon: string; enabledMissionTypes: string[]; vocabulary: Record<string, unknown>
  isBuiltIn: boolean; createdAt: string | null
}

function TradesTab({ tenants, fetchTenants, toast }: { tenants: TenantStats[]; fetchTenants: () => Promise<void>; toast: (_msg: string, _type?: 'success' | 'error' | 'info') => void }) {
  const [allTrades, setAllTrades] = useState<TradeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editTrade, setEditTrade] = useState<TradeEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TradeEntry | null>(null)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    tradeKey: '', tradeName: '', tradeDescription: '', tradeIcon: '',
    driver: 'Chauffeur', drivers: 'Chauffeurs', vehicle: 'Camion', vehicles: 'Camions',
    mission: 'Mission', missions: 'Missions', exutoire: 'Exutoire', exutoires: 'Exutoires',
    depot: 'Dépôt', client: 'Client', tour: 'Tournée', tours: 'Tournées',
    binSize: 'Taille benne', wasteType: 'Type de déchet', optimize: 'Optimiser', collect: 'Collecter',
    enabledTypes: [...ALL_MISSION_TYPES] as string[],
  })

  async function loadTrades() {
    try {
      const r = await fetch('/api/superadmin/trades')
      if (r.ok) { const d = await r.json(); setAllTrades(d.trades) }
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadTrades() }, [])

  function resetForm() {
    setForm({
      tradeKey: '', tradeName: '', tradeDescription: '', tradeIcon: '',
      driver: 'Chauffeur', drivers: 'Chauffeurs', vehicle: 'Camion', vehicles: 'Camions',
      mission: 'Mission', missions: 'Missions', exutoire: 'Exutoire', exutoires: 'Exutoires',
      depot: 'Dépôt', client: 'Client', tour: 'Tournée', tours: 'Tournées',
      binSize: 'Taille benne', wasteType: 'Type de déchet', optimize: 'Optimiser', collect: 'Collecter',
      enabledTypes: [...ALL_MISSION_TYPES] as string[],
    })
  }

  function loadFormFromTrade(t: TradeEntry) {
    const v = t.vocabulary as Record<string, string>
    setForm({
      tradeKey: t.tradeKey, tradeName: t.tradeName, tradeDescription: t.tradeDescription, tradeIcon: t.tradeIcon,
      driver: v.driver ?? 'Chauffeur', drivers: v.drivers ?? 'Chauffeurs',
      vehicle: v.vehicle ?? 'Camion', vehicles: v.vehicles ?? 'Camions',
      mission: v.mission ?? 'Mission', missions: v.missions ?? 'Missions',
      exutoire: v.exutoire ?? 'Exutoire', exutoires: v.exutoires ?? 'Exutoires',
      depot: v.depot ?? 'Dépôt', client: v.client ?? 'Client',
      tour: v.tour ?? 'Tournée', tours: v.tours ?? 'Tournées',
      binSize: v.binSize ?? 'Taille benne', wasteType: v.wasteType ?? 'Type de déchet',
      optimize: v.optimize ?? 'Optimiser', collect: v.collect ?? 'Collecter',
      enabledTypes: [...t.enabledMissionTypes],
    })
  }

  function buildPayload() {
    return {
      tradeKey: form.tradeKey,
      tradeName: form.tradeName,
      tradeDescription: form.tradeDescription,
      tradeIcon: form.tradeIcon || '📋',
      vocabulary: {
        tradeName: form.tradeName, tradeDescription: form.tradeDescription, tradeIcon: form.tradeIcon || '📋',
        driver: form.driver, drivers: form.drivers, vehicle: form.vehicle, vehicles: form.vehicles,
        mission: form.mission, missions: form.missions, exutoire: form.exutoire, exutoires: form.exutoires,
        depot: form.depot, client: form.client, tour: form.tour, tours: form.tours,
        binSize: form.binSize, wasteType: form.wasteType, optimize: form.optimize, collect: form.collect,
        missionTypeLabels: {}, missionTypeIcons: {},
      },
      enabledMissionTypes: form.enabledTypes,
    }
  }

  async function doCreate() {
    setFormError('')
    const r = await fetch('/api/superadmin/trades', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    })
    if (r.ok) { setShowCreate(false); resetForm(); await loadTrades(); toast('Métier créé', 'success') }
    else { const d = await r.json(); setFormError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error)) }
  }

  async function doUpdate() {
    if (!editTrade) return
    setFormError('')
    const payload = buildPayload()
    const r = await fetch(`/api/superadmin/trades/${editTrade.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) { setEditTrade(null); resetForm(); await loadTrades(); toast('Métier modifié', 'success') }
    else { const d = await r.json(); setFormError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error)) }
  }

  async function doDelete() {
    if (!deleteTarget) return
    const r = await fetch(`/api/superadmin/trades/${deleteTarget.id}`, { method: 'DELETE' })
    if (r.ok) { setDeleteTarget(null); await loadTrades(); toast('Métier supprimé', 'success') }
    else { const d = await r.json(); toast(typeof d.error === 'string' ? d.error : 'Erreur', 'error'); setDeleteTarget(null) }
  }

  function toggleType(type: string) {
    setForm(p => ({
      ...p,
      enabledTypes: p.enabledTypes.includes(type)
        ? p.enabledTypes.filter(t => t !== type)
        : [...p.enabledTypes, type],
    }))
  }

  const builtIn = allTrades.filter(t => t.isBuiltIn)
  const custom = allTrades.filter(t => !t.isBuiltIn)

  if (loading) return <div className="text-zinc-500 text-sm animate-pulse py-10 text-center">Chargement des métiers...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">{allTrades.length} métiers ({builtIn.length} intégrés + {custom.length} personnalisés)</h2>
          <p className="text-zinc-600 text-xs mt-1">Les métiers intégrés sont en lecture seule. Vous pouvez créer des métiers personnalisés.</p>
        </div>
        <button type="button" onClick={() => { resetForm(); setShowCreate(true); setFormError('') }}
          className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition">
          + Nouveau métier
        </button>
      </div>

      {}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-800/50 text-zinc-500 text-left uppercase tracking-wider">
            <tr><th className="px-5 py-3">Tenant</th><th className="px-4 py-3">Métier</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3 text-right">Changer</th></tr>
          </thead>
          <tbody>
            {tenants.filter(t => t.slug !== '__platform__').map(t => (
              <TradeRow key={t.id} tenant={t} allTrades={allTrades} onUpdate={async (tradeId) => {
                await fetch(`/api/superadmin/tenants/${t.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trade: tradeId }) })
                await fetchTenants(); toast(`Métier de ${t.name} changé`, 'success')
              }} />
            ))}
          </tbody>
        </table>
      </div>

      {}
      {custom.length > 0 && (
        <>
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Métiers personnalisés</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {custom.map(t => {
              const v = t.vocabulary as Record<string, string>
              return (
                <div key={t.id} className="bg-zinc-900 rounded-xl border border-blue-800/30 p-5 hover:border-blue-700/50 transition">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{t.tradeIcon}</span>
                      <div><div className="font-bold text-sm">{t.tradeName}</div><div className="text-zinc-500 text-[10px] font-mono">{t.tradeKey}</div></div>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => { loadFormFromTrade(t); setEditTrade(t); setFormError('') }}
                        className="px-2 py-1 rounded bg-blue-900/50 text-blue-300 hover:bg-blue-800/50 text-[10px] font-bold transition">Modifier</button>
                      <button type="button" onClick={() => setDeleteTarget(t)}
                        className="px-2 py-1 rounded bg-red-900/50 text-red-400 hover:bg-red-800/50 text-[10px] font-bold transition">Supprimer</button>
                    </div>
                  </div>
                  <p className="text-zinc-400 text-xs mb-2">{t.tradeDescription}</p>
                  <div className="grid grid-cols-2 gap-1 text-[11px] mb-2">
                    <span className="text-zinc-500">Driver :</span><span className="text-zinc-300">{v.driver}</span>
                    <span className="text-zinc-500">Mission :</span><span className="text-zinc-300">{v.mission}</span>
                    <span className="text-zinc-500">Client :</span><span className="text-zinc-300">{v.client}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {t.enabledMissionTypes.map(type => (
                      <span key={type} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[9px] font-mono">{type}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {}
      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Métiers intégrés (lecture seule)</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {builtIn.map(t => {
          const v = t.vocabulary as Record<string, string>
          return (
            <div key={t.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 opacity-80">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{t.tradeIcon}</span>
                <div><div className="font-bold text-sm">{t.tradeName}</div><div className="text-zinc-500 text-[10px] font-mono">{t.tradeKey}</div></div>
              </div>
              <p className="text-zinc-400 text-xs mb-2">{t.tradeDescription}</p>
              <div className="grid grid-cols-2 gap-1 text-[11px] mb-2">
                <span className="text-zinc-500">Driver :</span><span className="text-zinc-300">{v.driver}</span>
                <span className="text-zinc-500">Mission :</span><span className="text-zinc-300">{v.mission}</span>
                <span className="text-zinc-500">Exutoire :</span><span className="text-zinc-300">{v.exutoire}</span>
                <span className="text-zinc-500">Client :</span><span className="text-zinc-300">{v.client}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {t.enabledMissionTypes.map(type => (
                  <span key={type} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[9px] font-mono">{type}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {}
      <FormModal open={showCreate || !!editTrade} title={editTrade ? `Modifier "${editTrade.tradeName}"` : 'Créer un métier personnalisé'}
        onClose={() => { setShowCreate(false); setEditTrade(null) }}
        onSubmit={editTrade ? doUpdate : doCreate}
        submitLabel={editTrade ? 'Enregistrer' : 'Créer'} error={formError}>
        <div className="grid grid-cols-2 gap-3">
          <ModalInput label="Clé unique" value={form.tradeKey} onChange={v => setForm(p => ({ ...p, tradeKey: v.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
            placeholder="ex: transport_medical" />
          <ModalInput label="Nom du métier" value={form.tradeName} onChange={v => setForm(p => ({ ...p, tradeName: v }))} placeholder="ex: Transport Médical" />
        </div>
        <ModalInput label="Description" value={form.tradeDescription} onChange={v => setForm(p => ({ ...p, tradeDescription: v }))} />
        <ModalInput label="Icône (emoji)" value={form.tradeIcon} onChange={v => setForm(p => ({ ...p, tradeIcon: v }))} placeholder="ex: 🏥" />
        <div className="border-t border-zinc-700 pt-3 mt-1">
          <div className="text-xs font-bold text-zinc-400 mb-2">Vocabulaire</div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['driver', 'Singulier driver'], ['drivers', 'Pluriel drivers'],
              ['vehicle', 'Singulier véhicule'], ['vehicles', 'Pluriel véhicules'],
              ['mission', 'Singulier mission'], ['missions', 'Pluriel missions'],
              ['exutoire', 'Singulier exutoire'], ['exutoires', 'Pluriel exutoires'],
              ['depot', 'Dépôt'], ['client', 'Client'], ['tour', 'Tournée'], ['tours', 'Tournées'],
            ] as [string, string][]).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`vocab-${key}`} className="block text-[10px] text-zinc-500 mb-0.5">{label}</label>
                <input id={`vocab-${key}`} value={(form as Record<string, unknown>)[key] as string ?? ''} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  aria-label={label}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:border-red-500 focus:outline-none" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-zinc-700 pt-3 mt-1">
          <div className="text-xs font-bold text-zinc-400 mb-2">Types de missions activés</div>
          <div className="flex flex-wrap gap-2">
            {ALL_MISSION_TYPES.map(type => (
              <button key={type} type="button" onClick={() => toggleType(type)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                  form.enabledTypes.includes(type) ? 'bg-green-900/50 text-green-300 border border-green-700/50' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                }`}>
                {type}
              </button>
            ))}
          </div>
        </div>
      </FormModal>

      {}
      <ConfirmModal open={!!deleteTarget} danger title="Supprimer le métier"
        message={`Supprimer "${deleteTarget?.tradeName}" ? Les tenants utilisant ce métier devront en choisir un autre.`}
        confirmLabel="Supprimer" onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  )
}

function PricingTab() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Grille tarifaire — PATHÉLIX</h2>
        <p className="text-zinc-600 text-xs mt-1">Aide-mémoire interne pour demos et appels commerciaux</p>
      </div>

      {}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {}
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="bg-zinc-800/50 px-6 py-4 border-b border-zinc-700">
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Starter</div>
            <div className="text-2xl font-black mt-1">150 - 250 <span className="text-sm font-medium text-zinc-500">/ mois</span></div>
            <div className="text-xs text-zinc-400 mt-0.5">+ 15 - 25 / chauffeur / mois</div>
          </div>
          <div className="px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">5 a 15 camions</div>
            <div className="space-y-2.5">
              <Feature text="Interface admin (13 onglets)" />
              <Feature text="App Chauffeur PWA hors-ligne" />
              <Feature text="Distances Haversine + tortuosité" />
              <Feature text="Planning jour par jour" />
              <Feature text="Historique des tournées" />
              <Feature text="Support email" />
            </div>
            <div className="mt-5 pt-4 border-t border-zinc-800">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Pas inclus</div>
              <div className="text-xs text-zinc-500 mt-1">Optimisation VRP, routage Valhalla, API, multi-secteurs</div>
            </div>
          </div>
        </div>

        {}
        <div className="bg-zinc-900 rounded-2xl border-2 border-blue-600 overflow-hidden relative">
          <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-black uppercase px-3 py-1 rounded-bl-lg">Populaire</div>
          <div className="bg-blue-950/50 px-6 py-4 border-b border-blue-800/50">
            <div className="text-xs font-bold uppercase tracking-widest text-blue-400">Pro</div>
            <div className="text-2xl font-black mt-1">400 - 600 <span className="text-sm font-medium text-zinc-500">/ mois</span></div>
            <div className="text-xs text-blue-300 mt-0.5">+ 35 - 50 / chauffeur / mois</div>
          </div>
          <div className="px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">15 a 100 camions</div>
            <div className="space-y-2.5">
              <Feature text="Tout le plan Starter" included />
              <Feature text="Algorithme ALNS v5 (6 operateurs)" highlight />
              <Feature text="Valhalla multi-profil (distances réelles + trafic)" highlight />
              <Feature text="Conformité CE 561/2006 automatique" highlight />
              <Feature text="Trafic temps réel directionnel" />
              <Feature text="Multi-objectif (distance/ponctualité)" />
              <Feature text="Planning multi-jours (semaine)" />
              <Feature text="Rapports analytics" />
              <Feature text="Import/Export CSV massif" />
              <Feature text="Support prioritaire" />
            </div>
          </div>
        </div>

        {}
        <div className="bg-zinc-900 rounded-2xl border border-purple-700/50 overflow-hidden">
          <div className="bg-purple-950/30 px-6 py-4 border-b border-purple-800/30">
            <div className="text-xs font-bold uppercase tracking-widest text-purple-400">Enterprise</div>
            <div className="text-2xl font-black mt-1">1 000 - 2 000 <span className="text-sm font-medium text-zinc-500">/ mois</span></div>
            <div className="text-xs text-purple-300 mt-0.5">+ prix chauffeur sur devis</div>
          </div>
          <div className="px-6 py-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">100+ camions</div>
            <div className="space-y-2.5">
              <Feature text="Tout le plan Pro" included />
              <Feature text="Decomposition K-Means (1000+ camions)" highlight />
              <Feature text="API publique + clés API" highlight />
              <Feature text="Webhooks sortants" highlight />
              <Feature text="SSO (SAML/OIDC)" highlight />
              <Feature text="Worker BullMQ dedie (async)" />
              <Feature text="Permissions granulaires (11 niveaux)" />
              <Feature text="Intégrations ERP (SAP, Sage, Nessy)" />
              <Feature text="SLA 99.9% garanti" />
              <Feature text="Support dedie + Account Manager" />
            </div>
          </div>
        </div>
      </div>

      {}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Modules complementaires</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AddOnCard
            name="IA : OCR & Vision"
            price="+ 150"
            period="/ mois"
            features={['Reconnaissance automatique des bons', 'Détection des bennes par camera', 'Extraction de données photo']}
          />
          <AddOnCard
            name="Tracking Client (SMS)"
            price="+ 100"
            period="/ mois"
            features={['SMS de notification au client', 'Lien de suivi Uber-like', 'ETA en temps réel']}
          />
          <AddOnCard
            name="Marque Blanche"
            price="+ 300"
            period="/ mois"
            features={['Logo et couleurs custom', 'Domaine personnalisé (fleet.client.fr)', 'Emails depuis le domaine client']}
          />
        </div>
      </div>

      {}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Frais de mise en service (paiement unique)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm">Setup PME</div>
              <div className="text-zinc-500 text-xs mt-0.5">5 a 15 camions — import données, formation admin, go-live</div>
            </div>
            <div className="text-xl font-black text-right whitespace-nowrap">1 500 - 3 000 &euro;</div>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm">Setup Enterprise</div>
              <div className="text-zinc-500 text-xs mt-0.5">100+ camions — intégration ERP, SSO, migration, formation équipe</div>
            </div>
            <div className="text-xl font-black text-right whitespace-nowrap">5 000 - 10 000 &euro;</div>
          </div>
        </div>
      </div>

      {}
      <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-5 text-xs text-zinc-500 space-y-1">
        <div className="font-bold text-zinc-400 mb-2 uppercase tracking-wider text-[10px]">Notes commerciales</div>
        <p>&bull; Les prix sont HT. TVA applicable selon le pays.</p>
        <p>&bull; Engagement 12 mois minimum. Mensualisation possible a +10%.</p>
        <p>&bull; Reduction -15% sur engagement 24 mois.</p>
        <p>&bull; Le plan Enterprise est personnalisé — contacter pour devis.</p>
        <p>&bull; Les modules add-on sont cumulables sur n&apos;importe quel forfait.</p>
        <p>&bull; Migration depuis un concurrent : setup offert si engagement 24 mois.</p>
      </div>
    </div>
  )
}

function Feature({ text, highlight, included }: { text: string; highlight?: boolean; included?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`mt-0.5 ${highlight ? 'text-blue-400' : included ? 'text-green-500' : 'text-zinc-600'}`}>
        {highlight ? '\u2605' : '\u2713'}
      </span>
      <span className={highlight ? 'text-zinc-200 font-medium' : included ? 'text-zinc-400 italic' : 'text-zinc-400'}>{text}</span>
    </div>
  )
}

function AddOnCard({ name, price, period, features }: { name: string; price: string; period: string; features: string[] }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold text-sm">{name}</span>
        <span className="text-sm font-black">{price} <span className="text-zinc-500 font-medium text-xs">{period}</span></span>
      </div>
      <div className="space-y-1.5">
        {features.map((f, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-zinc-400">
            <span className="text-zinc-600 mt-0.5">{'\u2713'}</span>
            <span>{f}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TradeRow({ tenant, allTrades, onUpdate }: { tenant: TenantStats; allTrades?: { tradeKey: string; tradeName: string; tradeIcon: string }[]; onUpdate: (_tradeId: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [localTrade, setLocalTrade] = useState<string>(tenant.trade ?? '')

  const tradeOptions = allTrades ?? TRADE_IDS.map(id => ({ tradeKey: id, tradeName: TRADES[id].vocabulary.tradeName, tradeIcon: TRADES[id].vocabulary.tradeIcon }))
  const currentName = tradeOptions.find(t => t.tradeKey === tenant.trade)
  const changed = localTrade !== (tenant.trade ?? '')

  return (
    <tr className="border-t border-zinc-800 hover:bg-zinc-800/50 transition">
      <td className="px-5 py-3">
        <div className="font-medium text-sm">{tenant.name}</div>
        <div className="text-zinc-500 font-mono text-[10px]">{tenant.slug}</div>
      </td>
      <td className="px-4 py-3">
        {currentName && !changed ? (
          <span className="text-zinc-300 text-xs">{currentName.tradeIcon} {currentName.tradeName}</span>
        ) : !tenant.trade && !changed ? (
          <span className="text-zinc-600 text-xs italic">Non configuré</span>
        ) : null}
        <select value={localTrade} onChange={e => setLocalTrade(e.target.value)} title="Métier"
          className="bg-zinc-800 text-zinc-100 text-xs border border-zinc-700 rounded-lg px-2 py-1.5 focus:border-red-500 focus:outline-none w-full max-w-[200px] mt-1">
          <option value="" className="bg-zinc-800">-- Choisir --</option>
          {tradeOptions.map(t => (
            <option key={t.tradeKey} value={t.tradeKey} className="bg-zinc-800">{t.tradeIcon} {t.tradeName}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3"><PlanBadge plan={tenant.plan} /></td>
      <td className="px-4 py-3 text-right">
        <button type="button" disabled={!changed || !localTrade || saving} onClick={async () => {
          if (!localTrade || !changed) return; setSaving(true); await onUpdate(localTrade); setSaving(false)
        }}
          className={`px-3 py-1 rounded-lg text-[10px] font-bold transition ${changed && localTrade ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}>
          {saving ? '...' : changed ? 'Appliquer' : 'Actuel'}
        </button>
      </td>
    </tr>
  )
}

export default function SuperAdminPage() {
  const [tab, setTab] = useState<'dashboard' | 'tenants' | 'trades' | 'ml' | 'historique' | 'system' | 'pricing' | 'demos'>('dashboard')
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [tenants, setTenants] = useState<TenantStats[]>([])
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditFilter, setAuditFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState('')

  const [globalSearch, setGlobalSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(globalSearch), 200)
    return () => clearTimeout(t)
  }, [globalSearch])
  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set())
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null)
  const [tenantData, setTenantData] = useState<Record<string, unknown> | null>(null)
  const [tenantDataLoading, setTenantDataLoading] = useState(false)

  const [showNewTenant, setShowNewTenant] = useState(false)
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', plan: 'FREE' })
  const [formError, setFormError] = useState('')

  const { toasts, show: showToast } = useToastLocal()

  const [tenantConfirm, setTenantConfirm] = useState<{ id: string; name: string; action: 'suspend' | 'activate' | 'purge-cache' | 'delete' } | null>(null)
  const [bulkSuspendConfirm, setBulkSuspendConfirm] = useState(false)
  const [bulkPlanModal, setBulkPlanModal] = useState(false)
  const [bulkPlanValue, setBulkPlanValue] = useState('PRO')

  const [editTenantModal, setEditTenantModal] = useState<TenantStats | null>(null)
  const [editTenantForm, setEditTenantForm] = useState({ name: '', slug: '', plan: 'FREE', maxDrivers: '', maxMissions: '', timezone: '', locale: '', contactEmail: '' })

  const fetchStats = useCallback(async () => {
    try { const r = await fetch('/api/superadmin/stats'); if (r.ok) setStats(await r.json()) } catch {  }
  }, [])
  const fetchTenants = useCallback(async () => {
    try { const r = await fetch('/api/superadmin/tenants'); if (r.ok) setTenants(await r.json()) } catch {  }
  }, [])
  const fetchHealth = useCallback(async () => {
    try { const r = await fetch('/api/superadmin/system-health'); if (r.ok) setHealth(await r.json()) } catch {  }
  }, [])
  const fetchAuditLogs = useCallback(async (tenantId?: string) => {
    try {
      const params = new URLSearchParams({ limit: '300' })
      if (tenantId) params.set('tenantId', tenantId)
      const r = await fetch(`/api/superadmin/audit-logs?${params}`)
      if (r.ok) { const d = await r.json(); setAuditLogs(d.logs); setAuditTotal(d.total) }
    } catch {  }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchStats(), fetchTenants(), fetchHealth(), fetchAuditLogs()])
      .finally(() => setLoading(false))
  }, [fetchStats, fetchTenants, fetchHealth, fetchAuditLogs])

  useEffect(() => {
    if (tab !== 'system') return
    const id = setInterval(fetchHealth, 15_000)
    return () => clearInterval(id)
  }, [tab, fetchHealth])

  useEffect(() => {
    if (tab !== 'dashboard') return
    const id = setInterval(() => { void fetchStats() }, 30_000)
    return () => clearInterval(id)
  }, [tab, fetchStats])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('input[placeholder*="Rechercher"]')
        input?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function toggleTenantDetail(tenantId: string) {
    if (expandedTenant === tenantId) { setExpandedTenant(null); setTenantData(null); return }
    setExpandedTenant(tenantId)
    setTenantData(null)
    setTenantDataLoading(true)
    try {
      const r = await fetch(`/api/superadmin/tenants/${tenantId}/data`)
      if (r.ok) setTenantData(await r.json())
    } finally { setTenantDataLoading(false) }
  }

  async function exportTenantData(tenantId: string, tenantName: string) {
    const r = await fetch(`/api/superadmin/tenants/${tenantId}/data`)
    if (!r.ok) return
    const data = await r.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${tenantName.replace(/\s+/g, '-').toLowerCase()}-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  async function createTenant() {
    setFormError('')
    const r = await fetch('/api/superadmin/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTenant) })
    if (r.ok) { setShowNewTenant(false); setNewTenant({ name: '', slug: '', plan: 'FREE' }); await fetchTenants(); await fetchStats(); showToast('Tenant créé', 'success') }
    else { const d = await r.json(); setFormError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error)) }
  }

  function requestTenantAction(id: string, action: 'suspend' | 'activate' | 'purge-cache' | 'delete', name: string) {
    if (action === 'activate' || action === 'purge-cache') {
      void doTenantAction(id, action, name)
    } else {
      setTenantConfirm({ id, name, action })
    }
  }

  async function doTenantAction(id: string, action: 'suspend' | 'activate' | 'purge-cache' | 'delete', name: string) {
    setTenantConfirm(null)
    setActionLoading(`${id}:${action}`)
    try {
      const url = action === 'delete' ? `/api/superadmin/tenants/${id}` : `/api/superadmin/tenants/${id}/${action}`
      const method = action === 'delete' ? 'DELETE' : 'POST'
      await fetch(url, { method })
      await fetchTenants(); await fetchStats()
      const labels = { suspend: 'suspendu', activate: 'activé', 'purge-cache': 'cache vidé', delete: 'supprimé' }
      showToast(`${name} ${labels[action]}`, action === 'delete' ? 'error' : 'success')
    } finally { setActionLoading('') }
  }

  async function doEditTenant() {
    if (!editTenantModal) return
    const payload: Record<string, unknown> = { name: editTenantForm.name, slug: editTenantForm.slug, plan: editTenantForm.plan }
    if (editTenantForm.maxDrivers) payload.maxDrivers = parseInt(editTenantForm.maxDrivers, 10) || null
    if (editTenantForm.maxMissions) payload.maxMissions = parseInt(editTenantForm.maxMissions, 10) || null
    if (editTenantForm.timezone) payload.timezone = editTenantForm.timezone
    if (editTenantForm.locale) payload.locale = editTenantForm.locale
    if (editTenantForm.contactEmail !== undefined) payload.contactEmail = editTenantForm.contactEmail
    await fetch(`/api/superadmin/tenants/${editTenantModal.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    showToast('Tenant modifié', 'success')
    setEditTenantModal(null); await fetchTenants()
  }

  async function impersonate(tenantId: string) {
    setActionLoading(`${tenantId}:impersonate`)
    try {
      const r = await fetch('/api/superadmin/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId }) })
      if (r.ok) {
        const d = await r.json()
        // Clear any planning data cached from a previous session/impersonation before entering
        // this tenant's context — plans/startTimes/etc are keyed by driverId, not tenantId, so
        // stale entries from a different tenant would otherwise linger in IndexedDB.
        await usePlanningStore.persist.clearStorage()
        window.location.href = d.redirectTo
      }
    } finally { setActionLoading('') }
  }

  async function updatePlan(id: string, plan: string) {
    await fetch(`/api/superadmin/tenants/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) })
    await fetchTenants(); showToast('Plan modifié', 'success')
  }

  const tabs = [
    { key: 'dashboard' as const, label: 'Dashboard', icon: '\u{1F4CA}' },
    { key: 'tenants' as const, label: 'Tenants', icon: '\u{1F3E2}' },
    { key: 'trades' as const, label: 'Métiers', icon: '\u{1F527}' },
    { key: 'ml' as const, label: 'ML / Calibration', icon: '\u{1F9E0}' },
    { key: 'historique' as const, label: 'Historique', icon: '\u{1F4DC}' },
    { key: 'system' as const, label: 'Système', icon: '\u{1F6E0}' },
    { key: 'pricing' as const, label: 'Prix & Forfaits', icon: '\u{1F4B0}' },
    { key: 'demos' as const, label: 'Demandes de démo', icon: '\u{1F4E8}' },
  ]

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
        <div className="relative z-[1] text-zinc-400 animate-pulse">Chargement du panneau superadmin...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {}
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src={BRAND_LOGO_SRC} alt="PATHÉLIX" width={32} height={32} className="w-8 h-8 rounded-lg object-contain" />
            <div>
              <h1 className="text-sm font-bold tracking-tight">PATHÉLIX <span className="text-red-500">Platform</span></h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Super Admin Console</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input type="text" placeholder="Rechercher...  Ctrl+K" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
                title={tab !== 'tenants' ? 'La recherche ne filtre que l\'onglet Tenants' : undefined}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs w-56 focus:border-red-500 focus:outline-none placeholder-zinc-600 pr-8" />
              {globalSearch && (
                <button type="button" onClick={() => setGlobalSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs">&times;</button>
              )}
              {globalSearch && tab !== 'tenants' && (
                <div className="absolute top-full left-0 mt-1 text-[10px] text-amber-400 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 whitespace-nowrap z-10">
                  Filtre uniquement l&apos;onglet Tenants
                </div>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono hidden lg:block">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <button type="button" onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              await usePlanningStore.persist.clearStorage()
              window.location.href = '/login'
            }}
              className="text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition hover:border-zinc-500">Déconnexion</button>
          </div>
        </div>
      </header>

      {}
      <nav className="bg-zinc-900/50 border-b border-zinc-800 px-6">
        <div className="max-w-screen-2xl mx-auto flex gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-xs font-medium border-b-2 transition ${tab === t.key ? 'border-red-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="relative z-[1] max-w-screen-2xl mx-auto px-6 py-6">

        {}
        {tab === 'dashboard' && stats && (
          <div className="space-y-6">
            {}
            {stats.suspendedTenants > 0 && (
              <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl px-5 py-3 flex items-center gap-3">
                <span className="text-amber-400 text-lg">&#9888;</span>
                <span className="text-amber-200 text-sm font-medium">{stats.suspendedTenants} tenant{stats.suspendedTenants > 1 ? 's' : ''} suspendu{stats.suspendedTenants > 1 ? 's' : ''}</span>
                <button type="button" onClick={() => setTab('tenants')} className="ml-auto text-xs text-amber-400 underline">Voir</button>
              </div>
            )}

            {}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Tenants" value={stats.global.totalTenants} sub={`${stats.suspendedTenants} suspendu${stats.suspendedTenants > 1 ? 's' : ''}`} />
              <StatCard label="Utilisateurs" value={stats.global.totalUsers} sub={`+${stats.recent.newUsers7d} / 7j`} trend={stats.recent.newUsers7d > 0 ? 'up' : 'neutral'} />
              <StatCard label="Chauffeurs" value={stats.global.totalDrivers} />
              <StatCard label="Missions" value={stats.global.totalMissions} sub={`${stats.recent.missions30d} / 30j`} trend={stats.recent.missions30d > 0 ? 'up' : 'neutral'} />
              <StatCard label="Véhicules" value={stats.global.totalVehicles} />
              <StatCard label="Optimisations" value={stats.global.totalPlans} sub={`${stats.recent.plans30d} / 30j`} trend={stats.recent.plans30d > 0 ? 'up' : 'neutral'} />
            </div>

            {}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Clients" value={stats.totalClients} />
              <StatCard label="Sites" value={stats.totalSites} />
              <StatCard label="Exutoires" value={stats.totalExutoires} />
            </div>

            {}
            {stats.dailyActivity && stats.dailyActivity.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">Activité 14 derniers jours</h3>
                <div className="flex items-end gap-1 h-32">
                  {stats.dailyActivity.map(day => {
                    const maxVal = Math.max(1, ...stats.dailyActivity.map(d => d.missions + d.plans))
                    const mHeight = (day.missions / maxVal) * 100
                    const pHeight = (day.plans / maxVal) * 100
                    const dateLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                    return (
                      <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${dateLabel}: ${day.missions} missions, ${day.plans} plans`}>
                        <div className="w-full flex flex-col justify-end h-24 gap-px">
                          <div className="bg-blue-500 rounded-t-sm transition-all" style={{ height: `${Math.max(1, mHeight)}%` }} />
                          <div className="bg-purple-500 rounded-t-sm transition-all" style={{ height: `${Math.max(0, pHeight)}%` }} />
                        </div>
                        <span className="text-[8px] text-zinc-600 group-hover:text-zinc-400 transition">{dateLabel}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-sm inline-block" /> Missions</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500 rounded-sm inline-block" /> Optimisations</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">Répartition par plan</h3>
                <div className="space-y-3">
                  {Object.entries(stats.tenantsByPlan).map(([plan, count]) => (
                    <div key={plan} className="flex items-center gap-3">
                      <PlanBadge plan={plan} />
                      <div className="flex-1 bg-zinc-800 rounded-full h-2">
                        <div className={`h-2 rounded-full ${plan === 'ENTERPRISE' ? 'bg-purple-500' : plan === 'PRO' ? 'bg-blue-500' : 'bg-zinc-600'}`}
                          style={{ width: `${Math.max(5, (count / Math.max(1, stats.global.totalTenants)) * 100)}%` }} />
                      </div>
                      <span className="text-sm font-bold w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">Top 10 tenants (missions 30j)</h3>
                <div className="space-y-2">
                  {stats.topTenants.map((t, i) => (
                    <div key={t.tenantId} className="flex items-center gap-3 text-sm">
                      <span className="text-zinc-600 w-5 text-right font-mono">{i + 1}</span>
                      <span className="flex-1 font-medium truncate">{t.name ?? t.tenantId}</span>
                      {t.plan && <PlanBadge plan={t.plan} />}
                      <span className="font-bold font-mono">{t.missions30d}</span>
                    </div>
                  ))}
                  {stats.topTenants.length === 0 && <div className="text-zinc-600 text-xs">Aucune activité récente</div>}
                </div>
              </div>
            </div>

            {}
            {stats.recentAudit && stats.recentAudit.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Derniers événements</h3>
                  <button type="button" onClick={() => setTab('historique')} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">Tout voir</button>
                </div>
                <div className="space-y-1.5">
                  {stats.recentAudit.map(a => (
                    <div key={a.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-zinc-800/50 last:border-0">
                      <span className="text-zinc-500 font-mono w-28 shrink-0">{new Date(a.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-zinc-400 w-32 truncate shrink-0">{a.tenantName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                        a.action.includes('delete') || a.action.includes('suspend') ? 'bg-red-900/40 text-red-400' :
                        a.action.includes('create') || a.action.includes('activate') ? 'bg-green-900/40 text-green-400' :
                        a.action.includes('superadmin') ? 'bg-amber-900/40 text-amber-400' :
                        'bg-zinc-700/40 text-zinc-400'
                      }`}>{a.action}</span>
                      <span className="text-zinc-500 truncate flex-1">{a.entityType} {a.entityId ? `#${a.entityId.slice(0, 8)}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {}
        {tab === 'tenants' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">{tenants.length} tenant{tenants.length > 1 ? 's' : ''}</h2>
              {}
              {selectedTenants.size > 0 && (
                <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5 border border-zinc-700">
                  <span className="text-[10px] text-zinc-400">{selectedTenants.size} sélectionné{selectedTenants.size > 1 ? 's' : ''}</span>
                  <button type="button" onClick={() => setBulkSuspendConfirm(true)}
                    className="text-[10px] text-amber-400 font-bold hover:text-amber-300">Suspendre tous</button>
                  <button type="button" onClick={async () => {
                    for (const id of selectedTenants) await fetch(`/api/superadmin/tenants/${id}/activate`, { method: 'POST' })
                    setSelectedTenants(new Set()); await fetchTenants(); showToast('Tenants activés', 'success')
                  }} className="text-[10px] text-green-400 font-bold hover:text-green-300">Activer tous</button>
                  <button type="button" onClick={() => setBulkPlanModal(true)}
                    className="text-[10px] text-blue-400 font-bold hover:text-blue-300">Changer plan</button>
                  <button type="button" onClick={() => setSelectedTenants(new Set())} className="text-[10px] text-zinc-500">Désélectionner</button>
                </div>
              )}
              <button onClick={() => setShowNewTenant(!showNewTenant)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition ml-auto">
                + Nouveau tenant
              </button>
            </div>

            {showNewTenant && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-3">
                {formError && <div className="text-red-400 text-xs bg-red-900/30 px-3 py-2 rounded-lg">{formError}</div>}
                <div className="grid grid-cols-3 gap-3">
                  <input placeholder="Nom (ex: PATHÉLIX Lyon)" value={newTenant.name}
                    onChange={e => setNewTenant(p => ({ ...p, name: e.target.value }))}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
                  <input placeholder="Slug (ex: pathelix-lyon)" value={newTenant.slug}
                    onChange={e => setNewTenant(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
                  <select value={newTenant.plan} onChange={e => setNewTenant(p => ({ ...p, plan: e.target.value }))} title="Plan"
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none">
                    {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value} className="bg-zinc-800 text-zinc-100">{p.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={createTenant} className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-green-700">Créer</button>
                  <button onClick={() => setShowNewTenant(false)} className="text-zinc-500 px-4 py-2 text-xs hover:text-zinc-300">Annuler</button>
                </div>
              </div>
            )}

            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/50 text-zinc-500 text-left uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-3 w-8">
                      {(() => {
                        // The platform tenant (__platform__) must never be bulk-selectable —
                        // a "select all" + "Suspendre tous" would otherwise suspend the
                        // platform's own tenant along with real ones. Confirmed as a real risk
                        // during manual QA, not just a caution note: this table's rows were
                        // never filtered to exclude it, unlike the two other tenant listings
                        // elsewhere in this file (see the .filter(t => t.slug !== '__platform__')
                        // above, in the dashboard/stats views).
                        const selectableTenants = tenants.filter(t => t.slug !== '__platform__')
                        return (
                          <input type="checkbox" title="Tout sélectionner"
                            checked={selectedTenants.size === selectableTenants.length && selectableTenants.length > 0}
                            onChange={e => setSelectedTenants(e.target.checked ? new Set(selectableTenants.map(t => t.id)) : new Set())}
                            className="accent-red-500" />
                        )
                      })()}
                    </th>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-center">Users</th>
                    <th className="px-4 py-3 text-center">Drivers</th>
                    <th className="px-4 py-3 text-center">Missions</th>
                    <th className="px-4 py-3">Créé le</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.filter(t => {
                    if (!debouncedSearch) return true
                    const q = debouncedSearch.toLowerCase()
                    return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
                  }).map(t => (<Fragment key={t.id}>
                    <tr className={`border-t border-zinc-800 hover:bg-zinc-800/50 transition cursor-pointer ${expandedTenant === t.id ? 'bg-zinc-800/70' : ''}`}
                      onClick={() => toggleTenantDetail(t.id)}>
                      <td className="px-2 py-3 w-8" onClick={e => e.stopPropagation()}>
                        {t.slug === '__platform__' ? (
                          <input type="checkbox" disabled title="Le tenant plateforme ne peut pas être sélectionné pour une action groupée" className="accent-red-500 opacity-30 cursor-not-allowed" />
                        ) : (
                          <input type="checkbox" title={`Selectionner ${t.name}`}
                            checked={selectedTenants.has(t.id)}
                            onChange={e => setSelectedTenants(prev => {
                              const n = new Set(prev); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n
                            })}
                            className="accent-red-500" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] transition-transform ${expandedTenant === t.id ? 'rotate-90' : ''}`}>&#9654;</span>
                          <div>
                            <div className="font-medium text-sm">{t.name}</div>
                            <div className="text-zinc-500 font-mono text-[10px]">{t.slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <select value={t.plan} onChange={e => updatePlan(t.id, e.target.value)} title="Plan"
                          className="bg-zinc-800 text-zinc-100 text-[10px] border border-zinc-700 rounded px-1.5 py-0.5 focus:border-red-500 focus:outline-none">
                          {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value} className="bg-zinc-800 text-zinc-100">{p.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {t.suspendedAt ? <SuspendedBadge /> : <span className="text-green-400 text-[10px] font-bold uppercase">Actif</span>}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">{t.stats.users}</td>
                      <td className="px-4 py-3 text-center font-mono">{t.stats.drivers}</td>
                      <td className="px-4 py-3 text-center font-mono">{t.stats.missions}</td>
                      <td className="px-4 py-3 text-zinc-500">{new Date(t.createdAt).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => { setEditTenantModal(t); setEditTenantForm({ name: t.name, slug: t.slug, plan: t.plan, maxDrivers: t.maxDrivers ? String(t.maxDrivers) : '', maxMissions: t.maxMissions ? String(t.maxMissions) : '', timezone: '', locale: '', contactEmail: '' }) }}
                            className="px-2 py-1 rounded bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50 text-[10px] font-bold transition" title="Modifier le tenant">Modifier</button>
                          <button type="button" onClick={() => impersonate(t.id)} disabled={actionLoading === `${t.id}:impersonate`}
                            className="px-2 py-1 rounded bg-blue-900/50 text-blue-300 hover:bg-blue-800/50 text-[10px] font-bold transition" title="Se connecter en tant qu'admin">
                            {actionLoading === `${t.id}:impersonate` ? '...' : 'Entrer'}
                          </button>
                          {t.suspendedAt ? (
                            <button type="button" onClick={() => requestTenantAction(t.id, 'activate', t.name)} disabled={actionLoading === `${t.id}:activate`}
                              className="px-2 py-1 rounded bg-green-900/50 text-green-300 hover:bg-green-800/50 text-[10px] font-bold transition">Activer</button>
                          ) : (
                            <button type="button" onClick={() => requestTenantAction(t.id, 'suspend', t.name)} disabled={actionLoading === `${t.id}:suspend`}
                              className="px-2 py-1 rounded bg-amber-900/50 text-amber-300 hover:bg-amber-800/50 text-[10px] font-bold transition">Suspendre</button>
                          )}
                          <button type="button" onClick={() => requestTenantAction(t.id, 'purge-cache', t.name)} disabled={actionLoading === `${t.id}:purge-cache`}
                            className="px-2 py-1 rounded bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50 text-[10px] font-bold transition" title="Vider le cache Redis">Cache</button>
                          <button type="button" onClick={() => exportTenantData(t.id, t.name)}
                            className="px-2 py-1 rounded bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50 text-[10px] font-bold transition" title="Exporter JSON">Export</button>
                          <button type="button" onClick={() => requestTenantAction(t.id, 'delete', t.name)}
                            className="px-2 py-1 rounded bg-red-900/50 text-red-400 hover:bg-red-800/50 text-[10px] font-bold transition" title="Supprimer définitivement">Purger</button>
                        </div>
                      </td>
                    </tr>
                    {}
                    {expandedTenant === t.id && (
                      <tr>
                        <td colSpan={10} className="bg-zinc-800/30 px-6 py-4">
                          {tenantDataLoading ? (
                            <div className="text-zinc-500 text-xs animate-pulse py-4 text-center">Chargement des données...</div>
                          ) : tenantData ? (
                            <TenantDetailPanel data={tenantData} tenantName={t.name} tenantId={t.id} toast={showToast} onRefresh={async () => {
                              const r = await fetch(`/api/superadmin/tenants/${t.id}/data`)
                              if (r.ok) setTenantData(await r.json())
                              await fetchTenants()
                            }} />
                          ) : (
                            <div className="text-zinc-600 text-xs py-4 text-center">Impossible de charger les données</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {}
        {tab === 'historique' && (
          <AuditHistoryTab
            logs={auditLogs}
            total={auditTotal}
            tenants={tenants}
            filter={auditFilter}
            onFilterChange={(tid) => { setAuditFilter(tid); fetchAuditLogs(tid || undefined) }}
          />
        )}

        {}
        {tab === 'ml' && <MLCalibrationTab />}

        {}
        {tab === 'system' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Telemetrie Système</h2>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-zinc-600 font-mono">Rafraichi toutes les 15s</span>
                <button onClick={fetchHealth} className="text-xs text-zinc-400 border border-zinc-700 px-3 py-1 rounded hover:border-zinc-500 transition">Rafraîchir</button>
              </div>
            </div>

            {health ? (
              <>
                {}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <StatusDot status={health.database.status} />
                      <span className="text-xs font-bold uppercase text-zinc-400">PostgreSQL</span>
                    </div>
                    <div className="text-xl font-bold">{health.database.status === 'ok' ? `${health.database.responseTimeMs}ms` : 'Erreur'}</div>
                    <div className="text-[10px] text-zinc-500">Latence requête</div>
                  </div>

                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <StatusDot status={health.redis.status} />
                      <span className="text-xs font-bold uppercase text-zinc-400">Redis</span>
                    </div>
                    <div className="text-xl font-bold">{health.redis.memoryUsed ?? 'N/A'}</div>
                    <div className="text-[10px] text-zinc-500">{health.redis.totalKeys ?? 0} cles / {health.redis.connectedClients ?? 0} clients</div>
                  </div>

                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <StatusDot status={health.routing.status} />
                      <span className="text-xs font-bold uppercase text-zinc-400">{(health.routing.engine ?? 'Routage').toUpperCase()}</span>
                    </div>
                    <div className="text-xl font-bold">
                      {health.routing.status === 'ok' ? 'OK'
                        : health.routing.status === 'haversine_only' ? 'Haversine'
                        : health.routing.status === 'not_configured' ? 'Off'
                        : 'Erreur'}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">{health.routing.url ?? health.routing.note ?? 'Non configuré'}</div>
                  </div>

                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-xs font-bold uppercase text-zinc-400">Uptime</span>
                    </div>
                    <div className="text-xl font-bold">{health.uptime.formatted}</div>
                    <div className="text-[10px] text-zinc-500">Node {health.node.version}</div>
                  </div>
                </div>

                {}
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <StatusDot status={health.queue.status} />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">File d&apos;attente VRP (BullMQ)</h3>
                  </div>
                  {health.queue.status === 'connected' ? (
                    <div className="grid grid-cols-5 gap-4">
                      <div>
                        <div className={`text-3xl font-bold font-mono ${(health.queue.waiting ?? 0) > 5 ? 'text-amber-400' : 'text-white'}`}>
                          {health.queue.waiting ?? 0}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase mt-1">En attente</div>
                      </div>
                      <div>
                        <div className={`text-3xl font-bold font-mono ${(health.queue.active ?? 0) > 0 ? 'text-blue-400' : 'text-white'}`}>
                          {health.queue.active ?? 0}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase mt-1">Actifs</div>
                      </div>
                      <div>
                        <div className="text-3xl font-bold font-mono text-green-400">{health.queue.completed ?? 0}</div>
                        <div className="text-[10px] text-zinc-500 uppercase mt-1">Terminés</div>
                      </div>
                      <div>
                        <div className={`text-3xl font-bold font-mono ${(health.queue.failed ?? 0) > 0 ? 'text-red-400' : 'text-white'}`}>
                          {health.queue.failed ?? 0}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase mt-1">Echoues</div>
                      </div>
                      <div>
                        <div className="text-3xl font-bold font-mono text-zinc-400">{health.queue.delayed ?? 0}</div>
                        <div className="text-[10px] text-zinc-500 uppercase mt-1">Differes</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-zinc-600 text-sm">Queue non disponible (Redis requis)</div>
                  )}
                </div>

                {}
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">Mémoire Node.js</h3>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-2xl font-bold font-mono">{health.memory.heapUsedMb} <span className="text-sm text-zinc-500">MB</span></div>
                      <div className="text-[10px] text-zinc-500 uppercase mt-1">Heap utilise</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold font-mono">{health.memory.heapTotalMb} <span className="text-sm text-zinc-500">MB</span></div>
                      <div className="text-[10px] text-zinc-500 uppercase mt-1">Heap total</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold font-mono">{health.memory.rssMb} <span className="text-sm text-zinc-500">MB</span></div>
                      <div className="text-[10px] text-zinc-500 uppercase mt-1">RSS</div>
                    </div>
                    <div>
                      <div className={`text-2xl font-bold font-mono ${health.memory.usagePercent > 80 ? 'text-red-400' : health.memory.usagePercent > 60 ? 'text-amber-400' : 'text-green-400'}`}>
                        {health.memory.usagePercent}%
                      </div>
                      <div className="text-[10px] text-zinc-500 uppercase mt-1">Usage</div>
                      <div className="mt-2 bg-zinc-800 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${health.memory.usagePercent > 80 ? 'bg-red-500' : health.memory.usagePercent > 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                          style={{ width: `${health.memory.usagePercent}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-zinc-600 text-sm">Impossible de charger les données système</div>
            )}
          </div>
        )}

        {}
        {tab === 'trades' && <TradesTab tenants={tenants} fetchTenants={fetchTenants} toast={showToast} />}

        {}
        {tab === 'pricing' && <PricingTab />}

        {tab === 'demos' && <DemoRequestsPanel />}
      </main>

      {}
      <ToastContainer toasts={toasts} />

      {}
      <ConfirmModal open={!!tenantConfirm} danger
        title={tenantConfirm?.action === 'delete' ? 'Supprimer le tenant' : 'Suspendre le tenant'}
        message={tenantConfirm?.action === 'delete'
          ? `Supprimer "${tenantConfirm?.name}" et TOUTES ses données ? Cette action est irréversible.`
          : `Suspendre "${tenantConfirm?.name}" ? Tous ses utilisateurs seront bloqués.`}
        confirmLabel={tenantConfirm?.action === 'delete' ? 'Supprimer définitivement' : 'Suspendre'}
        onConfirm={() => tenantConfirm && doTenantAction(tenantConfirm.id, tenantConfirm.action, tenantConfirm.name)}
        onCancel={() => setTenantConfirm(null)} />

      {}
      <ConfirmModal open={bulkSuspendConfirm} danger
        title="Suspension en masse"
        message={`Suspendre ${selectedTenants.size} tenant(s) ? Tous leurs utilisateurs seront bloqués.`}
        confirmLabel="Suspendre tous"
        onConfirm={async () => {
          setBulkSuspendConfirm(false)
          for (const id of selectedTenants) await fetch(`/api/superadmin/tenants/${id}/suspend`, { method: 'POST' })
          setSelectedTenants(new Set()); await fetchTenants(); showToast('Tenants suspendus', 'success')
        }}
        onCancel={() => setBulkSuspendConfirm(false)} />

      {}
      <ConfirmModal open={bulkPlanModal}
        title="Changer le plan en masse"
        message={`Appliquer le plan à ${selectedTenants.size} tenant(s) :`}
        confirmLabel="Appliquer"
        onConfirm={async () => {
          setBulkPlanModal(false)
          for (const id of selectedTenants) await fetch(`/api/superadmin/tenants/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: bulkPlanValue }) })
          setSelectedTenants(new Set()); await fetchTenants(); showToast('Plans modifiés', 'success')
        }}
        onCancel={() => setBulkPlanModal(false)}>
        <select value={bulkPlanValue} onChange={e => setBulkPlanValue(e.target.value)} title="Plan"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none mt-2">
          {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value} className="bg-zinc-800">{p.label}</option>)}
        </select>
      </ConfirmModal>

      {}
      <FormModal open={!!editTenantModal} title={`Modifier ${editTenantModal?.name ?? ''}`}
        onClose={() => setEditTenantModal(null)} onSubmit={doEditTenant} submitLabel="Enregistrer">
        <ModalInput label="Nom" value={editTenantForm.name} onChange={v => setEditTenantForm(p => ({ ...p, name: v }))} placeholder="Nom de l'entreprise" />
        <ModalInput label="Slug" value={editTenantForm.slug} onChange={v => setEditTenantForm(p => ({ ...p, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="slug-unique" />
        <ModalSelect label="Plan" value={editTenantForm.plan} onChange={v => setEditTenantForm(p => ({ ...p, plan: v }))}
          options={PLAN_OPTIONS} />
        <div className="grid grid-cols-2 gap-3">
          <ModalInput label="Max chauffeurs (vide = illimité)" value={editTenantForm.maxDrivers} onChange={v => setEditTenantForm(p => ({ ...p, maxDrivers: v.replace(/\D/g, '') }))} placeholder="Illimité" />
          <ModalInput label="Max missions (vide = illimité)" value={editTenantForm.maxMissions} onChange={v => setEditTenantForm(p => ({ ...p, maxMissions: v.replace(/\D/g, '') }))} placeholder="Illimité" />
        </div>
        <ModalInput label="Email de contact" value={editTenantForm.contactEmail} onChange={v => setEditTenantForm(p => ({ ...p, contactEmail: v }))} placeholder="contact@entreprise.fr" type="email" />
        <div className="grid grid-cols-2 gap-3">
          <ModalInput label="Fuseau horaire" value={editTenantForm.timezone} onChange={v => setEditTenantForm(p => ({ ...p, timezone: v }))} placeholder="Europe/Paris" />
          <ModalInput label="Locale" value={editTenantForm.locale} onChange={v => setEditTenantForm(p => ({ ...p, locale: v }))} placeholder="fr-FR" />
        </div>
      </FormModal>
    </div>
  )
}

interface MLTenantStatus {
  tenantId: string
  tenantName: string
  tenantSlug: string
  tenantPlan: string
  metrics: { total: number; reliable: number; rejected: number; rejectionRate: number }
  maturity: { pct: number; label: string; threshold: number }
  profile: { coefficientCount: number; lastComputedAt: string | null }
}

function MLCalibrationTab() {
  const [data, setData] = useState<MLTenantStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/superadmin/ml-status')
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-zinc-400 animate-pulse py-12 text-center">Chargement des données ML...</div>
  }

  const totalReliable = data.reduce((s, t) => s + t.metrics.reliable, 0)
  const totalRejected = data.reduce((s, t) => s + t.metrics.rejected, 0)
  const calibratedCount = data.filter(t => t.maturity.pct >= 100).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Calibration ML par tenant</h2>
        <span className="text-xs text-zinc-600">{calibratedCount}/{data.length} tenants calibrés</span>
      </div>

      {}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Métriques fiables', value: totalReliable.toLocaleString('fr-FR'), color: 'text-emerald-400' },
          { label: 'Rejetées (aberrantes)', value: totalRejected.toLocaleString('fr-FR'), color: 'text-red-400' },
          { label: 'Taux de rejet global', value: `${totalReliable + totalRejected > 0 ? Math.round((totalRejected / (totalReliable + totalRejected)) * 100) : 0}%`, color: 'text-amber-400' },
          { label: 'Tenants 100%', value: `${calibratedCount} / ${data.length}`, color: 'text-blue-400' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-zinc-500 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase">
              <th className="text-left px-4 py-3">Tenant</th>
              <th className="text-left px-4 py-3">Plan</th>
              <th className="text-right px-4 py-3">Fiables</th>
              <th className="text-right px-4 py-3">Rejetées</th>
              <th className="px-4 py-3">Maturité</th>
              <th className="text-right px-4 py-3">Coefficients</th>
              <th className="text-right px-4 py-3">Dernier calcul ML</th>
            </tr>
          </thead>
          <tbody>
            {data.sort((a, b) => b.maturity.pct - a.maturity.pct).map(tenant => (
              <tr key={tenant.tenantId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-200">{tenant.tenantName}</div>
                  <div className="text-xs text-zinc-600">{tenant.tenantSlug}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    tenant.tenantPlan === 'ENTERPRISE' ? 'bg-purple-900/50 text-purple-300' :
                    tenant.tenantPlan === 'PRO' ? 'bg-blue-900/50 text-blue-300' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>{tenant.tenantPlan}</span>
                </td>
                <td className="px-4 py-3 text-right text-emerald-400 font-mono">{tenant.metrics.reliable}</td>
                <td className="px-4 py-3 text-right text-red-400 font-mono">{tenant.metrics.rejected}</td>
                <td className="px-4 py-3">
                  <MLMaturityBar pct={tenant.maturity.pct} label={tenant.maturity.label} threshold={tenant.maturity.threshold} reliable={tenant.metrics.reliable} />
                </td>
                <td className="px-4 py-3 text-right text-zinc-300 font-mono">{tenant.profile.coefficientCount}</td>
                <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                  {tenant.profile.lastComputedAt
                    ? new Date(tenant.profile.lastComputedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && (
          <div className="text-center text-zinc-600 py-12">Aucune donnée ML collectee</div>
        )}
      </div>
    </div>
  )
}

function MLMaturityBar({ pct, label, threshold, reliable }: { pct: number; label: string; threshold: number; reliable: number }) {
  const barColor =
    pct >= 100 ? 'bg-emerald-500' :
    pct >= 70  ? 'bg-blue-500' :
    pct >= 30  ? 'bg-amber-500' :
    pct > 0    ? 'bg-orange-500' :
                 'bg-zinc-700'

  return (
    <div className="w-full min-w-[160px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-xs font-mono text-zinc-500">{reliable}/{threshold}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}
