'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { PRIMARY_NAV } from '@/lib/site/config'
import logo from '../../../public/logo-pathelix.png'

/**
 * Website header: transparent over the top of the page, solid with a hairline once the visitor
 * scrolls. On small screens the navigation opens as a full panel (Escape closes it, focus returns
 * to the toggle).
 */
export function SiteHeader() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    // The panel is a small-screen affordance: growing the window back to desktop closes it.
    const wide = window.matchMedia('(min-width: 1024px)')
    const onWide = () => {
      if (wide.matches) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      root.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
    }
  }, [open])

  const solid = scrolled || open

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow] duration-200 ${
        solid
          ? 'bg-paper/95 shadow-[0_1px_0_0_rgb(0_0_0/0.08)] backdrop-blur-[6px]'
          : 'bg-transparent'
      }`}
    >
      <div className="shell-wide flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Pathélix, accueil">
          <Image src={logo} alt="" width={28} height={28} className="rounded-[6px]" priority />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.03em]">Pathélix</span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden lg:block">
          <ul className="flex items-center gap-8">
            {PRIMARY_NAV.map(item => {
              const current = item.href === pathname
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={`text-[0.9375rem] tracking-[-0.01em] transition-colors duration-150 hover:text-ink ${
                      current ? 'text-ink' : 'text-graphite'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-5">
          {/* The application has its own root layout: no prefetch of its bundle from the website. */}
          <Link
            href="/login"
            prefetch={false}
            className="hidden text-[0.9375rem] tracking-[-0.01em] text-graphite transition-colors duration-150 hover:text-ink sm:inline"
          >
            Connexion
          </Link>
          <Link href="/contact" className="btn btn-primary btn-sm">
            Demander une démo
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="-mr-2 flex h-11 w-11 items-center justify-center lg:hidden"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen(v => !v)}
          >
            <span className="sr-only">{open ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
            <span aria-hidden="true" className="relative block h-3 w-5">
              <span
                className={`absolute left-0 top-0 h-px w-5 bg-ink transition-transform duration-200 ease-out ${
                  open ? 'translate-y-[6px] rotate-45' : ''
                }`}
              />
              <span
                className={`absolute bottom-0 left-0 h-px w-5 bg-ink transition-transform duration-200 ease-out ${
                  open ? '-translate-y-[5px] -rotate-45' : ''
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      <div
        id="site-menu"
        hidden={!open}
        className="h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-paper lg:hidden"
      >
        <nav aria-label="Menu" className="shell-wide flex min-h-full flex-col pb-8 pt-6">
          <ul>
            {PRIMARY_NAV.map(item => (
              <li key={item.href} className="border-b border-line">
                <Link
                  href={item.href}
                  aria-current={item.href === pathname ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className="block py-5 text-[1.75rem] font-semibold leading-none tracking-[-0.035em]"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-3 pt-10">
            <Link href="/contact" className="btn btn-primary" onClick={() => setOpen(false)}>
              Demander une démo
            </Link>
            <Link href="/login" prefetch={false} className="btn btn-quiet">
              Connexion
            </Link>
          </div>
        </nav>
      </div>
    </header>
  )
}
