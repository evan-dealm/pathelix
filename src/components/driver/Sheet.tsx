'use client'

import { useEffect, useRef } from 'react'

interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * Bottom sheet built on the native <dialog>: focus is trapped and restored by the browser,
 * Escape closes it, the backdrop is inert — no hand-rolled focus management.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Very old WebViews lack showModal(): fall back to a non-modal open dialog.
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
    if (!open && el.open) {
      if (typeof el.close === 'function') el.close()
      else el.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      className="m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-black/60 sm:mx-auto sm:mb-6 sm:max-w-lg"
    >
      <div className="rounded-t-3xl border-t border-white/10 bg-[#262A30] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-[#EDEEF0] sm:rounded-3xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/15" aria-hidden />
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="sheet-title" className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-white/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFC21A]"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
