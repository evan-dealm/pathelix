'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { calcTour } from '@/lib/algorithm'
import type { Driver, PlannedMission, Exutoire } from '@/lib/types'
import { getMissionTypeLabel } from '@/lib/trades'
import {
  enqueueAction, sendNow, flushSyncQueue, getQueueStatus, getQueuedActions,
  retryFailedAction, discardAction, cacheDayPlan, getCachedDayPlan, clearDriverDeviceData,
  type QueuedAction, type QueueMethod,
} from '@/lib/syncQueue'
import { MISSION_STATUSES, isMissionStatus, type MissionStatus } from '@/lib/missionStatus'
import { compressImage } from '@/lib/imageUtils'
import { useGpsTracking } from '@/hooks/useGpsTracking'
import { today } from '@/lib/dateUtils'
import { SyncBar } from '@/components/driver/SyncBar'
import { Sheet } from '@/components/driver/Sheet'
import { SignaturePad } from '@/components/driver/SignaturePad'
import { IncidentForm, NoteForm, WeightForm } from '@/components/driver/ReportForms'
import { ScanTicketButton } from '@/components/driver/ScanTicketButton'
import type { TicketReading } from '@/lib/ocr/ticket'
import { ContainerScanner } from '@/components/driver/ContainerScanner'
import type { DriverMissionContainers } from '@/lib/containers/driverInfo'
import type { ScanRole } from '@/lib/containers/scan'
import { STATUS_LABEL, INCIDENT_TYPES, minToHHMM, navigationUrl } from '@/components/driver/driverUi'

type DriverPlanResponse = {
  driver: Driver
  plan: PlannedMission[]
  statuses?: Record<string, MissionStatus>
  startTime: string
  speedKmh: number
  date: string
  trade?: string | null
  exutoires?: Exutoire[]
  /** Bins expected per mission (to check a scan offline). */
  containers?: Record<string, DriverMissionContainers>
}

type SheetKind = 'signature' | 'incident' | 'note' | 'weight' | 'scan' | 'logout' | null

const BIN_MISSION_TYPES = new Set(['POSER', 'RETIRER', 'ECHANGER', 'ALLER_RETOUR', 'CHARGER_IMMEDIAT', 'DEPLACER'])

// Each kind of stop has its own short field flow — a dump or a break is not a client job.
function flowFor(type: string): readonly MissionStatus[] {
  if (type === 'VIDER') return ['todo', 'en_route', 'arrived', 'done']
  if (type === 'PAUSE') return ['todo', 'started', 'done']
  return MISSION_STATUSES
}

function nextActionLabel(type: string, status: MissionStatus): string | null {
  const flow = flowFor(type)
  const next = flow[flow.indexOf(status) + 1]
  if (!next) return null
  if (type === 'PAUSE') return next === 'started' ? 'Commencer la pause' : 'Reprendre la route'
  if (type === 'VIDER' && next === 'done') return 'Vidage terminé'
  return {
    en_route: 'Démarrer le trajet', arrived: 'Je suis arrivé', started: 'Commencer la manœuvre',
    doing: 'Manœuvre terminée', done: 'Valider la mission', todo: '',
  }[next]
}

/** "Lundi 5 octobre" — sentence case, as French writes dates (CSS capitalize would also cap the month). */
function longDate(date: string): string {
  const s = new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const rank = (s: MissionStatus) => MISSION_STATUSES.indexOf(s)

/** Statuses only move forward: the furthest of the server's and this device's wins. */
function mergeStatuses(...sources: Array<Record<string, MissionStatus> | undefined>): Record<string, MissionStatus> {
  const out: Record<string, MissionStatus> = {}
  for (const src of sources) {
    for (const [id, st] of Object.entries(src ?? {})) {
      if (isMissionStatus(st) && (!out[id] || rank(st) > rank(out[id]))) out[id] = st
    }
  }
  return out
}

function readLocalStatuses(key: string): Record<string, MissionStatus> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') } catch { return {} }
}

function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
    () => resolve(null),
    { timeout: 3000, enableHighAccuracy: false, maximumAge: 60_000 },
  ))
}

export default function DriverPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const driverId = typeof params.id === 'string' ? params.id : ''
  const [tourDate] = useState(searchParams?.get('date') || today())
  const statusKey = `driver-status-${driverId}-${tourDate}`

  useGpsTracking({ driverId, intervalMs: 30_000, enabled: Boolean(driverId) })

  const [apiData, setApiData] = useState<DriverPlanResponse | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, MissionStatus>>({})
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [weights, setWeights] = useState<Record<string, number>>({})
  // Ticket readings awaiting the driver's confirmation, per step.
  const [readings, setReadings] = useState<Record<string, { jobId: string; reading: TicketReading }>>({})
  const [scans, setScans] = useState<Record<string, string[]>>({})
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ─── Sync state ────────────────────────────────────────────────────────────
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState<QueuedAction[]>([])
  const [authRequired, setAuthRequired] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)

  const refreshQueue = useCallback(async () => {
    try {
      const s = await getQueueStatus()
      setPending(s.pending)
      setFailed(s.failed)
    } catch { /* IndexedDB unavailable */ }
  }, [])

  const syncNow = useCallback(async () => {
    try {
      const r = await flushSyncQueue(driverId)
      setAuthRequired(r.authRequired)
      if (r.synced > 0) setLastSynced(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
    } catch { /* retried on the next tick */ }
    await refreshQueue()
  }, [driverId, refreshQueue])

  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => { setOnline(true); void syncNow() }
    const off = () => setOnline(false)
    const onQueue = () => { void refreshQueue() }
    const onSw = (e: MessageEvent) => {
      if (e.data?.type !== 'SYNC_COMPLETE') return
      if (e.data.authRequired) setAuthRequired(true)
      if (e.data.synced > 0) setLastSynced(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
      void refreshQueue()
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('pathelix:sync-queue', onQueue)
    navigator.serviceWorker?.addEventListener('message', onSw)
    const tick = setInterval(() => { if (navigator.onLine) void syncNow() }, 15_000)
    void syncNow()
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('pathelix:sync-queue', onQueue)
      navigator.serviceWorker?.removeEventListener('message', onSw)
      clearInterval(tick)
    }
  }, [syncNow, refreshQueue])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 3500)
  }, [])

  /**
   * Records an action: queued in IndexedDB (delivered now if online, later otherwise). If the
   * device can't store it, it is sent directly — and the driver is told if that fails too.
   */
  const record = useCallback(async (url: string, body: Record<string, unknown>, label: string, method: QueueMethod = 'POST') => {
    try {
      await enqueueAction(url, body, { method, ownerId: driverId, label })
      void refreshQueue()
      if (navigator.onLine) window.setTimeout(() => void syncNow(), 300)
      return true
    } catch {
      const ok = navigator.onLine && await sendNow(url, body, method)
      if (!ok) flash('Impossible d’enregistrer sur ce téléphone hors connexion — réessayez avec du réseau.')
      return ok
    }
  }, [driverId, refreshQueue, syncNow, flash])

  // ─── Loading ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    let res: Response
    try {
      res = await fetch(`/api/driver-plan/${encodeURIComponent(driverId)}?date=${tourDate}`, { cache: 'no-store' })
    } catch {
      // Network failure only: the last copy of today's tour stays usable offline.
      const cached = await getCachedDayPlan(driverId, tourDate).catch(() => null) as DriverPlanResponse | null
      if (cached) { setApiData(cached); setFromCache(true) }
      else setLoadError('Pas de réseau, et la tournée n’a pas encore été chargée sur ce téléphone.')
      setLoading(false)
      return
    }
    if (res.status === 401) {
      window.location.href = `/login?from=${encodeURIComponent(`/driver/${driverId}`)}`
      return
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: unknown }
      setLoadError(typeof body.error === 'string' ? body.error : `Erreur ${res.status}`)
      setLoading(false)
      return
    }
    const data = await res.json() as DriverPlanResponse
    setApiData(data)
    setFromCache(false)
    void cacheDayPlan(driverId, tourDate, data).catch(() => undefined)
    setLoading(false)
  }, [driverId, tourDate])

  useEffect(() => { if (driverId) void loadData() }, [driverId, loadData])

  // Server statuses + this device's not-yet-synced ones.
  useEffect(() => {
    if (!apiData) return
    setStatuses(mergeStatuses(apiData.statuses, readLocalStatuses(statusKey)))
  }, [apiData, statusKey])

  // Photos already on the server + those still waiting in the queue.
  useEffect(() => {
    if (!driverId) return
    let cancelled = false
    const server = fetch(`/api/driver-photos?driverId=${encodeURIComponent(driverId)}&date=${tourDate}`)
      .then(r => r.ok ? r.json() as Promise<Record<string, string>> : {})
      .catch(() => ({} as Record<string, string>))
    const queued = getQueuedActions().then(actions => {
      const acc: Record<string, string> = {}
      for (const a of actions) {
        if (a.url === '/api/driver-photos' && (a.method ?? 'POST') === 'POST' && a.body.driverId === driverId && a.body.date === tourDate) {
          acc[String(a.body.missionId)] = String(a.body.dataUrl)
        }
      }
      return acc
    }).catch(() => ({} as Record<string, string>))
    void Promise.all([server, queued]).then(([s, q]) => { if (!cancelled) setPhotos({ ...s, ...q }) })
    return () => { cancelled = true }
  }, [driverId, tourDate])

  // ─── Derived tour ──────────────────────────────────────────────────────────
  const driver = apiData?.driver ?? null
  const steps = useMemo(() => [...(apiData?.plan ?? [])].sort((a, b) => a.sequenceOrder - b.sequenceOrder), [apiData?.plan])
  const realMissions = useMemo(() => steps.filter(m => !m.isSynthetic), [steps])
  const doneCount = realMissions.filter(m => statuses[m.id] === 'done').length
  const current = useMemo(() => steps.find(m => (statuses[m.id] ?? 'todo') !== 'done') ?? null, [steps, statuses])
  const focused = steps.find(m => m.id === focusId) ?? current
  const exutoires = useMemo(() => apiData?.exutoires ?? [], [apiData])

  const tour = useMemo(() => {
    if (!driver || steps.length === 0) return null
    return calcTour(steps, driver.depotLat, driver.depotLng, apiData?.startTime ?? '07:00', apiData?.speedKmh ?? 50, exutoires.length > 0 ? exutoires : undefined)
  }, [driver, steps, apiData?.startTime, apiData?.speedKmh, exutoires])

  const stepOf = (m: PlannedMission) => tour?.steps[steps.indexOf(m)]

  // ─── Actions ───────────────────────────────────────────────────────────────
  const advance = useCallback(async (m: PlannedMission) => {
    const cur = statuses[m.id] ?? 'todo'
    const flow = flowFor(m.type)
    const next = flow[flow.indexOf(cur) + 1]
    if (!next) return
    const updated = { ...statuses, [m.id]: next }
    setStatuses(updated)
    try { localStorage.setItem(statusKey, JSON.stringify(updated)) } catch { /* storage blocked */ }

    const pos = await currentPosition()
    await record('/api/driver-status/update', {
      driverId, missionId: m.id, date: tourDate, status: next, timestamp: new Date().toISOString(),
      ...(pos ?? {}),
    }, `${m.clientName || m.outletName || getMissionTypeLabel(apiData?.trade, m.type)} : ${STATUS_LABEL[next].toLowerCase()}`)

    if (next === 'done') {
      setFocusId(null)
      if (m.type === 'VIDER') { setFocusId(m.id); setSheet('weight') }
    }
  }, [statuses, statusKey, record, driverId, tourDate, apiData?.trade])

  const onPhoto = useCallback(async (m: PlannedMission, file: File) => {
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const dataUrl = await compressImage(raw, 1280, 0.75)
    setPhotos(p => ({ ...p, [m.id]: dataUrl }))
    if (await record('/api/driver-photos', { driverId, date: tourDate, missionId: m.id, dataUrl }, 'Photo')) flash('Photo enregistrée')
  }, [record, driverId, tourDate, flash])

  const removePhoto = useCallback(async (m: PlannedMission) => {
    setPhotos(p => { const u = { ...p }; delete u[m.id]; return u })
    await record('/api/driver-photos', { driverId, date: tourDate, missionId: m.id }, 'Suppression de photo', 'DELETE')
  }, [record, driverId, tourDate])

  const onSignature = useCallback(async (m: PlannedMission, dataUrl: string) => {
    setSheet(null)
    setPhotos(p => ({ ...p, [`${m.id}_sig`]: dataUrl }))
    if (await record('/api/driver-photos', { driverId, date: tourDate, missionId: `${m.id}_sig`, dataUrl }, 'Signature client')) flash('Signature enregistrée')
  }, [record, driverId, tourDate, flash])

  const onIncident = useCallback(async (m: PlannedMission, incidentType: string, notes: string) => {
    setSheet(null)
    const label = INCIDENT_TYPES.find(t => t.value === incidentType)?.label ?? 'Incident'
    if (await record('/api/incidents', { missionId: m.id, incidentType, notes }, `Incident : ${label}`)) flash('Incident signalé au dispatch')
  }, [record, flash])

  const onNote = useCallback(async (m: PlannedMission, content: string) => {
    setSheet(null)
    if (await record('/api/mission-comments', { missionId: m.id, content }, 'Note')) flash('Note envoyée au dispatch')
  }, [record, flash])

  const onWeight = useCallback(async (m: PlannedMission, weightKg: number) => {
    setSheet(null)
    setWeights(w => ({ ...w, [m.id]: weightKg }))
    const ocrJobId = readings[m.id]?.jobId
    setReadings(r => { const u = { ...r }; delete u[m.id]; return u })
    if (await record('/api/driver-status/update', { driverId, missionId: m.id, date: tourDate, weightKg, ...(ocrJobId ? { ocrJobId } : {}) }, 'Poids du ticket de pesée')) {
      flash(`Poids enregistré : ${(weightKg / 1000).toLocaleString('fr-FR')} t`)
    }
  }, [record, driverId, tourDate, flash, readings])

  const onContainerScan = useCallback(async (m: PlannedMission, code: string, role: ScanRole, label: string) => {
    setSheet(null)
    setScans(s => ({ ...s, [m.id]: [...(s[m.id] ?? []), label] }))
    const pos = await currentPosition()
    if (await record('/api/driver-scan', {
      driverId, date: tourDate, missionId: m.id, code, role, scannedAt: new Date().toISOString(), ...(pos ?? {}),
    }, label)) flash(label)
  }, [record, driverId, tourDate, flash])

  const logout = useCallback(async (force: boolean) => {
    if (pending > 0 && !force) { setSheet('logout'); return }
    await clearDriverDeviceData().catch(() => undefined)
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHES' })
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    window.location.href = '/login'
  }, [pending])

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#1A1D21] text-white/60">
        <p role="status">Chargement de la tournée…</p>
      </main>
    )
  }

  if (loadError || !driver) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#1A1D21] p-6 text-center text-[#EDEEF0]">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">Tournée indisponible</h1>
          <p className="mt-2 text-white/60">{loadError ?? 'Chauffeur introuvable.'}</p>
          <button type="button" onClick={() => void loadData()} className="mt-6 min-h-12 rounded-xl bg-[#FFC21A] px-6 font-semibold text-black">Réessayer</button>
        </div>
      </main>
    )
  }

  const progress = realMissions.length > 0 ? Math.round((doneCount / realMissions.length) * 100) : 0
  const focusStatus = focused ? (statuses[focused.id] ?? 'todo') : 'done'
  const focusAction = focused ? nextActionLabel(focused.type, focusStatus) : null
  const focusStep = focused ? stepOf(focused) : undefined
  const isClientStop = focused && !focused.isSynthetic

  return (
    <main id="main-content" className="min-h-dvh bg-[#1A1D21] pb-40 font-display text-[#EDEEF0]">
      <SyncBar
        online={online}
        pending={pending}
        failed={failed}
        authRequired={authRequired}
        lastSynced={lastSynced}
        driverName={driver.firstName}
        loginHref={`/login?from=${encodeURIComponent(`/driver/${driverId}`)}`}
        onSyncNow={() => void syncNow()}
        onRetry={id => void retryFailedAction(id).then(syncNow)}
        onDiscard={id => void discardAction(id).then(refreshQueue)}
        onLogout={() => void logout(false)}
      />

      <section className="px-4 pt-4" aria-label="Avancement">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-white/60">{longDate(tourDate)}</p>
          <p className="text-sm tabular-nums text-white/60">
            <span className="text-2xl font-semibold text-white">{doneCount}</span>/{realMissions.length} missions
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Missions terminées">
          <div className="h-full rounded-full bg-[#2FBF71] transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        {fromCache && <p className="mt-2 text-xs text-[#FFD970]">Tournée affichée depuis la dernière copie enregistrée sur le téléphone.</p>}
      </section>

      {focused ? (
        <section className="px-4 pt-5" aria-labelledby="stop-title">
          <article className="rounded-3xl bg-[#262A30] p-5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-white/70">
                {focused.type === 'VIDER' ? 'Vidage' : focused.type === 'PAUSE' ? 'Pause' : getMissionTypeLabel(apiData?.trade, focused.type)}
                {focused.priority === 1 && <span className="ml-2 rounded-full bg-[#F0483E] px-2 py-0.5 text-xs font-semibold text-white">Urgent</span>}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">{STATUS_LABEL[focusStatus]}</span>
            </div>
            <h1 id="stop-title" className="mt-3 text-2xl font-semibold leading-tight">
              {focused.clientName || focused.outletName || (focused.type === 'PAUSE' ? 'Pause réglementaire' : 'Arrêt')}
            </h1>
            {focused.type !== 'PAUSE' && <p className="mt-1 text-base text-white/70">{focused.address}</p>}

            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-black/20 py-2">
                <dt className="text-xs text-white/50">Arrivée prévue</dt>
                <dd className="text-lg font-semibold tabular-nums">{focusStep ? minToHHMM(focusStep.arrivalMin) : '—'}</dd>
              </div>
              <div className="rounded-2xl bg-black/20 py-2">
                <dt className="text-xs text-white/50">Sur place</dt>
                <dd className="text-lg font-semibold tabular-nums">{focused.estimatedDurationMin + focused.maneuverTimeMin} min</dd>
              </div>
              <div className="rounded-2xl bg-black/20 py-2">
                <dt className="text-xs text-white/50">Trajet</dt>
                <dd className="text-lg font-semibold tabular-nums">{focusStep && focusStep.roadDistKm > 0 ? `${Math.round(focusStep.roadDistKm * 10) / 10} km` : '—'}</dd>
              </div>
            </dl>

            {focused.timeWindow && (
              <p className="mt-3 rounded-2xl border border-[#FFC21A]/40 px-3 py-2 text-sm text-[#FFD970]">
                Créneau client : {minToHHMM(focused.timeWindow.openMin)} – {minToHHMM(focused.timeWindow.closeMin)}
              </p>
            )}
            {(focused.wasteTypeLabel || focused.binSize) && (
              <p className="mt-3 text-sm text-white/70">{[focused.wasteTypeLabel, focused.binSize].filter(Boolean).join(' · ')}</p>
            )}
            {focused.accessNotes && (
              <p className="mt-3 rounded-2xl bg-black/20 px-3 py-2 text-sm"><span className="text-white/50">Accès : </span>{focused.accessNotes}</p>
            )}
            {(() => {
              const info = apiData?.containers?.[focused.id]
              if (!info || (!info.placed && !info.collected && !info.expected)) return null
              return (
                <p className="mt-3 rounded-2xl bg-black/20 px-3 py-2 text-sm">
                  {info.collected && <>À retirer : <strong>{info.collected.number}</strong>{info.placed || info.expected ? ' · ' : ''}</>}
                  {info.placed ? <>À poser : <strong>{info.placed.number}</strong> ({info.placed.capacityM3} m³)</>
                    : info.expected ? <>Benne à poser : {info.expected.typeName}</> : null}
                </p>
              )
            })()}
            {(scans[focused.id] ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-[#7EE2A8]">{scans[focused.id].map((s, i) => <li key={i}>✓ {s}</li>)}</ul>
            )}
            {weights[focused.id] !== undefined && (
              <p className="mt-3 text-sm text-[#7EE2A8]">Pesée : {(weights[focused.id] / 1000).toLocaleString('fr-FR')} t</p>
            )}

            {(photos[focused.id] || photos[`${focused.id}_sig`]) && (
              <div className="mt-4 flex gap-2">
                {photos[focused.id] && (
                  <figure className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data: URLs and authenticated /api/files URLs, not optimisable */}
                    <img src={photos[focused.id]} alt="Photo de l’intervention" className="h-20 w-28 rounded-xl object-cover" />
                    <button type="button" onClick={() => void removePhoto(focused)} aria-label="Supprimer la photo"
                      className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-black/80 text-lg">×</button>
                  </figure>
                )}
                {photos[`${focused.id}_sig`] && (
                  // eslint-disable-next-line @next/next/no-img-element -- same as above
                  <img src={photos[`${focused.id}_sig`]} alt="Signature du client" className="h-20 w-28 rounded-xl bg-white object-contain" />
                )}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {focused.type !== 'PAUSE' && (
                <a href={navigationUrl(focused)} target="_blank" rel="noopener noreferrer"
                  className="col-span-2 flex min-h-14 items-center justify-center rounded-2xl bg-white text-base font-semibold text-black sm:col-span-4">
                  Itinéraire
                </a>
              )}
              {isClientStop && BIN_MISSION_TYPES.has(focused.type) && (
                <button type="button" onClick={() => setSheet('scan')} className="col-span-2 min-h-12 rounded-2xl bg-[#FFC21A]/15 font-semibold text-[#FFD970] sm:col-span-4">
                  Scanner la benne
                </button>
              )}
              {isClientStop && (
                <>
                  <button type="button" onClick={() => photoInputRef.current?.click()} className="min-h-12 rounded-2xl bg-white/10 font-medium">Photo</button>
                  <button type="button" onClick={() => setSheet('signature')} className="min-h-12 rounded-2xl bg-white/10 font-medium">Signature</button>
                  <button type="button" onClick={() => setSheet('note')} className="min-h-12 rounded-2xl bg-white/10 font-medium">Note</button>
                  <button type="button" onClick={() => setSheet('incident')} className="min-h-12 rounded-2xl bg-[#F0483E]/20 font-medium text-[#FFB4AE]">Incident</button>
                </>
              )}
              {focused.type === 'VIDER' && (
                <button type="button" onClick={() => setSheet('weight')} className="col-span-2 min-h-12 rounded-2xl bg-white/10 font-medium sm:col-span-4">
                  {weights[focused.id] !== undefined ? 'Corriger le poids' : 'Saisir le ticket de pesée'}
                </button>
              )}
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Prendre une photo"
              onChange={e => { const f = e.target.files?.[0]; if (f && focused) void onPhoto(focused, f); e.target.value = '' }} />
          </article>
        </section>
      ) : realMissions.length > 0 ? (
        <section className="px-4 pt-8 text-center">
          <h1 className="text-3xl font-semibold text-[#7EE2A8]">Tournée terminée</h1>
          <p className="mt-2 text-white/60">{realMissions.length} mission{realMissions.length > 1 ? 's' : ''} réalisée{realMissions.length > 1 ? 's' : ''}.</p>
          {pending > 0 && <p className="mt-3 text-sm text-[#FFD970]">Gardez l’application ouverte avec du réseau : {pending} envoi{pending > 1 ? 's' : ''} en attente.</p>}
        </section>
      ) : (
        <section className="px-4 pt-8 text-center">
          <h1 className="text-xl font-semibold">Aucune mission ce jour</h1>
          <p className="mt-2 text-white/60">Votre tournée apparaîtra ici dès que le dispatch l’aura publiée.</p>
          <button type="button" onClick={() => void loadData()} className="mt-5 min-h-12 rounded-xl bg-white/10 px-5 font-semibold">Actualiser</button>
        </section>
      )}

      {tour && tour.warnings.length > 0 && (
        <section className="mx-4 mt-4 rounded-2xl border border-[#F0483E]/30 p-4 text-sm text-[#FFB4AE]" aria-label="Alertes de tournée">
          <ul className="space-y-1">{tour.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </section>
      )}

      {steps.length > 0 && (
        <section className="px-4 pt-6" aria-labelledby="route-title">
          <h2 id="route-title" className="mb-3 text-base font-semibold text-white/80">Ma tournée</h2>
          <ol className="relative space-y-2 before:absolute before:bottom-6 before:left-5 before:top-6 before:w-px before:bg-white/10">
            {steps.map((m, i) => {
              const st = statuses[m.id] ?? 'todo'
              const done = st === 'done'
              const isCurrent = m.id === current?.id
              const step = stepOf(m)
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setFocusId(m.id === current?.id ? null : m.id)}
                    aria-current={m.id === focused?.id ? 'step' : undefined}
                    className={`relative flex w-full items-center gap-3 rounded-2xl p-2 pr-3 text-left ${m.id === focused?.id ? 'bg-[#262A30]' : 'hover:bg-white/5'}`}
                  >
                    <span className={`z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums ${
                      done ? 'bg-[#2FBF71] text-black' : isCurrent ? 'bg-[#FFC21A] text-black' : m.isSynthetic ? 'bg-[#1A1D21] text-white/50 ring-1 ring-white/15' : 'bg-[#33383F] text-white'
                    }`} aria-hidden>
                      {done ? '✓' : m.type === 'VIDER' ? 'V' : m.type === 'PAUSE' ? 'P' : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${done ? 'text-white/40 line-through' : ''}`}>
                        {m.clientName || m.outletName || (m.type === 'PAUSE' ? 'Pause' : m.address)}
                      </span>
                      <span className="block truncate text-xs text-white/50">
                        {step ? minToHHMM(step.arrivalMin) : ''}{m.type !== 'PAUSE' ? ` · ${m.address}` : ''}
                      </span>
                    </span>
                    {!done && st !== 'todo' && <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs">{STATUS_LABEL[st]}</span>}
                    {m.priority === 1 && !done && <span className="shrink-0 text-xs font-semibold text-[#FF8A80]">Urgent</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {focused && focusAction && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#1A1D21] via-[#1A1D21] to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
          <button
            type="button"
            onClick={() => void advance(focused)}
            className="min-h-16 w-full rounded-2xl bg-[#FFC21A] text-xl font-semibold text-black shadow-[0_8px_24px_rgba(255,194,26,0.25)] active:scale-[0.99] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
          >
            {focusAction}
          </button>
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-4">
        {toast && <p className="rounded-full bg-black/85 px-4 py-2 text-sm text-white">{toast}</p>}
      </div>

      {focused && (
        <>
          <Sheet open={sheet === 'signature'} title="Signature du client" onClose={() => setSheet(null)}>
            {sheet === 'signature' && <SignaturePad onConfirm={url => void onSignature(focused, url)} onCancel={() => setSheet(null)} />}
          </Sheet>
          <Sheet open={sheet === 'incident'} title="Signaler un incident" onClose={() => setSheet(null)}>
            {sheet === 'incident' && <IncidentForm onSubmit={(t, n) => void onIncident(focused, t, n)} />}
          </Sheet>
          <Sheet open={sheet === 'note'} title="Note pour le dispatch" onClose={() => setSheet(null)}>
            {sheet === 'note' && <NoteForm onSubmit={c => void onNote(focused, c)} />}
          </Sheet>
          <Sheet open={sheet === 'scan'} title="Scanner la benne" onClose={() => setSheet(null)}>
            {sheet === 'scan' && (
              <ContainerScanner info={apiData?.containers?.[focused.id]} missionType={focused.type} driverId={driverId}
                onScan={(code, role, label) => void onContainerScan(focused, code, role, label)} />
            )}
          </Sheet>
          <Sheet open={sheet === 'weight'} title="Ticket de pesée" onClose={() => setSheet(null)}>
            {sheet === 'weight' && (
              <>
                <ScanTicketButton missionId={focused.id} onReading={(reading, jobId) => setReadings(r => ({ ...r, [focused.id]: { jobId, reading } }))} />
                <WeightForm key={readings[focused.id]?.jobId ?? 'manual'} initialKg={weights[focused.id]} suggestion={readings[focused.id]?.reading} onSubmit={kg => void onWeight(focused, kg)} />
              </>
            )}
          </Sheet>
        </>
      )}
      <Sheet open={sheet === 'logout'} title="Envois en attente" onClose={() => setSheet(null)}>
        <p className="text-white/70">
          {pending} action{pending > 1 ? 's n’ont' : ' n’a'} pas encore été envoyée{pending > 1 ? 's' : ''}. Si vous vous déconnectez maintenant, elle{pending > 1 ? 's seront perdues' : ' sera perdue'}.
        </p>
        <div className="mt-5 grid gap-2">
          <button type="button" onClick={() => { setSheet(null); void syncNow() }} className="min-h-12 rounded-xl bg-[#FFC21A] font-semibold text-black">Rester et envoyer</button>
          <button type="button" onClick={() => void logout(true)} className="min-h-12 rounded-xl bg-white/10 font-semibold">Se déconnecter quand même</button>
        </div>
      </Sheet>
    </main>
  )
}
