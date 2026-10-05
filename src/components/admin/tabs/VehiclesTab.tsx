'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { apiErrorMessage, fetchAllPages } from '@/lib/apiClient'
import { Btn, Modal, Field, Input, SelectInput, Textarea } from '../ui'
import { useDebounce, logErr, sleep } from '../hooks'
import { useToast } from '@/components/ui/Toast'
import { usePlanningStore } from '@/stores/planningStore'
import { ImportExportBar } from '../ImportExportBar'
import { VEHICLE_COLUMNS, parseVehicleRows } from '@/lib/importExportColumns'
import { VehicleMaintenanceModal } from '../modals/VehicleMaintenanceModal'
import { VehicleFuelModal } from '../modals/VehicleFuelModal'
import { invalidateClientCache } from '@/lib/clientCache'

interface GabaritProfile {
  key: string
  label: string
  description: string
  weightTon: number
  heightM: number
  widthM: number
  lengthM: number
  axleCount: number
  hazmat: boolean
}

const GABARIT_PROFILES: GabaritProfile[] = [
  { key: 'vl_utilitaire',  label: 'VL - Utilitaire',       description: '3.5t — Fourgon, petit plateau',           weightTon: 3.5,  heightM: 2.5, widthM: 2.0,  lengthM: 6.0,   axleCount: 2, hazmat: false },
  { key: 'pl_7t5',         label: 'PL 7.5t',               description: '7.5t — Petit porteur',                    weightTon: 7.5,  heightM: 3.0, widthM: 2.4,  lengthM: 7.5,   axleCount: 2, hazmat: false },
  { key: 'pl_12t',         label: 'PL 12t',                description: '12t — Porteur moyen',                     weightTon: 12,   heightM: 3.2, widthM: 2.5,  lengthM: 8.5,   axleCount: 2, hazmat: false },
  { key: 'pl_19t',         label: 'PL 19t',                description: '19t — Porteur benne / ampliroll',         weightTon: 19,   heightM: 3.5, widthM: 2.55, lengthM: 10.0,  axleCount: 2, hazmat: false },
  { key: 'pl_26t',         label: 'PL 26t',                description: '26t — Porteur 3 essieux (standard PL)',   weightTon: 26,   heightM: 4.0, widthM: 2.55, lengthM: 12.0,  axleCount: 3, hazmat: false },
  { key: 'pl_32t_semi',    label: 'PL 32t - Semi',         description: '32t — Semi-remorque',                     weightTon: 32,   heightM: 4.0, widthM: 2.55, lengthM: 16.5,  axleCount: 4, hazmat: false },
  { key: 'pl_44t_routier', label: 'PL 44t - Grand routier', description: '44t — Ensemble articule',                weightTon: 44,   heightM: 4.0, widthM: 2.55, lengthM: 18.75, axleCount: 5, hazmat: false },
  { key: 'grue_aux',       label: 'Grue auxiliaire',        description: '26t — Porteur avec grue',                weightTon: 26,   heightM: 4.2, widthM: 2.55, lengthM: 10.0,  axleCount: 3, hazmat: false },
  { key: 'compacteur',     label: 'Compacteur',            description: '26t — BOM / compacteur',                  weightTon: 26,   heightM: 3.8, widthM: 2.55, lengthM: 10.5,  axleCount: 3, hazmat: false },
]

function getProfileByKey(key: string): GabaritProfile | undefined {
  return GABARIT_PROFILES.find(p => p.key === key)
}

function detectProfile(v: { weightTon: number; heightM: number; widthM: number; lengthM: number; axleCount: number; hazmat: boolean }): string {
  const match = GABARIT_PROFILES.find(p =>
    p.weightTon === v.weightTon && p.heightM === v.heightM && p.widthM === v.widthM &&
    p.lengthM === v.lengthM && p.axleCount === v.axleCount && p.hazmat === v.hazmat
  )
  return match?.key ?? 'custom'
}

interface Vehicle {
  id: string
  immatriculation: string
  type: string
  marque: string
  modele: string
  capaciteM3: number
  nbBennes: number
  kilometrage: number
  prochaineCT: string
  statut: 'active' | 'maintenance' | 'decommissioned'
  notes: string
  assignedDriverId?: string
  tollClass: number
  telepayBadge: string
  telepayDiscount: number
  gabaritProfile: string
  weightTon: number
  heightM: number
  widthM: number
  lengthM: number
  axleCount: number
  hazmat: boolean

  fuelType: string
  year: number | ''
  vin: string
  color: string

  gpsDeviceId: string

  insuranceExpiry: string
  insuranceRef: string

  lastServiceDate: string
  lastServiceKm: number | ''
}

type VehicleForm = Omit<Vehicle, 'id'>

const BLANK_FORM: VehicleForm = {
  immatriculation: '',
  type: 'benne',
  marque: '',
  modele: '',
  capaciteM3: 10,
  nbBennes: 1,
  kilometrage: 0,
  prochaineCT: '',
  statut: 'active',
  notes: '',
  assignedDriverId: '',
  tollClass: 3,
  telepayBadge: '',
  telepayDiscount: 0,
  gabaritProfile: 'pl_26t',
  weightTon: 26,
  heightM: 4.0,
  widthM: 2.55,
  lengthM: 12.0,
  axleCount: 3,
  hazmat: false,
  fuelType: '',
  year: '',
  vin: '',
  color: '',
  gpsDeviceId: '',
  insuranceExpiry: '',
  insuranceRef: '',
  lastServiceDate: '',
  lastServiceKm: '',
}

const TOLL_CLASSES = [
  { value: 2, label: 'Classe 2 (2 essieux, < 3m)' },
  { value: 3, label: 'Classe 3 (2 essieux, > 3m)' },
  { value: 4, label: 'Classe 4 (3+ essieux)' },
]

const TELEPAY_BADGES = [
  { value: '', label: 'Aucun badge' },
  { value: 'tis_pl', label: 'TIS-PL (APRR/AREA) — -13%' },
  { value: 'axxes', label: 'Axxes — -8%' },
  { value: 'eurotoll', label: 'Eurotoll — -7%' },
  { value: 'total_card', label: 'TotalEnergies Card — -6%' },
  { value: 'dkv', label: 'DKV — -5%' },
]

const FUEL_TYPE_OPTIONS = [
  { value: '',           label: '-- Non renseigné --' },
  { value: 'diesel',     label: 'Diesel' },
  { value: 'essence',    label: 'Essence' },
  { value: 'electrique', label: 'Électrique' },
  { value: 'hybride',    label: 'Hybride' },
  { value: 'gpl',        label: 'GPL' },
]

const VEHICLE_TYPES = [
  { value: 'benne', label: 'Benne' },
  { value: 'ampliroll', label: 'Ampliroll' },
  { value: 'grue', label: 'Grue auxiliaire' },
  { value: 'compacteur', label: 'Compacteur' },
  { value: 'plateau', label: 'Plateau' },
  { value: 'autre', label: 'Autre' },
]

const STATUT_OPTIONS = [
  { value: 'active', label: 'Actif' },
  { value: 'maintenance', label: 'En maintenance' },
  { value: 'decommissioned', label: 'Hors service' },
]

function statutBadge(statut: string) {
  const cls = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    maintenance: 'bg-amber-50 text-amber-700 border-amber-200',
    decommissioned: 'bg-red-50 text-red-700 border-red-200',
  }[statut] || 'bg-surface-100 text-surface-500 border-surface-200'
  const label = { active: 'Actif', maintenance: 'Maintenance', decommissioned: 'Hors service' }[statut] || statut
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}`}>{label}</span>
}

function gabaritBadge(profileKey: string, v: Vehicle) {
  const profile = getProfileByKey(profileKey)
  if (profile) {
    return (
      <div>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200">
          {profile.label}
        </span>
        {v.hazmat && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border bg-amber-50 text-amber-600 border-amber-200 ml-1">ADR</span>}
      </div>
    )
  }
  return (
    <div>
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border bg-surface-100 text-surface-600 border-surface-200">
        {v.weightTon}t / {v.heightM}m / {v.lengthM}m
      </span>
      {v.hazmat && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border bg-amber-50 text-amber-600 border-amber-200 ml-1">ADR</span>}
    </div>
  )
}

export function VehiclesTab() {
  const { error: toastError } = useToast()
  const drivers = usePlanningStore(s => s.drivers)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [modal, setModal] = useState<{ kind: 'new' } | { kind: 'edit'; vehicle: Vehicle } | null>(null)
  const [form, setForm] = useState<VehicleForm>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [maintenanceVehicle, setMaintenanceVehicle] = useState<{ id: string; name: string } | null>(null)
  const [fuelVehicle, setFuelVehicle] = useState<{ id: string; name: string } | null>(null)

  function mapVehicle(v: Record<string, unknown>): Vehicle {
    const wt = (v.weightTon ?? 26) as number
    const hm = (v.heightM ?? 4.0) as number
    const wm = (v.widthM ?? 2.55) as number
    const lm = (v.lengthM ?? 12.0) as number
    const ac = (v.axleCount ?? 3) as number
    const hz = (v.hazmat ?? false) as boolean
    const storedProfile = (v.gabaritProfile ?? '') as string
    return {
      id: v.id as string,
      immatriculation: v.licensePlate as string,
      type: v.type as string,
      marque: (v.brand ?? '') as string,
      modele: (v.model ?? '') as string,
      capaciteM3: (v.capacityM3 ?? 0) as number,
      nbBennes: (v.maxBins ?? 0) as number,
      kilometrage: (v.mileageKm ?? 0) as number,
      prochaineCT: (v.nextInspection ?? '') as string,
      statut: (v.status ?? 'active') as Vehicle['statut'],
      notes: (v.notes ?? '') as string,
      assignedDriverId: (v.assignedDriverId ?? undefined) as string | undefined,
      tollClass: (v.tollClass ?? 3) as number,
      telepayBadge: (v.telepayBadge ?? '') as string,
      telepayDiscount: (v.telepayDiscount ?? 0) as number,
      gabaritProfile: storedProfile || detectProfile({ weightTon: wt, heightM: hm, widthM: wm, lengthM: lm, axleCount: ac, hazmat: hz }),
      weightTon: wt,
      heightM: hm,
      widthM: wm,
      lengthM: lm,
      axleCount: ac,
      hazmat: hz,
      fuelType: (v.fuelType ?? '') as string,
      year: (v.year ?? '') as number | '',
      vin: (v.vin ?? '') as string,
      color: (v.color ?? '') as string,
      gpsDeviceId: (v.gpsDeviceId ?? '') as string,
      insuranceExpiry: (v.insuranceExpiry ?? '') as string,
      insuranceRef: (v.insuranceRef ?? '') as string,
      lastServiceDate: (v.lastServiceDate ?? '') as string,
      lastServiceKm: (v.lastServiceKm ?? '') as number | '',
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    fetchAllPages<unknown>('/api/vehicles')
      .then(list => setVehicles(list.map(v => mapVehicle(v as Parameters<typeof mapVehicle>[0]))))
      .catch(logErr('vehicles'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setForm(BLANK_FORM)
    setError('')
    setModal({ kind: 'new' })
  }

  function openEdit(v: Vehicle) {
    setForm({
      immatriculation: v.immatriculation,
      type: v.type,
      marque: v.marque,
      modele: v.modele,
      capaciteM3: v.capaciteM3,
      nbBennes: v.nbBennes,
      kilometrage: v.kilometrage,
      prochaineCT: v.prochaineCT,
      statut: v.statut,
      notes: v.notes,
      assignedDriverId: v.assignedDriverId || '',
      tollClass: v.tollClass ?? '',
      telepayBadge: v.telepayBadge ?? '',
      telepayDiscount: v.telepayDiscount ?? 0,
      gabaritProfile: v.gabaritProfile,
      weightTon: v.weightTon,
      heightM: v.heightM,
      widthM: v.widthM,
      lengthM: v.lengthM,
      axleCount: v.axleCount,
      hazmat: v.hazmat,
      fuelType: v.fuelType,
      year: v.year,
      vin: v.vin,
      color: v.color,
      gpsDeviceId: v.gpsDeviceId,
      insuranceExpiry: v.insuranceExpiry,
      insuranceRef: v.insuranceRef,
      lastServiceDate: v.lastServiceDate,
      lastServiceKm: v.lastServiceKm,
    })
    setError('')
    setModal({ kind: 'edit', vehicle: v })
  }

  function applyProfile(profileKey: string) {
    if (profileKey === 'custom') {
      setForm(f => ({ ...f, gabaritProfile: 'custom' }))
      return
    }
    const profile = getProfileByKey(profileKey)
    if (!profile) return
    setForm(f => ({
      ...f,
      gabaritProfile: profileKey,
      weightTon: profile.weightTon,
      heightM: profile.heightM,
      widthM: profile.widthM,
      lengthM: profile.lengthM,
      axleCount: profile.axleCount,
      hazmat: profile.hazmat,
    }))
  }

  async function handleSave() {
    setError('')
    if (!form.immatriculation) {
      setError('L\'immatriculation est obligatoire.')
      return
    }

    setSaving(true)
    try {
      const body = {
        licensePlate: form.immatriculation,
        type: form.type,
        // Cleared fields are sent explicitly ('' / 0 / null): an omitted key means "unchanged"
        // to the API, so emptying a field or unassigning the driver used to be silently ignored.
        brand: form.marque ?? '',
        model: form.modele ?? '',
        capacityM3: form.capaciteM3 || null,
        maxBins: form.nbBennes || null,
        mileageKm: form.kilometrage || 0,
        nextInspection: form.prochaineCT || null,
        status: form.statut,
        notes: form.notes ?? '',
        assignedDriverId: form.assignedDriverId || null,
        tollClass: form.tollClass,
        telepayBadge: form.telepayBadge ?? '',
        telepayDiscount: form.telepayDiscount || 0,
        gabaritProfile: form.gabaritProfile,
        weightTon: form.weightTon,
        heightM: form.heightM,
        widthM: form.widthM,
        lengthM: form.lengthM,
        axleCount: form.axleCount,
        hazmat: form.hazmat,
        fuelType: form.fuelType || '',
        year: form.year !== '' ? form.year : null,
        vin: form.vin || null,
        color: form.color ?? '',
        gpsDeviceId: form.gpsDeviceId || null,
        insuranceExpiry: form.insuranceExpiry || null,
        insuranceRef: form.insuranceRef ?? '',
        lastServiceDate: form.lastServiceDate || null,
        lastServiceKm: form.lastServiceKm !== '' ? form.lastServiceKm : null,
      }

      if (modal?.kind === 'edit') {
        const res = await fetch(`/api/vehicles/${modal.vehicle.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          throw new Error(apiErrorMessage(await res.json().catch(() => null), res.status))
        }
      } else {
        const res = await fetch('/api/vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          throw new Error(apiErrorMessage(await res.json().catch(() => null), res.status))
        }
      }
      setModal(null)
      invalidateClientCache('/api/vehicles')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce vehicule ? Cette action est irreversible.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toastError((err as { error?: string }).error || 'Erreur lors de la suppression')
      }
      invalidateClientCache('/api/vehicles')
      load()
    } catch {
      toastError('Erreur réseau')
    } finally {
      setDeleting(null)
    }
  }

  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')

  const vehicleTypes = useMemo(() => [...new Set(vehicles.map(v => v.type))].filter(Boolean).sort(), [vehicles])
  const vehicleBrands = useMemo(() => [...new Set(vehicles.map(v => v.marque))].filter(Boolean).sort(), [vehicles])

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return vehicles.filter(v => {
      if (q && !`${v.immatriculation} ${v.type} ${v.marque} ${v.modele} ${v.statut}`.toLowerCase().includes(q)) return false
      if (typeFilter !== 'all' && v.type !== typeFilter) return false
      if (statusFilter !== 'all' && v.statut !== statusFilter) return false
      if (brandFilter !== 'all' && v.marque !== brandFilter) return false
      return true
    })
  }, [vehicles, debouncedSearch, typeFilter, statusFilter, brandFilter])

  const activeDrivers = drivers.filter(d => !d.archived)

  function driverName(driverId?: string) {
    if (!driverId) return null
    const d = drivers.find(dr => dr.id === driverId)
    return d ? `${d.firstName} ${d.lastName}` : driverId
  }

  const isCustomProfile = form.gabaritProfile === 'custom'

  const maintenanceAlerts = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const in30 = new Date(today); in30.setDate(today.getDate() + 30)
    return vehicles.flatMap(v => {
      const alerts: { id: string; plate: string; msg: string; level: 'danger' | 'warning' }[] = []
      if (v.prochaineCT) {
        const d = new Date(v.prochaineCT)
        if (d < today) alerts.push({ id: v.id + '-ct-exp', plate: v.immatriculation, msg: `CT expirée le ${d.toLocaleDateString('fr-FR')}`, level: 'danger' })
        else if (d < in30) alerts.push({ id: v.id + '-ct-soon', plate: v.immatriculation, msg: `CT expire le ${d.toLocaleDateString('fr-FR')} (J-${Math.ceil((d.getTime() - today.getTime()) / 86400000)})`, level: 'warning' })
      }
      if (v.insuranceExpiry) {
        const d = new Date(v.insuranceExpiry)
        if (d < today) alerts.push({ id: v.id + '-ins-exp', plate: v.immatriculation, msg: `Assurance expirée le ${d.toLocaleDateString('fr-FR')}`, level: 'danger' })
        else if (d < in30) alerts.push({ id: v.id + '-ins-soon', plate: v.immatriculation, msg: `Assurance expire le ${d.toLocaleDateString('fr-FR')} (J-${Math.ceil((d.getTime() - today.getTime()) / 86400000)})`, level: 'warning' })
      }
      return alerts
    })
  }, [vehicles])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {maintenanceAlerts.length > 0 && (
        <div className="px-4 py-2 border-b border-surface-200 flex-shrink-0 space-y-1">
          {maintenanceAlerts.map(a => (
            <div key={a.id} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg font-medium ${
              a.level === 'danger' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              <span>{a.level === 'danger' ? '🚫' : '⚠️'}</span>
              <span className="font-bold font-mono">{a.plate}</span>
              <span>—</span>
              <span>{a.msg}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
          {vehicles.length} vehicule{vehicles.length !== 1 ? 's' : ''}
        </span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-36" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} title="Filtrer par type"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous types</option>
          {vehicleTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} title="Filtrer par marque"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Toutes marques</option>
          {vehicleBrands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} title="Filtrer par statut"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous statuts</option>
          <option value="active">Actif</option>
          <option value="maintenance">Maintenance</option>
          <option value="decommissioned">Hors service</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ImportExportBar
            columns={VEHICLE_COLUMNS}
            data={filtered}
            filename="vehicules"
            parseRows={parseVehicleRows}
            onImport={async (items) => {
              let failed = 0
              for (const [i, v] of items.entries()) {
                if (i > 0) await sleep(250)
                const res = await fetch('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
                if (!res.ok) failed++
              }
              invalidateClientCache('/api/vehicles')
              load()
              if (failed > 0) throw new Error(`${failed} sur ${items.length} véhicule(s) n'ont pas pu être importés.`)
            }}
          />
          <Btn onClick={openNew} variant="primary" size="sm">
            <span className="hidden sm:inline">+ Nouveau vehicule</span><span className="sm:hidden">+</span>
          </Btn>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-surface-400 text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-400 gap-2">
            <div className="text-3xl">🚛</div>
            <div className="text-sm">Aucun vehicule trouve</div>
          </div>
        ) : (
          <>
            {}
            <div className="md:hidden space-y-2 px-2 py-2">
              {filtered.map(v => (
                <div key={v.id} className="bg-white border border-surface-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-surface-900 font-semibold text-sm font-mono">{v.immatriculation}</div>
                      <div className="text-surface-500 text-xs">{v.marque} {v.modele}</div>
                    </div>
                    {statutBadge(v.statut)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-surface-400">
                    <span>{v.type}</span>
                    <span>{v.capaciteM3} m3</span>
                    <span>{v.kilometrage.toLocaleString('fr-FR')} km</span>
                    {gabaritBadge(v.gabaritProfile, v)}
                    {v.assignedDriverId && <span className="text-blue-400">{driverName(v.assignedDriverId)}</span>}
                  </div>
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    <Btn onClick={() => setMaintenanceVehicle({ id: v.id, name: v.immatriculation })} variant="ghost" size="xs" title="Entretien">🔧 Entretien</Btn>
                    <Btn onClick={() => setFuelVehicle({ id: v.id, name: v.immatriculation })} variant="ghost" size="xs" title="Carburant">⛽ Carburant</Btn>
                    <Btn onClick={() => openEdit(v)} variant="ghost" size="xs">Modifier</Btn>
                    <Btn onClick={() => handleDelete(v.id)} variant="danger" size="xs" disabled={deleting === v.id}>
                      {deleting === v.id ? '...' : 'Supprimer'}
                    </Btn>
                  </div>
                </div>
              ))}
            </div>

            {}
            <table className="w-full text-sm border-collapse hidden md:table">
              <thead className="sticky top-0 bg-surface-50 z-10">
                <tr>
                  {['Immatriculation', 'Type', 'Marque / Modele', 'Capacite', 'Gabarit', 'Kilometrage', 'Prochaine CT', 'Statut', 'Chauffeur', 'Actions'].map(h => (
                    <th key={h} className="text-left text-surface-400 text-[11px] uppercase tracking-wider px-4 py-2.5 border-b border-surface-200 font-normal whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="text-surface-900 font-semibold text-sm font-mono">{v.immatriculation}</div>
                      <div className="text-surface-300 text-[10px] font-mono">{v.id}</div>
                    </td>
                    <td className="px-4 py-3 text-surface-600 text-xs">{v.type}</td>
                    <td className="px-4 py-3 text-surface-600 text-sm">{v.marque} {v.modele}</td>
                    <td className="px-4 py-3">
                      <span className="text-surface-600 text-xs font-mono">{v.capaciteM3} m3</span>
                      <span className="text-surface-400 text-[10px] ml-1">({v.nbBennes} benne{v.nbBennes !== 1 ? 's' : ''})</span>
                    </td>
                    <td className="px-4 py-3">{gabaritBadge(v.gabaritProfile, v)}</td>
                    <td className="px-4 py-3 text-surface-500 text-xs font-mono">{v.kilometrage.toLocaleString('fr-FR')} km</td>
                    <td className="px-4 py-3">
                      {v.prochaineCT ? (
                        <span className={`text-xs ${new Date(v.prochaineCT) < new Date() ? 'text-red-400 font-bold' : 'text-surface-500'}`}>
                          {new Date(v.prochaineCT).toLocaleDateString('fr-FR')}
                        </span>
                      ) : (
                        <span className="text-surface-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{statutBadge(v.statut)}</td>
                    <td className="px-4 py-3">
                      {v.assignedDriverId ? (
                        <span className="text-blue-400 text-xs">{driverName(v.assignedDriverId)}</span>
                      ) : (
                        <span className="text-surface-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Btn onClick={() => setMaintenanceVehicle({ id: v.id, name: v.immatriculation })} variant="ghost" size="xs" title="Historique entretien">🔧</Btn>
                        <Btn onClick={() => setFuelVehicle({ id: v.id, name: v.immatriculation })} variant="ghost" size="xs" title="Historique carburant">⛽</Btn>
                        <Btn onClick={() => openEdit(v)} variant="ghost" size="xs">Modifier</Btn>
                        <Btn onClick={() => handleDelete(v.id)} variant="danger" size="xs" disabled={deleting === v.id}>
                          {deleting === v.id ? '...' : 'Supprimer'}
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
        <Modal title={modal.kind === 'new' ? 'Nouveau vehicule' : 'Modifier le vehicule'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Immatriculation *">
                <Input value={form.immatriculation} onChange={v => setForm(f => ({ ...f, immatriculation: v }))} placeholder="AA-123-BB" />
              </Field>
              <Field label="Type">
                <SelectInput value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} options={VEHICLE_TYPES} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marque">
                <Input value={form.marque} onChange={v => setForm(f => ({ ...f, marque: v }))} placeholder="Renault" />
              </Field>
              <Field label="Modele">
                <Input value={form.modele} onChange={v => setForm(f => ({ ...f, modele: v }))} placeholder="D-Wide" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Capacite (m3)">
                <Input value={String(form.capaciteM3)} onChange={v => setForm(f => ({ ...f, capaciteM3: parseFloat(v) || 0 }))} type="number" min="0" step="0.5" />
              </Field>
              <Field label="Nb bennes">
                <Input value={String(form.nbBennes)} onChange={v => setForm(f => ({ ...f, nbBennes: parseInt(v) || 0 }))} type="number" min="0" />
              </Field>
              <Field label="Kilometrage">
                <Input value={String(form.kilometrage)} onChange={v => setForm(f => ({ ...f, kilometrage: parseInt(v) || 0 }))} type="number" min="0" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prochaine CT">
                <Input value={form.prochaineCT} onChange={v => setForm(f => ({ ...f, prochaineCT: v }))} type="date" />
              </Field>
              <Field label="Statut">
                <SelectInput value={form.statut} onChange={v => setForm(f => ({ ...f, statut: v as VehicleForm['statut'] }))} options={STATUT_OPTIONS} />
              </Field>
            </div>
            <Field label="Chauffeur assigne">
              <SelectInput value={form.assignedDriverId || ''} onChange={v => setForm(f => ({ ...f, assignedDriverId: v }))} options={[
                { value: '', label: '-- Aucun --' },
                ...activeDrivers.map(d => ({ value: d.id, label: `${d.firstName} ${d.lastName}` })),
              ]} />
            </Field>

            {}
            <div className="border-t border-surface-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Identification & technique</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Carburant">
                <SelectInput value={form.fuelType} onChange={v => setForm(f => ({ ...f, fuelType: v }))} options={FUEL_TYPE_OPTIONS} />
              </Field>
              <Field label="Annee de fabrication">
                <Input value={form.year === '' ? '' : String(form.year)} onChange={v => setForm(f => ({ ...f, year: v ? parseInt(v) || '' : '' }))} type="number" min="1900" max="2100" placeholder="2020" />
              </Field>
              <Field label="Couleur">
                <Input value={form.color} onChange={v => setForm(f => ({ ...f, color: v }))} placeholder="Blanc" />
              </Field>
            </div>
            <Field label="VIN (numero de serie)">
              <Input value={form.vin} onChange={v => setForm(f => ({ ...f, vin: v }))} placeholder="VF1AB12CD3E456789" />
            </Field>

            {}
            <div className="border-t border-surface-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">GPS</p>
            </div>
            <Field label="Identifiant traceur GPS">
              <Input value={form.gpsDeviceId} onChange={v => setForm(f => ({ ...f, gpsDeviceId: v }))} placeholder="GPS-001" />
            </Field>

            {}
            <div className="border-t border-surface-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Assurance</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiration assurance">
                <Input value={form.insuranceExpiry} onChange={v => setForm(f => ({ ...f, insuranceExpiry: v }))} type="date" />
              </Field>
              <Field label="Reference assurance">
                <Input value={form.insuranceRef} onChange={v => setForm(f => ({ ...f, insuranceRef: v }))} placeholder="POL-2024-XXXXX" />
              </Field>
            </div>

            {}
            <div className="border-t border-surface-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Dernier entretien</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date dernier entretien">
                <Input value={form.lastServiceDate} onChange={v => setForm(f => ({ ...f, lastServiceDate: v }))} type="date" />
              </Field>
              <Field label="Kilometrage dernier entretien">
                <Input value={form.lastServiceKm === '' ? '' : String(form.lastServiceKm)} onChange={v => setForm(f => ({ ...f, lastServiceKm: v ? parseInt(v) || '' : '' }))} type="number" min="0" placeholder="150000" />
              </Field>
            </div>

            {}
            <div className="border-t border-surface-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Gabarit vehicule</p>
              <p className="text-[10px] text-surface-400 mb-3">Determine les restrictions de route (ponts, tunnels, poids lourds)</p>
            </div>

            <Field label="Profil gabarit">
              <select
                value={form.gabaritProfile}
                onChange={e => applyProfile(e.target.value)}
                title="Profil gabarit vehicule"
                className="w-full bg-surface-50 border border-surface-200 rounded-lg px-3 py-2 text-surface-900 text-sm focus:outline-none focus:border-[#0055A4] focus:ring-1 focus:ring-[#0055A4]/30"
              >
                {GABARIT_PROFILES.map(p => (
                  <option key={p.key} value={p.key}>{p.label} — {p.description}</option>
                ))}
                <option value="custom">Personnalise</option>
              </select>
            </Field>

            {}
            <div className="bg-surface-50 border border-surface-200 rounded-lg p-3">
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-surface-400">Poids</span>
                  <span className="text-surface-700 font-mono font-semibold">{form.weightTon} t</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Hauteur</span>
                  <span className="text-surface-700 font-mono font-semibold">{form.heightM} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Largeur</span>
                  <span className="text-surface-700 font-mono font-semibold">{form.widthM} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Longueur</span>
                  <span className="text-surface-700 font-mono font-semibold">{form.lengthM} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Essieux</span>
                  <span className="text-surface-700 font-mono font-semibold">{form.axleCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">ADR</span>
                  <span className={`font-semibold ${form.hazmat ? 'text-amber-600' : 'text-surface-400'}`}>{form.hazmat ? 'Oui' : 'Non'}</span>
                </div>
              </div>
            </div>

            {}
            {isCustomProfile && (
              <div className="border border-dashed border-surface-300 rounded-lg p-3 space-y-3 bg-surface-50/50">
                <p className="text-[10px] text-surface-500 font-semibold uppercase tracking-wider">Dimensions personnalisees</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Poids total (tonnes)">
                    <Input value={String(form.weightTon)} onChange={v => setForm(f => ({ ...f, weightTon: parseFloat(v) || 0 }))} type="number" min="1" max="100" step="0.5" />
                  </Field>
                  <Field label="Hauteur (m)">
                    <Input value={String(form.heightM)} onChange={v => setForm(f => ({ ...f, heightM: parseFloat(v) || 0 }))} type="number" min="1" max="6" step="0.05" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Largeur (m)">
                    <Input value={String(form.widthM)} onChange={v => setForm(f => ({ ...f, widthM: parseFloat(v) || 0 }))} type="number" min="1" max="4" step="0.05" />
                  </Field>
                  <Field label="Longueur (m)">
                    <Input value={String(form.lengthM)} onChange={v => setForm(f => ({ ...f, lengthM: parseFloat(v) || 0 }))} type="number" min="2" max="30" step="0.5" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nombre d'essieux">
                    <Input value={String(form.axleCount)} onChange={v => setForm(f => ({ ...f, axleCount: parseInt(v) || 2 }))} type="number" min="2" max="10" />
                  </Field>
                  <Field label="Matieres dangereuses (ADR)">
                    <label className="flex items-center gap-2 cursor-pointer py-1">
                      <input type="checkbox" checked={form.hazmat} onChange={e => setForm(f => ({ ...f, hazmat: e.target.checked }))}
                        className="w-4 h-4 rounded border-surface-300 text-[#0055A4] focus:ring-[#0055A4]" />
                      <span className="text-sm text-surface-600">Hazmat (ADR)</span>
                    </label>
                  </Field>
                </div>
              </div>
            )}

            {}
            <div className="border-t border-surface-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Peages</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Classe peage">
                <SelectInput value={String(form.tollClass)} onChange={v => setForm(f => ({ ...f, tollClass: parseInt(v) || 3 }))} options={TOLL_CLASSES.map(c => ({ value: String(c.value), label: c.label }))} />
              </Field>
              <Field label="Badge telepeage">
                <SelectInput value={form.telepayBadge} onChange={v => {
                  const discount = TELEPAY_BADGES.find(b => b.value === v)
                  const pct = discount ? parseFloat(discount.label.match(/-(\d+)%/)?.[1] ?? '0') : 0
                  setForm(f => ({ ...f, telepayBadge: v, telepayDiscount: pct }))
                }} options={TELEPAY_BADGES} />
              </Field>
            </div>
            <Field label="Remise telepeage (%)">
              <Input value={String(form.telepayDiscount)} onChange={v => setForm(f => ({ ...f, telepayDiscount: parseFloat(v) || 0 }))} type="number" min="0" max="100" step="0.5" />
            </Field>

            <Field label="Notes">
              <Textarea value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Notes sur le vehicule..." rows={2} />
            </Field>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
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

      {maintenanceVehicle && (
        <VehicleMaintenanceModal
          vehicleId={maintenanceVehicle.id}
          vehicleName={maintenanceVehicle.name}
          onClose={() => setMaintenanceVehicle(null)}
        />
      )}

      {fuelVehicle && (
        <VehicleFuelModal
          vehicleId={fuelVehicle.id}
          vehicleName={fuelVehicle.name}
          onClose={() => setFuelVehicle(null)}
        />
      )}
    </div>
  )
}
