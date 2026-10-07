'use client'

import Image, { type StaticImageData } from 'next/image'
import { useEffect, useRef, useState } from 'react'

interface AutoClipProps {
  /** Base name under /site-media: `<name>-960.mp4` and `<name>-1600.mp4` exist. */
  name: string
  poster: StaticImageData
  /** What the excerpt shows, for someone who cannot see it. */
  description: string
  sizes: string
  className?: string
}

/**
 * A short silent excerpt of the official film. Nothing is downloaded until the excerpt comes
 * into view; it then loops muted and stops as soon as it leaves the screen. With « reduce
 * motion » it never starts by itself. The visitor can always pause it.
 */
export function AutoClip({ name, poster, description, sizes, className = '' }: AutoClipProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [wanted, setWanted] = useState(true)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setWanted(false)
    const box = boxRef.current
    if (!box) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.35,
    })
    io.observe(box)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const box = boxRef.current
    const video = videoRef.current
    if (!box || !video) return
    if (visible && wanted) {
      if (!src) {
        const pixels = box.clientWidth * Math.min(window.devicePixelRatio || 1, 2)
        setSrc(`/site-media/${name}-${pixels > 1000 ? 1600 : 960}.mp4`)
        return
      }
      video.play().catch(() => {
        /* autoplay refused (data saver, policy): the poster stays, the button still works */
      })
    } else {
      video.pause()
    }
  }, [visible, wanted, src, name])

  return (
    <div ref={boxRef} className={`frame frame-dark aspect-video ${className}`}>
      <Image src={poster} alt="" fill sizes={sizes} placeholder="blur" className="object-cover" />
      <video
        ref={videoRef}
        src={src ?? undefined}
        muted
        loop
        playsInline
        preload="none"
        aria-label={description}
        onPlaying={() => setStarted(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          started ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <button
        type="button"
        onClick={() => setWanted(v => !v)}
        className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink/70 text-paper ring-1 ring-paper/25 transition-colors duration-150 hover:bg-ink focus-visible:outline-paper"
      >
        <span className="sr-only">{wanted ? 'Mettre l’extrait en pause' : 'Lire l’extrait'}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
          {wanted ? (
            <>
              <rect x="2" y="1.5" width="2.6" height="9" />
              <rect x="7.4" y="1.5" width="2.6" height="9" />
            </>
          ) : (
            <path d="M3 1.2 10.5 6 3 10.8Z" />
          )}
        </svg>
      </button>
    </div>
  )
}
