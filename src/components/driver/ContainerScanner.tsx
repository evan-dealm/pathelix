'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseScannedCode, validateScan, type ScanRole, type ScannedContainer } from '@/lib/containers/scan'
import type { DriverMissionContainers } from '@/lib/containers/driverInfo'

type Candidate = ScannedContainer & { token: string }

interface BarcodeDetectorLike { detect(_source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type BarcodeDetectorCtor = new (_opts?: { formats?: string[] }) => BarcodeDetectorLike

/** Finds the scanned bin among those the app knows for this mission (works offline). */
export function findCandidate(info: DriverMissionContainers | undefined, code: string): Candidate | null {
  if (!info) return null
  const parsed = parseScannedCode(code)
  const pool = [info.placed, info.collected, ...info.onSite].filter((c): c is Candidate => !!c)
  return pool.find(c => (parsed.token && c.token === parsed.token) || (parsed.number && c.number.toUpperCase() === parsed.number)) ?? null
}

/**
 * Scan of a bin on a mission: camera (BarcodeDetector where the browser has it, jsQR otherwise)
 * or the fleet number typed by hand. Known bins are checked right away against the mission (wrong
 * bin, size, customer); the scan is then queued like every field action and confirmed by the server.
 */
export function ContainerScanner({ info, missionType, driverId, onScan }: {
  info:        DriverMissionContainers | undefined
  missionType: string
  driverId:    string
  onScan:      (_code: string, _role: ScanRole, _label: string) => void
}) {
  const both = missionType === 'ECHANGER' || missionType === 'DEPLACER'
  const [role, setRole] = useState<ScanRole>(missionType === 'POSER' ? 'place' : 'collect')
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'unavailable'>('off')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  const doneRef = useRef(false)

  const stop = useCallback(() => {
    if (loopRef.current !== null) cancelAnimationFrame(loopRef.current)
    loopRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => stop, [stop])

  const submit = useCallback((code: string) => {
    if (doneRef.current || !code.trim()) return
    setError('')
    const c = findCandidate(info, code)
    if (c && info) {
      const verdict = validateScan(info.mission, c, role, driverId)
      if (!verdict.ok) { setError(verdict.message); return }
      doneRef.current = true
      stop()
      onScan(code, role, `Benne ${c.number} (${c.capacityM3} m³) ${role === 'place' ? 'posée' : 'retirée'}`)
      return
    }
    // Not known on this phone (offline list incomplete): the server checks it at sync time.
    doneRef.current = true
    stop()
    onScan(code, role, `Benne ${code.trim()} — vérification à la synchronisation`)
  }, [info, role, driverId, onScan, stop])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); return }
    setCamera('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stop(); return }
      video.srcObject = stream
      await video.play()
      setCamera('on')
      const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      const detector = Ctor ? new Ctor({ formats: ['qr_code', 'code_128', 'code_39'] }) : null
      const jsQR = detector ? null : (await import('jsqr')).default
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const tick = async () => {
        if (doneRef.current || !streamRef.current) return
        try {
          if (detector) {
            const codes = await detector.detect(video)
            if (codes[0]?.rawValue) { submit(codes[0].rawValue); return }
          } else if (jsQR && ctx && video.videoWidth > 0) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const found = jsQR(img.data, img.width, img.height)
            if (found?.data) { submit(found.data); return }
          }
        } catch { /* frame not ready */ }
        loopRef.current = requestAnimationFrame(() => { void tick() })
      }
      void tick()
    } catch {
      stop()
      setCamera('unavailable')
    }
  }, [stop, submit])

  const expected = role === 'place' ? info?.placed : info?.collected
  return (
    <div className="space-y-4">
      {both && (
        <div role="radiogroup" aria-label="Benne scannée" className="grid grid-cols-2 gap-2">
          {(['collect', 'place'] as const).map(r => (
            <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => { setRole(r); setError('') }}
              className={`min-h-12 rounded-xl font-semibold ${role === r ? 'bg-[#FFC21A] text-black' : 'bg-white/10'}`}>
              {r === 'collect' ? 'Benne retirée' : 'Benne posée'}
            </button>
          ))}
        </div>
      )}
      <p className="text-sm text-white/70">
        {expected
          ? <>Benne prévue : <strong className="text-white">{expected.number}</strong> ({expected.capacityM3} m³)</>
          : info?.expected
            ? <>Type attendu : <strong className="text-white">{info.expected.typeName}</strong> ({info.expected.capacityM3} m³)</>
            : 'Scannez le QR code de la benne.'}
      </p>

      <div className="overflow-hidden rounded-2xl bg-black/40">
        <video ref={videoRef} playsInline muted className={`aspect-video w-full object-cover ${camera === 'on' ? '' : 'hidden'}`} aria-label="Caméra" />
        {camera !== 'on' && (
          <button type="button" onClick={() => void startCamera()} disabled={camera === 'starting'}
            className="min-h-16 w-full rounded-2xl bg-white text-lg font-semibold text-black disabled:opacity-60">
            {camera === 'starting' ? 'Ouverture de la caméra…' : 'Scanner le QR code'}
          </button>
        )}
      </div>
      {camera === 'unavailable' && <p className="text-sm text-[#FFD970]">Caméra indisponible : saisissez le numéro peint sur la benne.</p>}

      <form onSubmit={e => { e.preventDefault(); submit(manual) }} className="flex gap-2">
        <label className="sr-only" htmlFor="container-number">Numéro de benne</label>
        <input id="container-number" value={manual} onChange={e => setManual(e.target.value)} placeholder="N° de benne (ex. B-00482)"
          autoCapitalize="characters" className="min-h-12 flex-1 rounded-xl bg-white/10 px-3 text-base text-white placeholder:text-white/40" />
        <button type="submit" disabled={!manual.trim()} className="min-h-12 rounded-xl bg-white/15 px-4 font-semibold disabled:opacity-40">Valider</button>
      </form>
      {error && <p role="alert" className="rounded-xl bg-[#F0483E]/20 px-3 py-2 text-sm text-[#FFB4AE]">{error}</p>}
    </div>
  )
}
