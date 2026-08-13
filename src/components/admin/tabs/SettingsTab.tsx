'use client'

import { useState, useEffect, useRef } from 'react'
import { usePlanningStore } from '@/stores/planningStore'
import { IntegrationsPanel } from '../IntegrationsPanel'
import { TRADES, TRADE_IDS, type TradeId } from '@/lib/trades'
import { useTrade } from '@/providers/TradeProvider'
import { useToast } from '@/components/ui/Toast'
import { JargonTip } from '@/components/ui/Tooltip'
import { cachedFetch, invalidateClientCache } from '@/lib/clientCache'
import type { SettingsApiResponse } from '@/lib/types'

interface OptimizationSettings {
  defaultSpeedKmh: number
  defaultStartTime: string
  maxDayDurationMin: number
  breakAfterMin: number
  breakDurationMin: number
  costPerKm: number
  fuelCostPerL: number
  consumptionLPer100Km: number
  valhallaFactor: number
}

interface BrandingSettings {
  primaryColor: string
  companyDisplayName: string
  logoUrl: string
}

interface LocalisationSettings {
  timezone: string
  locale: string
}

interface NotificationSettings {
  notificationsEnabled: boolean
  smsEnabled: boolean
  emailEnabled: boolean
}

interface BillingSettings {
  invoicePrefix: string
  vatNumber: string
  billingEmail: string
  supportEmail: string
}

interface QuotaSettings {
  maxOptimizationsPerDay: number
}

interface Holiday {
  id: string
  date: string
  label: string
  recurring: boolean
}

const DEFAULT_OPTIM: OptimizationSettings = {
  defaultSpeedKmh: 50,
  defaultStartTime: '07:00',
  maxDayDurationMin: 600,
  breakAfterMin: 270,
  breakDurationMin: 45,
  costPerKm: 0.35,
  fuelCostPerL: 1.65,
  consumptionLPer100Km: 30,
  valhallaFactor: 1.60,
}

const DEFAULT_BRANDING: BrandingSettings = {
  primaryColor: '#0055A4',
  companyDisplayName: '',
  logoUrl: '',
}

const DEFAULT_LOCALISATION: LocalisationSettings = {
  timezone: 'Europe/Paris',
  locale: 'fr-FR',
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  notificationsEnabled: true,
  smsEnabled: false,
  emailEnabled: true,
}

const DEFAULT_BILLING: BillingSettings = {
  invoicePrefix: 'FAC',
  vatNumber: '',
  billingEmail: '',
  supportEmail: '',
}

const DEFAULT_QUOTAS: QuotaSettings = {
  maxOptimizationsPerDay: 10,
}

const TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Montreal',
  'UTC',
]

const LOCALES = [
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'fr-BE', label: 'Français (Belgique)' },
  { value: 'fr-CH', label: 'Français (Suisse)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'it-IT', label: 'Italiano (Italia)' },
  { value: 'nl-NL', label: 'Nederlands (Nederland)' },
]

export function SettingsTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const storeDrivers = usePlanningStore(s => s.drivers)
  const storeMissions = usePlanningStore(s => s.missions)
  const storePlans = usePlanningStore(s => s.plans)
  const storeStartTimes = usePlanningStore(s => s.startTimes)
  const storeSpeeds = usePlanningStore(s => s.speeds)
  const storeUnavailable = usePlanningStore(s => s.unavailable)
  const storeLockedPlans = usePlanningStore(s => s.lockedPlans)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [backupStatus, setBackupStatus] = useState<'idle' | 'exporting' | 'importing' | 'ok' | 'error'>('idle')
  const [backupMsg, setBackupMsg] = useState('')

  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd]         = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdStatus, setPwdStatus]   = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [pwdError, setPwdError]     = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew]       = useState(false)

  const { tradeId: currentTradeId } = useTrade()
  const [selectedTrade, setSelectedTrade] = useState<TradeId>(currentTradeId)
  const [tradeStatus, setTradeStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [optim, setOptim] = useState<OptimizationSettings>(DEFAULT_OPTIM)
  const [optimStatus, setOptimStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING)
  const [brandingStatus, setBrandingStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [localisation, setLocalisation] = useState<LocalisationSettings>(DEFAULT_LOCALISATION)
  const [localisationStatus, setLocalisationStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [notifications, setNotifications] = useState<NotificationSettings>(DEFAULT_NOTIFICATIONS)
  const [notifStatus, setNotifStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [billing, setBilling] = useState<BillingSettings>(DEFAULT_BILLING)
  const [billingStatus, setBillingStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [quotas, setQuotas] = useState<QuotaSettings>(DEFAULT_QUOTAS)
  const [quotasStatus, setQuotasStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const [holidays, setHolidays]           = useState<Holiday[]>([])
  const [holidayDate, setHolidayDate]     = useState('')
  const [holidayLabel, setHolidayLabel]   = useState('')
  const [holidayRecurring, setHolidayRecurring] = useState(false)
  const [holidayLoading, setHolidayLoading] = useState(true)

  useEffect(() => {
    cachedFetch<SettingsApiResponse>('/api/settings', 120_000)
      .then(data => {
        if (!data) return
        setOptim({
          defaultSpeedKmh:      data.defaultSpeedKmh      ?? 50,
          defaultStartTime:     data.defaultStartTime     ?? '07:00',
          maxDayDurationMin:    data.maxWorkDayMin         ?? 600,
          breakAfterMin:        data.pauseAfterMin         ?? 270,
          breakDurationMin:     data.pauseDurationMin      ?? 45,
          costPerKm:            data.costPerKm             ?? 0.35,
          fuelCostPerL:         data.fuelCostPerLiter      ?? 1.65,
          consumptionLPer100Km: data.consumptionLPer100    ?? 30,
          valhallaFactor:       data.valhallaFactor        ?? 1.60,
        })
        setBranding({
          primaryColor:       data.primaryColor       ?? '#0055A4',
          companyDisplayName: data.companyDisplayName ?? '',
          logoUrl:            data.logoUrl            ?? '',
        })
        setLocalisation({
          timezone: data.timezone ?? 'Europe/Paris',
          locale:   data.locale   ?? 'fr-FR',
        })
        setNotifications({
          notificationsEnabled: data.notificationsEnabled ?? true,
          smsEnabled:           data.smsEnabled           ?? false,
          emailEnabled:         data.emailEnabled         ?? true,
        })
        setBilling({
          invoicePrefix: data.invoicePrefix ?? 'FAC',
          vatNumber:     data.vatNumber     ?? '',
          billingEmail:  data.billingEmail  ?? '',
          supportEmail:  data.supportEmail  ?? '',
        })
        setQuotas({
          maxOptimizationsPerDay: data.maxOptimizationsPerDay ?? 10,
        })
      })
      .catch(() => {})

    fetch('/api/holidays')
      .then(r => r.json())
      .then(d => { setHolidays(Array.isArray(d) ? d : d?.data ?? []) })
      .catch(() => {})
      .finally(() => setHolidayLoading(false))
  }, [])

  function handleExportJSON() {
    setBackupStatus('exporting')
    try {
      const data = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        drivers:    storeDrivers,
        missions:   storeMissions,
        plans:      storePlans,
        startTimes: storeStartTimes,
        speeds:     storeSpeeds,
        unavailable: storeUnavailable,
        lockedPlans: storeLockedPlans,
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `pathelix-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg(`${storeDrivers.length} chauffeurs, ${storeMissions.length} missions exportés`)
      setBackupStatus('ok')
      setTimeout(() => setBackupStatus('idle'), 4000)
    } catch {
      setBackupMsg('Erreur lors de l\'export')
      setBackupStatus('error')
      setTimeout(() => setBackupStatus('idle'), 3000)
    }
  }

  function handleImportJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBackupStatus('importing')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const data = JSON.parse(text)
        if (!Array.isArray(data.drivers) || !Array.isArray(data.missions)) {
          throw new Error('Format invalide — drivers/missions manquants')
        }
        if (!confirm(`Restaurer ${data.drivers.length} chauffeurs et ${data.missions.length} missions ? Les données actuelles seront remplacées.`)) {
          setBackupStatus('idle')
          return
        }
        usePlanningStore.setState({
          drivers:     data.drivers     ?? [],
          missions:    data.missions    ?? [],
          plans:       data.plans       ?? {},
          startTimes:  data.startTimes  ?? {},
          speeds:      data.speeds      ?? {},
          unavailable: data.unavailable ?? {},
          lockedPlans: data.lockedPlans ?? {},
        })
        setBackupMsg(`Restauré : ${data.drivers.length} chauffeurs, ${data.missions.length} missions`)
        setBackupStatus('ok')
        setTimeout(() => setBackupStatus('idle'), 4000)
      } catch (err) {
        setBackupMsg(err instanceof Error ? err.message : 'Fichier invalide')
        setBackupStatus('error')
        setTimeout(() => setBackupStatus('idle'), 3000)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwdError('')
    if (newPwd.length < 6)    { setPwdError('Min. 6 caractères'); return }
    if (newPwd !== confirmPwd) { setPwdError('Les mots de passe ne correspondent pas'); return }
    setPwdStatus('saving')
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Erreur serveur')
      }
      setPwdStatus('ok')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
      setTimeout(() => setPwdStatus('idle'), 3000)
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Erreur inconnue')
      setPwdStatus('error')
      setTimeout(() => setPwdStatus('idle'), 3000)
    }
  }

  async function handleLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {  }
    window.location.href = '/login'
  }

  async function handleClearLocalData() {
    if (!confirm('Supprimer toutes les données locales (plans, préférences) ? Cette action est irréversible.')) return
    localStorage.clear()
    window.location.reload()
  }

  async function saveSettings(payload: Record<string, unknown>, setStatus: (_s: 'idle' | 'saving' | 'ok' | 'error') => void) {
    setStatus('saving')
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || 'Erreur') }
      invalidateClientCache('/api/settings')
      setStatus('ok')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  async function handleSaveOptim() {
    await saveSettings({
      defaultSpeedKmh:    optim.defaultSpeedKmh,
      defaultStartTime:   optim.defaultStartTime,
      maxWorkDayMin:      optim.maxDayDurationMin,
      pauseAfterMin:      optim.breakAfterMin,
      pauseDurationMin:   optim.breakDurationMin,
      costPerKm:          optim.costPerKm,
      fuelCostPerLiter:   optim.fuelCostPerL,
      consumptionLPer100: optim.consumptionLPer100Km,
      valhallaFactor:     optim.valhallaFactor,
    }, setOptimStatus)
  }

  async function handleSaveBranding() {
    await saveSettings({
      primaryColor:       branding.primaryColor,
      companyDisplayName: branding.companyDisplayName,
      logoUrl:            branding.logoUrl,
    }, setBrandingStatus)
  }

  async function handleSaveLocalisation() {
    await saveSettings({
      timezone: localisation.timezone,
      locale:   localisation.locale,
    }, setLocalisationStatus)
  }

  async function handleSaveNotifications() {
    await saveSettings({
      notificationsEnabled: notifications.notificationsEnabled,
      smsEnabled:           notifications.smsEnabled,
      emailEnabled:         notifications.emailEnabled,
    }, setNotifStatus)
  }

  async function handleSaveBilling() {
    await saveSettings({
      invoicePrefix: billing.invoicePrefix,
      vatNumber:     billing.vatNumber,
      billingEmail:  billing.billingEmail,
      supportEmail:  billing.supportEmail,
    }, setBillingStatus)
  }

  async function handleSaveQuotas() {
    await saveSettings({
      maxOptimizationsPerDay: quotas.maxOptimizationsPerDay,
    }, setQuotasStatus)
  }

  async function handleAddHoliday() {
    if (!holidayDate || !holidayLabel) return
    try {
      const res = await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: holidayDate, label: holidayLabel, recurring: holidayRecurring }),
      })
      if (res.ok) {
        const created = await res.json()
        setHolidays(prev => [...prev, created])
        setHolidayDate('')
        setHolidayLabel('')
        setHolidayRecurring(false)
      }
    } catch {  }
  }

  async function handleDeleteHoliday(id: string) {
    if (!confirm('Supprimer ce jour férié ?')) return
    try {
      const res = await fetch(`/api/holidays/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toastError((d as { error?: string }).error || 'Erreur') ; return }
      setHolidays(prev => prev.filter(h => h.id !== id))
    } catch { toastError('Erreur réseau') }
  }

  const inp  = 'w-full bg-surface-100 border border-surface-200 rounded-lg px-2.5 py-1.5 text-surface-900 text-xs placeholder-surface-400 focus:outline-none focus:border-[#0055A4] focus:ring-1 focus:ring-[#0055A4] transition-colors'
  const sel  = 'w-full bg-surface-100 border border-surface-200 rounded-lg px-2.5 py-1.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4] focus:ring-1 focus:ring-[#0055A4] transition-colors'
  const lbl  = 'block text-surface-400 text-[10px] mb-0.5'
  const card = 'bg-white border border-surface-200 rounded-xl p-3'

  const SaveBar = ({ status, onSave, disabled }: { status: 'idle' | 'saving' | 'ok' | 'error'; onSave: () => void; disabled?: boolean }) => (
    <div className="mt-3 flex items-center gap-2">
      <button type="button" onClick={onSave} disabled={status === 'saving' || disabled}
        className="px-3 py-1.5 bg-[#0055A4] hover:bg-[#0066c4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors">
        {status === 'saving' ? 'Enregistrement...' : 'Enregistrer'}
      </button>
      {status === 'ok'    && <span className="text-green-500 text-xs">Enregistré</span>}
      {status === 'error' && <span className="text-red-500 text-xs">Erreur</span>}
    </div>
  )

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (_v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked ? 'true' : 'false'}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#0055A4] focus:ring-offset-1 ${
          checked ? 'bg-[#0055A4]' : 'bg-surface-300'
        }`}
      >
        <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition-transform ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`} />
      </button>
      <span className="text-surface-700 text-xs">{label}</span>
    </label>
  )

  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'integrations'>('general')

  return (
    <div className="flex-1 overflow-hidden flex flex-col">

      {}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-surface-200 bg-white flex-shrink-0">
        <button type="button" onClick={() => setSettingsSubTab('general')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            settingsSubTab === 'general' ? 'bg-brand-50 text-brand-500' : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700'
          }`}>
          General
        </button>
        <button type="button" onClick={() => setSettingsSubTab('integrations')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            settingsSubTab === 'integrations' ? 'bg-brand-50 text-brand-500' : 'text-surface-500 hover:bg-surface-50 hover:text-surface-700'
          }`}>
          Integrations
        </button>
      </div>

      {settingsSubTab === 'integrations' ? (
        <div className="flex-1 overflow-y-auto p-4">
          <IntegrationsPanel />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto flex flex-col p-3 md:p-4 gap-3">

      {}
      <div className="bg-white border border-surface-200 rounded-2xl p-4 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-surface-900 font-semibold text-xs">Secteur d&apos;activité</h3>
            <p className="text-surface-400 text-[11px] mt-0.5">Adapte le vocabulaire et les types de missions disponibles</p>
          </div>
          {tradeStatus === 'ok' && <span className="text-green-600 text-[11px] font-medium">Enregistré</span>}
          {tradeStatus === 'error' && <span className="text-red-500 text-[11px] font-medium">Erreur</span>}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <select value={selectedTrade} onChange={e => setSelectedTrade(e.target.value as TradeId)} title="Métier"
              className="w-full bg-surface-50 border border-surface-200 rounded-xl px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-100 focus:outline-none">
              {TRADE_IDS.map(id => (
                <option key={id} value={id}>{TRADES[id].vocabulary.tradeIcon} {TRADES[id].vocabulary.tradeName}</option>
              ))}
            </select>
          </div>
          <div className="text-surface-400 text-[11px] max-w-[280px]">
            {TRADES[selectedTrade].vocabulary.tradeDescription}
          </div>
          <button type="button" disabled={selectedTrade === currentTradeId || tradeStatus === 'saving'} onClick={async () => {
            setTradeStatus('saving')
            try {
              const r = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trade: selectedTrade }) })
              if (r.ok) { setTradeStatus('ok'); setTimeout(() => window.location.reload(), 500) }
              else setTradeStatus('error')
            } catch { setTradeStatus('error') }
          }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
              selectedTrade === currentTradeId ? 'bg-surface-100 text-surface-400 cursor-not-allowed' : 'bg-brand-500 text-white hover:bg-brand-600 shadow-soft'
            }`}>
            {tradeStatus === 'saving' ? 'Enregistrement...' : selectedTrade === currentTradeId ? 'Métier actuel' : 'Changer de métier'}
          </button>
        </div>
        {selectedTrade !== currentTradeId && (
          <div className="mt-2 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            Le changement de métier modifiera le vocabulaire et les types de missions dans toute l&apos;application. Les missions existantes avec des types désactivés resteront visibles avec un badge &quot;type incompatible&quot;.
          </div>
        )}
      </div>

      {}
      <div className="min-h-0 grid grid-cols-3 gap-3">

        {}
        <div className="flex flex-col gap-3 min-h-0">

          {}
          <div className={card}>
            <h3 className="text-surface-900 font-semibold text-xs mb-3">Optimisation</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Vitesse (km/h)</label>
                <input type="number" value={optim.defaultSpeedKmh} min={10} max={130}
                  title="Vitesse par défaut en km/h"
                  onChange={e => setOptim(p => ({ ...p, defaultSpeedKmh: parseInt(e.target.value) || 50 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Heure de départ</label>
                <input type="time" value={optim.defaultStartTime}
                  title="Heure de départ par défaut"
                  onChange={e => setOptim(p => ({ ...p, defaultStartTime: e.target.value }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Durée max journée (min)</label>
                <input type="number" value={optim.maxDayDurationMin} min={60} max={1440}
                  title="Durée maximale de la journée en minutes"
                  onChange={e => setOptim(p => ({ ...p, maxDayDurationMin: parseInt(e.target.value) || 600 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Pause après (min)</label>
                <input type="number" value={optim.breakAfterMin} min={60} max={600}
                  title="Durée de conduite avant pause obligatoire en minutes"
                  onChange={e => setOptim(p => ({ ...p, breakAfterMin: parseInt(e.target.value) || 270 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Durée pause (min)</label>
                <input type="number" value={optim.breakDurationMin} min={15} max={120}
                  title="Durée de la pause en minutes"
                  onChange={e => setOptim(p => ({ ...p, breakDurationMin: parseInt(e.target.value) || 45 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Coût au km (€)</label>
                <input type="number" value={optim.costPerKm} min={0} step="0.01"
                  title="Coût par kilomètre en euros"
                  onChange={e => setOptim(p => ({ ...p, costPerKm: parseFloat(e.target.value) || 0 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Carburant (€/L)</label>
                <input type="number" value={optim.fuelCostPerL} min={0} step="0.01"
                  title="Coût du carburant en euros par litre"
                  onChange={e => setOptim(p => ({ ...p, fuelCostPerL: parseFloat(e.target.value) || 0 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Consommation (L/100km)</label>
                <input type="number" value={optim.consumptionLPer100Km} min={0} step="0.5"
                  title="Consommation du véhicule en litres par 100km"
                  onChange={e => setOptim(p => ({ ...p, consumptionLPer100Km: parseFloat(e.target.value) || 0 }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>
                  Facteur Valhalla/OSRM
                  <JargonTip term="valhallaFactor" position="right" />
                </label>
                <input type="number" value={optim.valhallaFactor} min={0.5} max={3.0} step="0.05"
                  title="Correction des durées Valhalla (free-flow → réel). 1.60 = +60% de temps sur les durées estimées."
                  onChange={e => setOptim(p => ({ ...p, valhallaFactor: parseFloat(e.target.value) || 1.60 }))}
                  className={inp} />
              </div>
            </div>
            <SaveBar status={optimStatus} onSave={handleSaveOptim} />
          </div>

          {}
          <div className={card}>
            <h3 className="text-surface-900 font-semibold text-xs mb-3">Branding</h3>
            <div className="space-y-2">
              <div>
                <label className={lbl}>Nom de l&apos;entreprise (PDF)</label>
                <input type="text" value={branding.companyDisplayName}
                  placeholder="Ex : Société ABC"
                  onChange={e => setBranding(p => ({ ...p, companyDisplayName: e.target.value }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Couleur principale</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={branding.primaryColor}
                    title="Couleur principale de la marque"
                    onChange={e => setBranding(p => ({ ...p, primaryColor: e.target.value }))}
                    className="h-8 w-10 rounded border border-surface-200 bg-surface-100 cursor-pointer p-0.5" />
                  <input type="text" value={branding.primaryColor}
                    placeholder="#0055A4"
                    onChange={e => setBranding(p => ({ ...p, primaryColor: e.target.value }))}
                    className={`${inp} flex-1 font-mono`} />
                </div>
              </div>
              <div>
                <label className={lbl}>URL du logo</label>
                <input type="url" value={branding.logoUrl}
                  placeholder="https://example.com/logo.png"
                  onChange={e => setBranding(p => ({ ...p, logoUrl: e.target.value }))}
                  className={inp} />
              </div>
              {branding.logoUrl && (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={branding.logoUrl} alt="Logo aperçu" className="h-8 max-w-[120px] object-contain rounded border border-surface-200 bg-surface-50 p-0.5" />
                  <span className="text-surface-400 text-[10px]">Aperçu</span>
                </div>
              )}
            </div>
            <SaveBar status={brandingStatus} onSave={handleSaveBranding} />
          </div>

        </div>

        {}
        <div className="flex flex-col gap-3 min-h-0">

          {}
          <div className={`${card} flex-1 flex flex-col min-h-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-2 flex-shrink-0">Jours fériés</h3>
            {holidayLoading ? (
              <p className="text-surface-400 text-xs">Chargement...</p>
            ) : (
              <>
                {holidays.length > 0 ? (
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1 mb-2">
                    {holidays.map(h => (
                      <div key={h.id} className="flex items-center gap-2 bg-surface-100 rounded-lg px-2 py-1">
                        <span className="text-surface-900 text-xs font-mono flex-shrink-0">
                          {new Date(h.date).toLocaleDateString('fr-FR')}
                        </span>
                        <span className="text-surface-600 text-xs flex-1 truncate">{h.label}</span>
                        {h.recurring && (
                          <span className="text-[9px] text-blue-400 bg-blue-900/30 border border-blue-700/30 rounded px-1 flex-shrink-0">↺</span>
                        )}
                        <button type="button" onClick={() => handleDeleteHoliday(h.id)}
                          className="text-red-400 hover:text-red-300 w-5 h-5 flex items-center justify-center rounded text-[10px] flex-shrink-0">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-surface-400 text-xs mb-2">Aucun jour férié configuré</p>
                )}
                <div className="flex-shrink-0 grid grid-cols-2 gap-1.5 mb-1.5">
                  <div>
                    <label className={lbl}>Date</label>
                    <input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)} title="Date du jour férié" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Libellé</label>
                    <input type="text" value={holidayLabel} onChange={e => setHolidayLabel(e.target.value)}
                      placeholder="Ex : Noël" className={inp} />
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-surface-500 text-[10px] cursor-pointer">
                    <input type="checkbox" checked={holidayRecurring} onChange={e => setHolidayRecurring(e.target.checked)}
                      title="Jour férié récurrent chaque année"
                      className="rounded border-surface-200 bg-surface-100 text-[#0055A4] focus:ring-[#0055A4]" />
                    Récurrent
                  </label>
                  <button type="button" onClick={handleAddHoliday} disabled={!holidayDate || !holidayLabel}
                    className="ml-auto px-2.5 py-1 bg-[#0055A4] hover:bg-[#0066c4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors">
                    Ajouter
                  </button>
                </div>
              </>
            )}
          </div>

          {}
          <div className={`${card} flex-shrink-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-2">Sauvegarde</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleExportJSON}
                disabled={backupStatus === 'exporting' || backupStatus === 'importing'}
                className="px-3 py-1.5 bg-surface-50 hover:bg-surface-100 disabled:opacity-50 text-surface-600 text-xs font-medium rounded-lg border border-surface-200 transition-colors flex items-center gap-1">
                Exporter
              </button>
              <label className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                backupStatus === 'importing'
                  ? 'opacity-50 bg-surface-100 border-surface-200 text-surface-400'
                  : 'bg-surface-50 hover:bg-surface-100 border-surface-200 text-surface-600'
              }`}>
                {backupStatus === 'importing' ? 'Import...' : 'Importer'}
                <input ref={importInputRef} type="file" accept=".json,application/json"
                  onChange={handleImportJSON} disabled={backupStatus === 'importing'}
                  title="Importer un fichier de sauvegarde JSON"
                  aria-label="Importer un fichier de sauvegarde JSON"
                  className="sr-only" />
              </label>
            </div>
            {backupStatus === 'ok'    && <p className="text-emerald-600 text-[10px] mt-1.5">{backupMsg}</p>}
            {backupStatus === 'error' && <p className="text-red-600 text-[10px] mt-1.5">{backupMsg}</p>}
          </div>

          {}
          <div className={`${card} flex-shrink-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-3">Localisation</h3>
            <div className="space-y-2">
              <div>
                <label className={lbl}>Fuseau horaire</label>
                <select value={localisation.timezone}
                  onChange={e => setLocalisation(p => ({ ...p, timezone: e.target.value }))}
                  title="Fuseau horaire"
                  className={sel}>
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Langue / Locale</label>
                <select value={localisation.locale}
                  onChange={e => setLocalisation(p => ({ ...p, locale: e.target.value }))}
                  title="Locale"
                  className={sel}>
                  {LOCALES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <SaveBar status={localisationStatus} onSave={handleSaveLocalisation} />
          </div>

        </div>

        {}
        <div className="flex flex-col gap-3 min-h-0">

          {}
          <div className={`${card} flex-shrink-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-2">Mot de passe</h3>
            <form onSubmit={handleChangePassword} className="space-y-2">
              <div>
                <label className={lbl}>Mot de passe actuel</label>
                <div className="relative">
                  <input type={showCurrent ? 'text' : 'password'} value={currentPwd}
                    onChange={e => setCurrentPwd(e.target.value)} required
                    title="Mot de passe actuel" className={inp} />
                  <button type="button" onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-500 text-[10px]">
                    {showCurrent ? 'Cacher' : 'Voir'}
                  </button>
                </div>
              </div>
              <div>
                <label className={lbl}>Nouveau mot de passe</label>
                <div className="relative">
                  <input type={showNew ? 'text' : 'password'} value={newPwd}
                    onChange={e => setNewPwd(e.target.value)} required minLength={6}
                    placeholder="Min. 6 caractères" className={inp} />
                  <button type="button" onClick={() => setShowNew(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-500 text-[10px]">
                    {showNew ? 'Cacher' : 'Voir'}
                  </button>
                </div>
              </div>
              <div>
                <label className={lbl}>Confirmer</label>
                <input type="password" value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)} required
                  title="Confirmer le nouveau mot de passe" className={inp} />
              </div>
              {pwdError && (
                <p className="text-red-600 text-[10px] bg-red-50 border border-red-200 rounded-lg px-2 py-1">{pwdError}</p>
              )}
              {pwdStatus === 'ok' && (
                <p className="text-emerald-600 text-[10px] bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">Mot de passe modifié</p>
              )}
              <button type="submit" disabled={pwdStatus === 'saving' || !currentPwd || !newPwd || !confirmPwd}
                className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors">
                {pwdStatus === 'saving' ? 'Enregistrement...' : 'Modifier'}
              </button>
            </form>
          </div>

          {}
          <div className={`${card} flex-shrink-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-3">Notifications</h3>
            <div className="space-y-2.5">
              <Toggle
                checked={notifications.notificationsEnabled}
                onChange={v => setNotifications(p => ({ ...p, notificationsEnabled: v }))}
                label="Notifications activées"
              />
              <Toggle
                checked={notifications.emailEnabled}
                onChange={v => setNotifications(p => ({ ...p, emailEnabled: v }))}
                label="Email"
              />
              <Toggle
                checked={notifications.smsEnabled}
                onChange={v => setNotifications(p => ({ ...p, smsEnabled: v }))}
                label="SMS"
              />
            </div>
            <SaveBar status={notifStatus} onSave={handleSaveNotifications} />
          </div>

          {}
          <div className={`${card} flex-shrink-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-3">Facturation</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl}>Préfixe facture</label>
                <input type="text" value={billing.invoicePrefix}
                  placeholder="FAC"
                  onChange={e => setBilling(p => ({ ...p, invoicePrefix: e.target.value }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>N° TVA</label>
                <input type="text" value={billing.vatNumber}
                  placeholder="FR12345678901"
                  onChange={e => setBilling(p => ({ ...p, vatNumber: e.target.value }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Email facturation</label>
                <input type="email" value={billing.billingEmail}
                  placeholder="compta@example.com"
                  onChange={e => setBilling(p => ({ ...p, billingEmail: e.target.value }))}
                  className={inp} />
              </div>
              <div>
                <label className={lbl}>Email support</label>
                <input type="email" value={billing.supportEmail}
                  placeholder="support@example.com"
                  onChange={e => setBilling(p => ({ ...p, supportEmail: e.target.value }))}
                  className={inp} />
              </div>
            </div>
            <SaveBar status={billingStatus} onSave={handleSaveBilling} />
          </div>

          {}
          <div className={`${card} flex-shrink-0`}>
            <h3 className="text-surface-900 font-semibold text-xs mb-3">Quotas</h3>
            <div>
              <label className={lbl}>Optimisations / jour (max)</label>
              <input type="number" value={quotas.maxOptimizationsPerDay} min={1} max={1000}
                title="Nombre maximum d'optimisations par jour"
                onChange={e => setQuotas({ maxOptimizationsPerDay: parseInt(e.target.value) || 10 })}
                className={inp} />
            </div>
            <SaveBar status={quotasStatus} onSave={handleSaveQuotas} />
          </div>

          {}
          <div className={`${card} flex-1 flex flex-col gap-3 min-h-0`}>

            {}
            <div className="flex-shrink-0">
              <h3 className="text-surface-900 font-semibold text-xs mb-2">Session</h3>
              <button type="button" onClick={handleLogout}
                className="px-3 py-1.5 bg-surface-50 hover:bg-red-50 text-surface-600 hover:text-red-600 text-xs font-medium rounded-lg border border-surface-200 hover:border-red-200 transition-colors">
                Se deconnecter
              </button>
            </div>

            <div className="border-t border-surface-200 flex-shrink-0" />

            {}
            <div className="flex-shrink-0">
              <h3 className="text-surface-900 font-semibold text-xs mb-2">Données locales</h3>
              <button type="button" onClick={handleClearLocalData}
                className="px-3 py-1.5 bg-surface-50 hover:bg-amber-50 text-surface-600 hover:text-amber-700 text-xs font-medium rounded-lg border border-surface-200 hover:border-amber-200 transition-colors">
                Reinitialiser
              </button>
            </div>

            <div className="border-t border-surface-200 flex-shrink-0" />

            {}
            <div className="flex-shrink-0">
              <h3 className="text-red-600 font-semibold text-xs mb-2">Zone admin</h3>
              <div className="space-y-2">
                <button type="button" onClick={async () => {
                  if (!confirm('Purger tous les logs d\'audit ? Cette action est irreversible.')) return
                  await fetch('/api/audit', { method: 'DELETE' }).catch(() => {})
                  toastSuccess('Logs d\'audit purgés')
                }} className="w-full text-left px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-50 hover:bg-red-50 text-surface-600 hover:text-red-600 border border-surface-200 hover:border-red-200 transition-colors">
                  Purger les logs d&apos;audit
                </button>
                <button type="button" onClick={async () => {
                  if (!confirm('Supprimer tous les plans de tournees ? Les missions seront conservees.')) return
                  await fetch('/api/plans?action=purge', { method: 'DELETE' }).catch(() => {})
                  toastSuccess('Plans purgés')
                }} className="w-full text-left px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-50 hover:bg-red-50 text-surface-600 hover:text-red-600 border border-surface-200 hover:border-red-200 transition-colors">
                  Purger tous les plans de tournees
                </button>
                <button type="button" onClick={async () => {
                  if (!confirm('Archiver TOUTES les missions ? Vous pourrez les restaurer individuellement.')) return
                  await fetch('/api/missions?action=archive-all', { method: 'POST' }).catch(() => {})
                  toastSuccess('Toutes les missions archivées')
                }} className="w-full text-left px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-50 hover:bg-amber-50 text-surface-600 hover:text-amber-700 border border-surface-200 hover:border-amber-200 transition-colors">
                  Archiver toutes les missions
                </button>
              </div>
            </div>

            <div className="border-t border-surface-200 flex-shrink-0" />

            {}
            <div className="flex-shrink-0">
              <h3 className="text-surface-900 font-semibold text-xs mb-2">A propos</h3>
              <div className="grid grid-cols-2 gap-y-1.5 text-[10px]">
                <span className="text-surface-400">Application</span><span className="text-surface-600">PATHÉLIX</span>
                <span className="text-surface-400">Version</span><span className="text-surface-600">1.0.0</span>
                <span className="text-surface-400">Framework</span><span className="text-surface-600">Next.js 14 / TypeScript</span>
                <span className="text-surface-400">Optimisation</span><span className="text-surface-600">MV-ALNS + Cheapest Insertion + Regret-3</span>
                <span className="text-surface-400">Base de donnees</span><span className="text-surface-600">PostgreSQL (Prisma)</span>
                <span className="text-surface-400">Routage</span><span className="text-surface-600">OSRM / Haversine</span>
              </div>
            </div>

          </div>

        </div>

      </div>

      </div>
      )}

    </div>
  )
}
