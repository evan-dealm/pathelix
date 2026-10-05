'use client'

import { useRef, useState } from 'react'

interface SignaturePadProps {
  /** Called once with a PNG data URL when the client confirms — never on every stroke. */
  onConfirm: (_dataUrl: string) => void
  onCancel: () => void
}

export function SignaturePad({ onConfirm, onCancel }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const { x, y } = point(e)
    ctx.strokeStyle = '#111418'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = point(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!hasInk) setHasInk(true)
  }

  function clear() {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  return (
    <div>
      <p className="mb-3 text-sm text-white/60">Faites signer le client dans le cadre.</p>
      <canvas
        ref={canvasRef}
        width={680}
        height={260}
        aria-label="Zone de signature du client"
        className="block h-44 w-full touch-none rounded-2xl bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => { drawing.current = false }}
        onPointerCancel={() => { drawing.current = false }}
      />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl bg-white/10 font-semibold">Annuler</button>
        <button type="button" onClick={clear} disabled={!hasInk} className="min-h-12 rounded-xl bg-white/10 font-semibold disabled:opacity-40">Effacer</button>
        <button
          type="button"
          disabled={!hasInk}
          onClick={() => canvasRef.current && onConfirm(canvasRef.current.toDataURL('image/png'))}
          className="min-h-12 rounded-xl bg-[#FFC21A] font-semibold text-black disabled:opacity-40"
        >
          Valider
        </button>
      </div>
    </div>
  )
}
