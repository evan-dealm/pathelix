'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FILM } from '@/lib/site/config'
import poster from '@/assets/site/film-poster.png'

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The official Pathélix film. The page only carries a poster frame taken from the film itself;
 * the video file is requested when the visitor asks for it, then plays in a full-window dialog
 * with the browser's own controls (timeline, sound, full screen, keyboard). Chapters open the
 * film at the matching moment.
 */
export function Film() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const startAtRef = useRef(0)
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const play = useCallback((at: number, opener: HTMLElement) => {
    openerRef.current = opener
    startAtRef.current = at
    // A phone does not need the 1080p file; a laptop does.
    const pixels =
      Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2)
    setSrc(current => current ?? (pixels > 1500 ? FILM.sources.hd : FILM.sources.sd))
    setOpen(true)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    const video = videoRef.current
    if (!dialog || !video || !open || !src) return
    if (!dialog.open) dialog.showModal()
    document.documentElement.style.overflow = 'hidden'
    const begin = () => {
      video.currentTime = startAtRef.current
      video.play().catch(() => {
        /* the controls are there: the visitor presses play */
      })
    }
    if (video.readyState >= 1) begin()
    else video.addEventListener('loadedmetadata', begin, { once: true })
    video.focus()
    return () => video.removeEventListener('loadedmetadata', begin)
  }, [open, src])

  const close = useCallback(() => {
    videoRef.current?.pause()
    if (document.fullscreenElement) void document.exitFullscreen()
    if (dialogRef.current?.open) dialogRef.current.close()
    document.documentElement.style.overflow = ''
    setOpen(false)
    openerRef.current?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    const video = videoRef.current
    if (!video || e.target instanceof HTMLButtonElement) return
    const key = e.key.toLowerCase()
    if (key === ' ' || key === 'k') {
      e.preventDefault()
      if (video.paused) void video.play()
      else video.pause()
    } else if (key === 'arrowright' || key === 'arrowleft') {
      e.preventDefault()
      const next = video.currentTime + (key === 'arrowright' ? 5 : -5)
      video.currentTime = Math.min(Math.max(next, 0), video.duration || 0)
    } else if (key === 'm') {
      video.muted = !video.muted
    } else if (key === 'f') {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void video.requestFullscreen?.()
    }
  }

  const stage = 'w-full max-w-[min(100%,calc((100dvh-9rem)*16/9))]'

  return (
    <>
      <button
        type="button"
        onClick={e => play(0, e.currentTarget)}
        className="group relative block w-full overflow-hidden rounded-frame text-left shadow-[0_0_0_1px_rgb(255_255_255/0.14)]"
      >
        <span className="relative block aspect-video">
          <Image
            src={poster}
            alt=""
            fill
            sizes="(max-width: 1500px) 100vw, 1400px"
            placeholder="blur"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.015]"
          />
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper text-ink transition-transform duration-200 ease-out group-hover:scale-[1.08] group-active:scale-100 sm:h-20 sm:w-20">
            <svg
              viewBox="0 0 22 24"
              aria-hidden="true"
              fill="currentColor"
              className="ml-1 h-4 w-4 sm:h-5 sm:w-5"
            >
              <path d="M1 1.2 21 12 1 22.8Z" />
            </svg>
          </span>
        </span>
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-ink/80 to-transparent p-4 pt-16 sm:p-6 sm:pt-20">
          <span className="text-[0.9375rem] font-medium tracking-[-0.01em] text-paper sm:text-base">
            Voir Pathélix en action
          </span>
          <span className="t-num text-[0.8125rem] text-paper/75">
            {FILM.durationLabel}, avec le son
          </span>
        </span>
      </button>

      <ol className="mt-8 grid gap-x-10 border-t border-paper/15 sm:grid-cols-2 lg:grid-cols-3">
        {FILM.chapters.map(chapter => (
          <li key={chapter.at} className="border-b border-paper/15">
            <button
              type="button"
              onClick={e => play(chapter.at, e.currentTarget)}
              className="group/ch flex w-full items-baseline gap-4 py-3.5 text-left text-[0.9375rem] text-ash transition-colors duration-150 hover:text-paper"
            >
              <span className="t-num w-9 shrink-0 text-paper/60 transition-colors duration-150 group-hover/ch:text-paper">
                {clock(chapter.at)}
              </span>
              <span>
                <span className="sr-only">Lire le film à partir de : </span>
                {chapter.label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <dialog
        ref={dialogRef}
        aria-label="Film de présentation Pathélix"
        onCancel={e => {
          e.preventDefault()
          close()
        }}
        onKeyDown={onKeyDown}
        className="film on-dark fixed inset-0 m-0 h-dvh w-screen bg-transparent p-0 text-paper"
      >
        {open && (
          // Clicking the dark area around the film closes it, like the Fermer button and Escape.
          <div
            onClick={e => {
              if (e.target === e.currentTarget) close()
            }}
            className="dialog-in flex h-full w-full flex-col items-center justify-center gap-4 p-3 sm:p-8"
          >
            <div className={`flex items-center justify-between ${stage}`}>
              <p className="text-[0.9375rem] font-medium tracking-[-0.01em]">Pathélix en action</p>
              <button type="button" onClick={close} className="btn btn-outline btn-sm">
                Fermer
              </button>
            </div>
            <video
              ref={videoRef}
              src={src ?? undefined}
              controls
              playsInline
              preload="metadata"
              className={`aspect-video rounded-frame bg-ink shadow-[0_0_0_1px_rgb(255_255_255/0.14)] focus-visible:outline-paper ${stage}`}
            >
              <track
                kind="chapters"
                src={FILM.chaptersTrack}
                srcLang="fr"
                label="Chapitres"
                default
              />
            </video>
          </div>
        )}
      </dialog>
    </>
  )
}
