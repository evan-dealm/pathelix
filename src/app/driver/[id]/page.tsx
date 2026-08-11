'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { usePlanningStore } from '@/stores/planningStore'
import { calcTour } from '@/lib/algorithm'
import {
  type Driver, type PlannedMission,
} from '@/lib/types'
import { getMissionTypeIcon, getMissionTypeLabel } from '@/lib/trades'
import {
  enqueueAction, getSyncQueueSize, flushSyncQueue,
  cacheDayPlan, getCachedDayPlan, getQueuedActions,
} from '@/lib/syncQueue'
import { compressImage } from '@/lib/imageUtils'
import { useGpsTracking } from '@/hooks/useGpsTracking'
import { today } from '@/lib/dateUtils'
import { ScanTicketButton } from '@/components/driver/ScanTicketButton'

function minToHHMM(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60)
  const m = Math.floor(((min % 1440) + 1440) % 1440 % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function extractExpectedCode(accessNotes: string | null | undefined): string | null {
  const match = accessNotes?.match(/CODE:([A-Za-z0-9\-_]+)/)
  return match?.[1] ?? null
}

function _matchesCode(mission: PlannedMission, input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  const expected = extractExpectedCode(mission.accessNotes)
  if (expected) return trimmed.toLowerCase() === expected.toLowerCase()
  return true
}

type MissionStatus = 'todo' | 'en_route' | 'arrived' | 'started' | 'doing' | 'done'

const STATUS_FLOW: MissionStatus[] = ['todo', 'en_route', 'arrived', 'started', 'doing', 'done']

const STATUS_CONFIG: Record<MissionStatus, { label: string; icon: string; bg: string; next: string }> = {
  todo:     { label: 'En route',         icon: '\u{1F69B}', bg: 'bg-cyan-600 active:bg-cyan-700',    next: 'Demarrer le trajet' },
  en_route: { label: 'Arrive',           icon: '\u{1F4CD}', bg: 'bg-amber-500 active:bg-amber-600',  next: 'Je suis arrive' },
  arrived:  { label: 'Debut manoeuvre',   icon: '\u{2699}',  bg: 'bg-orange-500 active:bg-orange-600', next: 'Commencer la manoeuvre' },
  started:  { label: 'En cours',         icon: '\u{1F4AA}', bg: 'bg-blue-600 active:bg-blue-700',    next: 'Travail en cours' },
  doing:    { label: 'Termine',          icon: '\u2705',    bg: 'bg-green-600 active:bg-green-700',   next: 'Valider la mission' },
  done:     { label: 'Mission terminee', icon: '\u2705',    bg: 'bg-green-800',                       next: '' },
}

type DriverPlanResponse = {
  driver: Driver
  plan: PlannedMission[]
  startTime: string
  speedKmh: number
  date: string
  trade?: string | null
}

export default function DriverPage() {
  const params   = useParams()
  const searchParams = useSearchParams()
  const driverId = typeof params.id === 'string' ? params.id : ''
  const storePlans = usePlanningStore(s => s.plans)

  const [tourDate]   = useState(searchParams?.get('date') || today())

  useGpsTracking({ driverId, intervalMs: 30_000, enabled: Boolean(driverId) })
  const [apiData, setApiData]   = useState<DriverPlanResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)

  const [statuses, setStatuses] = useState<Record<string, MissionStatus>>({})
  const [isOnline, setIsOnline] = useState(true)
  const [pendingSync, setPendingSync] = useState(0)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [photos, setPhotos]     = useState<Record<string, string>>({})
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [signatures, setSignatures] = useState<Record<string, string>>({})
  const sigCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const sigDrawing = useRef<Record<string, boolean>>({})

  const updatePendingCount = useCallback(async () => {
    const count = await getSyncQueueSize()
    setPendingSync(count)
  }, [])

  const syncLock = useRef(false)
  const syncNow = useCallback(async () => {
    if (syncLock.current) return
    syncLock.current = true
    try {
      const synced = await flushSyncQueue()
      if (synced > 0) {
        setLastSynced(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
      }
      await updatePendingCount()
    } finally {
      syncLock.current = false
    }
  }, [updatePendingCount])

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const on  = () => { setIsOnline(true); void syncNow() }
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [syncNow])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'SYNC_COMPLETE') {
        void updatePendingCount()
        setLastSynced(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [updatePendingCount])

  useEffect(() => {
    const id = setInterval(async () => {
      await updatePendingCount()
      if (navigator.onLine) void syncNow()
    }, 15_000)
    return () => clearInterval(id)
  }, [syncNow, updatePendingCount])

  const storePlansRef = useRef(storePlans)
  useEffect(() => { storePlansRef.current = storePlans }, [storePlans])

  const loadData = useCallback(async (dId: string, date: string) => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch(`/api/driver-plan/${dId}?date=${date}`)
      if (!res.ok) {

        const cached = await getCachedDayPlan(dId, date)
        if (cached) {
          setApiData(cached as DriverPlanResponse)
          setLoading(false)
          return
        }
        const body: Record<string, unknown> = await res.json().catch(() => ({}))
        setApiError(typeof body.error === 'string' ? body.error : `Erreur ${res.status}`)
        setApiData(null)
        return
      }
      const data: DriverPlanResponse = await res.json()
      setApiData(data)

      void cacheDayPlan(dId, date, data)

      if (data.plan.length === 0) {
        const storePlan = storePlansRef.current[`${dId}|${date}`] ?? []
        if (storePlan.length > 0) setApiData(prev => prev ? { ...prev, plan: storePlan } : prev)
      }
    } catch {

      const cached = await getCachedDayPlan(dId, date)
      if (cached) {
        setApiData(cached as DriverPlanResponse)
      } else {
        setApiError('Impossible de contacter le serveur.')
        setApiData(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (driverId) loadData(driverId, tourDate)
  }, [driverId, tourDate, loadData])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`driver-status-${driverId}-${tourDate}`)
      if (raw) setStatuses(JSON.parse(raw))
    } catch {}
    void updatePendingCount()
  }, [driverId, tourDate, updatePendingCount])

  useEffect(() => {
    if (!driverId) return
    let cancelled = false

    const serverLoad = fetch(`/api/driver-photos?driverId=${encodeURIComponent(driverId)}&date=${encodeURIComponent(tourDate)}`)
      .then(r => r.ok ? r.json() as Promise<Record<string, string>> : Promise.resolve({} as Record<string, string>))
      .catch(() => ({} as Record<string, string>))

    // Restore photos/signatures taken offline but not yet synced
    const pendingLoad = getQueuedActions().then(actions => {
      const acc: Record<string, string> = {}
      for (const a of actions) {
        if (a.url === '/api/driver-photos' && a.body.driverId === driverId && a.body.date === tourDate) {
          const mid = a.body.missionId as string
          const url = a.body.dataUrl as string
          if (mid && url) acc[mid] = url
        }
      }
      return acc
    }).catch(() => ({} as Record<string, string>))

    Promise.all([serverLoad, pendingLoad]).then(([server, pending]) => {
      // Server URLs overwrite pending (photo already synced → use persisted URL)
      if (!cancelled) {
        setPhotos({ ...pending, ...server })
        // Restore signatures into state (key ends with _sig)
        const sigs: Record<string, string> = {}
        for (const [k, v] of Object.entries(pending)) {
          if (k.endsWith('_sig')) sigs[k.replace('_sig', '')] = v
        }
        if (Object.keys(sigs).length > 0) setSignatures(s => ({ ...sigs, ...s }))
      }
    })

    return () => { cancelled = true }
  }, [driverId, tourDate])

  const advanceStatus = useCallback((missionId: string) => {
    setStatuses(prev => {
      const cur = prev[missionId] ?? 'todo'
      const curIdx = STATUS_FLOW.indexOf(cur)
      if (curIdx >= STATUS_FLOW.length - 1) return prev

      const next = STATUS_FLOW[curIdx + 1]
      const updated = { ...prev, [missionId]: next }

      try { localStorage.setItem(`driver-status-${driverId}-${tourDate}`, JSON.stringify(updated)) } catch {}

      const timestamp = new Date().toISOString()
      const payload: Record<string, unknown> = {
        driverId, missionId, date: tourDate, status: next, timestamp,
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            payload.latitude = pos.coords.latitude
            payload.longitude = pos.coords.longitude
            void enqueueAction('/api/driver-status/update', payload)
            void updatePendingCount()
          },
          () => {
            void enqueueAction('/api/driver-status/update', payload)
            void updatePendingCount()
          },
          { timeout: 3000, enableHighAccuracy: false },
        )
      } else {
        void enqueueAction('/api/driver-status/update', payload)
        void updatePendingCount()
      }

      if (navigator.onLine) setTimeout(() => void syncNow(), 500)

      return updated
    })
  }, [driverId, tourDate, syncNow, updatePendingCount])

  const handlePhoto = useCallback((missionId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const rawUrl = ev.target?.result as string
      if (!rawUrl) return
      // Compress to max 1280px JPEG (reduces IDB storage + upload size)
      const dataUrl = await compressImage(rawUrl, 1280, 0.75)
      setPhotos(prev => ({ ...prev, [missionId]: dataUrl }))
      // Queue for reliable offline delivery — replayed automatically on reconnect
      void enqueueAction('/api/driver-photos', { driverId, date: tourDate, missionId, dataUrl })
      void updatePendingCount()
      if (navigator.onLine) setTimeout(() => void syncNow(), 500)
    }
    reader.readAsDataURL(file)
  }, [driverId, tourDate, updatePendingCount, syncNow])

  const driver    = apiData?.driver ?? null
  const startTime = apiData?.startTime ?? '07:00'
  const speed     = apiData?.speedKmh ?? 50

  const sorted = useMemo(
    () => [...(apiData?.plan ?? [])].sort((a, b) => a.sequenceOrder - b.sequenceOrder),
    [apiData?.plan],
  )

  const realMissions = useMemo(() => sorted.filter(m => !m.isSynthetic), [sorted])
  const doneMissions  = realMissions.filter(m => statuses[m.id] === 'done').length
  const totalMissions = realMissions.length

  const currentMission = useMemo(
    () => realMissions.find(m => (statuses[m.id] ?? 'todo') !== 'done') ?? null,
    [realMissions, statuses],
  )
  const currentIdx = currentMission ? realMissions.indexOf(currentMission) : -1

  const tourResult = useMemo(() => {
    if (!driver || sorted.length === 0) return null
    return calcTour(sorted, driver.depotLat, driver.depotLng, startTime, speed)
  }, [driver, sorted, startTime, speed])

  function mapsUrl(m: PlannedMission): string {
    if (m.latitude !== 0 || m.longitude !== 0) {
      return `https://www.google.com/maps/dir/?api=1&destination=${m.latitude},${m.longitude}`
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.address)}`
  }

  const [showAll, setShowAll] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">{'\u{1F69B}'}</div>
          <p className="text-zinc-400 text-lg">Chargement...</p>
        </div>
      </div>
    )
  }

  if (apiError || !driver) {
    return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-6xl mb-4">{'\u{1F69B}'}</div>
        <p className="text-zinc-300 text-xl font-bold">Chauffeur introuvable</p>
        <p className="text-zinc-600 mt-2">{apiError || `ID : ${driverId}`}</p>
      </div>
    </div>
    )
  }

  const progressPct = totalMissions > 0 ? Math.round((doneMissions / totalMissions) * 100) : 0
  const currentStatus = currentMission ? (statuses[currentMission.id] ?? 'todo') : 'done'
  const nextAction = currentMission ? STATUS_CONFIG[currentStatus] : null
  const stepForCurrent = currentMission && tourResult
    ? tourResult.steps[sorted.indexOf(currentMission)]
    : null

  return (
    <main id="main-content" className="min-h-screen bg-zinc-950 text-white select-none">

      {}
      <div className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2 backdrop-blur-sm border-b transition-colors duration-300 ${
        !isOnline        ? 'bg-red-950/95 border-red-800' :
        pendingSync > 0  ? 'bg-amber-950/95 border-amber-800' :
                           'bg-zinc-900/95 border-zinc-800'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-400 animate-pulse'}`} />
          <span className={`text-xs font-medium ${
            !isOnline ? 'text-red-300' : pendingSync > 0 ? 'text-amber-300' : 'text-zinc-400'
          }`}>
            {isOnline ? 'Connecte' : 'Hors ligne'}
          </span>
          {pendingSync > 0 && (
            <span className={`text-xs font-bold ml-1 ${isOnline ? 'text-amber-300' : 'text-red-300'}`}>
              · {pendingSync} en attente
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isOnline && pendingSync > 0 && (
            <button type="button" onClick={() => void syncNow()}
              className="text-[11px] bg-amber-600 active:bg-amber-700 text-white px-2.5 py-0.5 rounded-full font-bold transition">
              Sync
            </button>
          )}
          {lastSynced && (
            <span className={`text-[10px] ${!isOnline ? 'text-red-500' : 'text-zinc-600'}`}>
              Sync {lastSynced}
            </span>
          )}
          <span className={`text-xs font-medium ${!isOnline ? 'text-red-400' : 'text-zinc-500'}`}>
            {driver.firstName}
          </span>
        </div>
      </div>

      {}
      <div className="pt-12 px-5 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-zinc-400 text-sm font-medium">
            {new Date(tourDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}
          </span>
          <span className="text-2xl font-black">{doneMissions}/{totalMissions}</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex justify-between mt-1.5 text-[11px] text-zinc-500">
          <span>{tourResult ? `${Math.round(tourResult.totalRoadDistKm)} km` : ''}</span>
          <span>{progressPct}% termine</span>
        </div>
      </div>

      {}
      {currentMission && !showAll ? (
        <div className="px-5 pb-6">
          {}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl">
            {}
            <div className="bg-zinc-800/50 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{getMissionTypeIcon(apiData?.trade, currentMission.type)}</span>
                <span className="font-bold text-sm uppercase tracking-wide">{getMissionTypeLabel(apiData?.trade, currentMission.type)}</span>
                {currentMission.priority === 1 && (
                  <span className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Urgent</span>
                )}
              </div>
              <span className="text-zinc-500 text-sm font-mono">{currentIdx + 1}/{totalMissions}</span>
            </div>

            {}
            <div className="px-5 py-4 space-y-3">
              {}
              <div>
                <div className="text-xl font-bold leading-tight">
                  {currentMission.clientName || currentMission.outletName || 'Mission'}
                </div>
                <div className="text-zinc-400 text-sm mt-0.5">{currentMission.address}</div>
              </div>

              {}
              <div className="flex flex-wrap gap-2">
                {stepForCurrent && (
                  <span className="bg-blue-900/50 text-blue-300 text-sm font-bold px-3 py-1 rounded-full">
                    {minToHHMM(stepForCurrent.arrivalMin)}
                  </span>
                )}
                <span className="bg-zinc-800 text-zinc-300 text-sm px-3 py-1 rounded-full">
                  {currentMission.estimatedDurationMin + currentMission.maneuverTimeMin} min
                </span>
                {stepForCurrent && stepForCurrent.roadDistKm > 0 && (
                  <span className="bg-zinc-800 text-zinc-300 text-sm px-3 py-1 rounded-full">
                    {Math.round(stepForCurrent.roadDistKm * 10) / 10} km
                  </span>
                )}
                {currentMission.wasteTypeLabel && (
                  <span className="bg-zinc-800 text-zinc-300 text-sm px-3 py-1 rounded-full">
                    {currentMission.wasteTypeLabel}
                  </span>
                )}
              </div>

              {}
              {currentMission.timeWindow && (
                <div className="bg-amber-900/30 border border-amber-700/30 rounded-xl px-4 py-2 text-amber-300 text-sm font-medium">
                  Creneau : {minToHHMM(currentMission.timeWindow.openMin)} - {minToHHMM(currentMission.timeWindow.closeMin)}
                </div>
              )}

              {}
              {currentMission.accessNotes && (
                <div className="bg-yellow-900/30 border border-yellow-700/30 rounded-xl px-4 py-2 text-yellow-300 text-sm">
                  {currentMission.accessNotes}
                </div>
              )}

              {}
              {photos[currentMission.id] ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photos[currentMission.id]} alt="Photo" className="w-full h-32 object-cover rounded-xl" />
                  <button type="button" aria-label="Supprimer la photo" onClick={() => setPhotos(p => { const u = { ...p }; delete u[currentMission.id]; return u })}
                    className="absolute top-2 right-2 bg-black/70 text-white w-8 h-8 rounded-full text-lg">&times;</button>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    ref={el => { photoInputRefs.current[currentMission.id] = el }}
                    title="Prendre une photo"
                    aria-label="Prendre une photo"
                    onChange={e => handlePhoto(currentMission.id, e)} />
                  <button type="button" onClick={() => photoInputRefs.current[currentMission.id]?.click()}
                    className="w-full py-4 bg-zinc-800 rounded-xl text-zinc-300 text-lg font-bold active:bg-zinc-700 transition">
                    {'\u{1F4F7}'} Prendre une photo
                  </button>
                </div>
              )}

              {}
              {signatures[currentMission.id] ? (
                <div className="relative bg-white rounded-xl overflow-hidden border border-zinc-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signatures[currentMission.id]} alt="Signature" className="w-full h-24 object-contain" />
                  <button type="button" aria-label="Effacer la signature" onClick={() => setSignatures(s => { const u = { ...s }; delete u[currentMission.id]; return u })}
                    className="absolute top-2 right-2 bg-black/70 text-white w-8 h-8 rounded-full text-lg">&times;</button>
                  <div className="absolute bottom-1 left-2 text-[10px] text-zinc-400">Signature client</div>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden border border-zinc-700 bg-white">
                  <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-700">
                    <span className="text-zinc-400 text-sm">✍️ Signature client</span>
                    <button type="button"
                      onClick={() => {
                        const canvas = sigCanvasRefs.current[currentMission.id]
                        if (!canvas) return
                        const ctx = canvas.getContext('2d')
                        if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height) }
                      }}
                      className="text-zinc-500 text-xs active:text-zinc-300 transition">Effacer</button>
                  </div>
                  <canvas
                    ref={el => { sigCanvasRefs.current[currentMission.id] = el }}
                    width={340} height={100}
                    style={{ touchAction: 'none', display: 'block', width: '100%', height: 100, background: '#fff', cursor: 'crosshair' }}
                    onPointerDown={e => {
                      const canvas = sigCanvasRefs.current[currentMission.id]
                      if (!canvas) return
                      sigDrawing.current[currentMission.id] = true
                      canvas.setPointerCapture(e.pointerId)
                      const rect = canvas.getBoundingClientRect()
                      const ctx = canvas.getContext('2d')
                      if (!ctx) return
                      const scaleX = canvas.width / rect.width
                      const scaleY = canvas.height / rect.height
                      ctx.strokeStyle = '#111827'
                      ctx.lineWidth = 2.5
                      ctx.lineCap = 'round'
                      ctx.lineJoin = 'round'
                      ctx.beginPath()
                      ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY)
                    }}
                    onPointerMove={e => {
                      if (!sigDrawing.current[currentMission.id]) return
                      const canvas = sigCanvasRefs.current[currentMission.id]
                      if (!canvas) return
                      const rect = canvas.getBoundingClientRect()
                      const ctx = canvas.getContext('2d')
                      if (!ctx) return
                      const scaleX = canvas.width / rect.width
                      const scaleY = canvas.height / rect.height
                      ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY)
                      ctx.stroke()
                    }}
                    onPointerUp={() => {
                      sigDrawing.current[currentMission.id] = false
                      const canvas = sigCanvasRefs.current[currentMission.id]
                      if (!canvas) return
                      const sigUrl = canvas.toDataURL('image/png')
                      setSignatures(s => ({ ...s, [currentMission.id]: sigUrl }))
                      // Persist signature offline — same queue as photos, missionId_sig suffix
                      void enqueueAction('/api/driver-photos', {
                        driverId, date: tourDate, missionId: `${currentMission.id}_sig`, dataUrl: sigUrl,
                      })
                      void updatePendingCount()
                      if (navigator.onLine) setTimeout(() => void syncNow(), 500)
                    }}
                  />
                </div>
              )}
            </div>

            {}
            <div className="px-5 pb-5 space-y-3">
              {}
              <a href={mapsUrl(currentMission)} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full py-5 bg-blue-600 active:bg-blue-700 rounded-2xl text-white text-xl font-black transition shadow-lg shadow-blue-900/30">
                {'\u{1F5FA}'} NAVIGUER
              </a>

              {}
              {currentStatus !== 'done' && nextAction && (
                <button type="button" aria-label={nextAction.next} onClick={() => advanceStatus(currentMission.id)}
                  className={`w-full py-6 rounded-2xl text-white text-xl font-black transition shadow-lg ${nextAction.bg}`}>
                  <span className="text-2xl mr-2">{nextAction.icon}</span>
                  {nextAction.next.toUpperCase()}
                </button>
              )}

              {}
              <ScanTicketButton
                missionId={currentMission.id}
                driverId={driverId}
                missionType={currentMission.type}
                status={currentStatus}
              />
            </div>
          </div>

          {}
          <button type="button" onClick={() => setShowAll(true)}
            className="w-full mt-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 text-sm font-medium active:bg-zinc-800 transition">
            Voir toutes les missions ({totalMissions})
          </button>
        </div>
      ) : (

        <div className="px-5 pb-8 space-y-2">
          {currentMission && (
            <button type="button" onClick={() => setShowAll(false)}
              className="w-full mb-3 py-3 bg-blue-900/50 border border-blue-700/50 rounded-xl text-blue-300 text-sm font-bold active:bg-blue-800/50 transition">
              Revenir a la mission en cours
            </button>
          )}

          {realMissions.length === 0 && (
            <div className="text-center py-20">
              <div className="text-6xl mb-4">{'\u{1F4CB}'}</div>
              <p className="text-zinc-500 text-lg">Aucune mission pour aujourd&apos;hui</p>
            </div>
          )}

          {realMissions.map((m, idx) => {
            const st = statuses[m.id] ?? 'todo'
            const isDone = st === 'done'
            const isCurrent = m.id === currentMission?.id

            return (
              <div key={m.id}
                className={`rounded-xl border p-4 transition-all ${
                  isDone ? 'bg-zinc-900/40 border-zinc-800/50 opacity-50' :
                  isCurrent ? 'bg-blue-950/60 border-blue-700/50 shadow-lg' :
                  'bg-zinc-900 border-zinc-800'
                }`}>
                <div className="flex items-center gap-3">
                  {}
                  <button type="button" onClick={() => !isDone && advanceStatus(m.id)}
                    className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-black shrink-0 transition ${
                      isDone ? 'bg-green-700 text-white' :
                      st === 'doing' || st === 'started' ? 'bg-blue-600 text-white animate-pulse' :
                      st === 'en_route' ? 'bg-cyan-600 text-white' :
                      st === 'arrived' ? 'bg-amber-500 text-white' :
                      'bg-zinc-800 text-zinc-400 active:bg-zinc-600'
                    }`}>
                    {isDone ? '\u2713' : idx + 1}
                  </button>

                  {}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base truncate">
                      {m.clientName || m.outletName || m.address}
                    </div>
                    <div className="text-zinc-500 text-xs truncate">{m.address}</div>
                    <div className="flex gap-2 mt-1 text-xs text-zinc-500">
                      <span>{getMissionTypeIcon(apiData?.trade, m.type)} {getMissionTypeLabel(apiData?.trade, m.type)}</span>
                      <span>{m.estimatedDurationMin + m.maneuverTimeMin}min</span>
                      {m.priority === 1 && <span className="text-red-400 font-bold">P1</span>}
                    </div>
                  </div>

                  {}
                  <a href={mapsUrl(m)} target="_blank" rel="noopener noreferrer"
                    className="w-12 h-12 bg-blue-600 active:bg-blue-700 rounded-xl flex items-center justify-center text-xl shrink-0">
                    {'\u{1F5FA}'}
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {}
      {!currentMission && totalMissions > 0 && !showAll && (
        <div className="px-5 pb-8 text-center">
          <div className="text-7xl mb-4">{'\u{1F389}'}</div>
          <p className="text-3xl font-black text-green-400">Journee terminee !</p>
          <p className="text-zinc-500 mt-2">{totalMissions} mission{totalMissions > 1 ? 's' : ''} completee{totalMissions > 1 ? 's' : ''}</p>
          {pendingSync > 0 && (
            <p className="text-amber-400 text-sm mt-4">{pendingSync} action{pendingSync > 1 ? 's' : ''} en attente de synchronisation</p>
          )}
          <button type="button" onClick={() => setShowAll(true)}
            className="mt-6 py-3 px-6 bg-zinc-800 rounded-xl text-zinc-300 font-medium active:bg-zinc-700 transition">
            Voir le recapitulatif
          </button>
        </div>
      )}

      {}
      {tourResult && tourResult.warnings.length > 0 && (
        <div className="px-5 pb-6">
          <div className="bg-red-950/50 border border-red-800/30 rounded-xl p-4 space-y-1">
            {tourResult.warnings.map((w, i) => (
              <div key={i} className="text-sm text-red-300">{w.message}</div>
            ))}
          </div>
        </div>
      )}

      {}
      {!isOnline && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-red-950 border-t-2 border-red-700 px-5 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500" />
                </span>
                <span className="text-red-100 font-black text-base uppercase tracking-wide">Hors ligne</span>
              </div>
              <p className="text-red-400 text-xs mt-1 ml-6">
                {'\u{1F4CD}'} GPS actif
                {pendingSync > 0
                  ? ` · ${pendingSync} action${pendingSync > 1 ? 's' : ''} en file d’attente`
                  : ' · Actions sauvegardees localement'}
              </p>
            </div>
            <div className="text-4xl opacity-40">{'\u{1F4E1}'}</div>
          </div>
        </div>
      )}

      {}
      {!isOnline && <div className="h-20" />}
    </main>
  )
}
