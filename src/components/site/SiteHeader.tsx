'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NAV_DIRECT, NAV_MENUS, inSection, type NavLink, type NavMenu } from '@/lib/site/nav'
import logo from '../../../public/logo-pathelix.png'

/** Delay before a hovered category opens, and grace period before a left menu closes (ms). */
const OPEN_DELAY = 70
const SWITCH_DELAY = 120
const CLOSE_DELAY = 180

/**
 * Website header: transparent over the top of the page, solid with a hairline once the visitor
 * scrolls or opens a menu.
 *
 * On a desk each category opens a sheet under the header — on hover (with a grace period, so
 * the pointer can travel from the label to the sheet), on click, and from the keyboard (Enter or
 * ↓ opens, Escape closes and returns to the label, Tab walks through the links). On small
 * screens the same categories become accordions inside a full panel.
 */
export function SiteHeader() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  /** The sheet fades in when it opens, not when the visitor slides from one category to the next. */
  const [fresh, setFresh] = useState(false)
  const [panel, setPanel] = useState(false)
  const [section, setSection] = useState<string | null>(null)

  const headerRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointer = useRef<string>('mouse')
  const menuRef = useRef<string | null>(null)
  menuRef.current = menu

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const show = useCallback(
    (id: string) => {
      cancel()
      setFresh(menuRef.current === null)
      setMenu(id)
    },
    [cancel],
  )

  const hide = useCallback(() => {
    cancel()
    setMenu(null)
  }, [cancel])

  const showSoon = (id: string) => {
    cancel()
    // With a sheet already open, a pointer heading down to it may cross the next label: the
    // switch waits a little longer than the first opening, and entering the sheet cancels it.
    timer.current = setTimeout(() => show(id), menu !== null ? SWITCH_DELAY : OPEN_DELAY)
  }

  const hideSoon = () => {
    cancel()
    timer.current = setTimeout(() => setMenu(null), CLOSE_DELAY)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => cancel, [cancel])

  // Following a link closes everything.
  useEffect(() => {
    hide()
    setPanel(false)
  }, [pathname, hide])

  // Desktop menu: Escape returns to the label, a click elsewhere closes.
  useEffect(() => {
    if (menu === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const trigger = headerRef.current?.querySelector<HTMLElement>(
        `[aria-controls="menu-${menu}"]`,
      )
      hide()
      trigger?.focus()
    }
    const onDown = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) hide()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [menu, hide])

  // Mobile panel: the page behind does not scroll, Escape closes, a desktop width closes.
  useEffect(() => {
    if (!panel) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanel(false)
        toggleRef.current?.focus()
      }
    }
    const wide = window.matchMedia('(min-width: 1024px)')
    const onWide = () => {
      if (wide.matches) setPanel(false)
    }
    window.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      root.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
    }
  }, [panel])

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key !== 'ArrowDown') return
    e.preventDefault()
    show(id)
    // The sheet is rendered on the next frame.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`#menu-${id} a`)?.focus()
    })
  }

  const solid = scrolled || panel || menu !== null

  return (
    <header
      ref={headerRef}
      onPointerLeave={e => {
        if (e.pointerType === 'mouse') hideSoon()
      }}
      onBlur={e => {
        // Tabbing out of the header closes the open sheet.
        if (menu !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) hide()
      }}
      className={`fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow] duration-200 ${
        solid ? 'bg-paper shadow-[0_1px_0_0_rgb(0_0_0/0.08)]' : 'bg-transparent'
      }`}
    >
      <div className="shell-wide flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="Pathélix, accueil"
          onPointerEnter={hideSoon}
        >
          <Image src={logo} alt="" width={28} height={28} className="rounded-[6px]" priority />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.03em]">Pathélix</span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden self-stretch lg:block">
          <ul className="flex h-full items-stretch">
            {NAV_MENUS.map(item => {
              const open = menu === item.id
              const current = inSection(pathname, item.sections)
              return (
                <li key={item.id} className="flex">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`menu-${item.id}`}
                    onPointerDown={e => {
                      pointer.current = e.pointerType
                    }}
                    onPointerEnter={e => {
                      if (e.pointerType === 'mouse') showSoon(item.id)
                    }}
                    onClick={e => {
                      // A mouse click on a category the hover has just opened must not close it.
                      const byMouse = e.detail > 0 && pointer.current === 'mouse'
                      if (open && !byMouse) hide()
                      else show(item.id)
                    }}
                    onKeyDown={e => onTriggerKey(e, item.id)}
                    className={`flex items-center gap-1.5 px-4 text-[0.9375rem] tracking-[-0.01em] transition-colors duration-150 hover:text-ink ${
                      open || current ? 'text-ink' : 'text-graphite'
                    }`}
                  >
                    {item.label}
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 10 10"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      className={`mt-px transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
                    >
                      <path d="M1.5 3.5 5 7l3.5-3.5" />
                    </svg>
                  </button>

                  <div
                    id={`menu-${item.id}`}
                    hidden={!open}
                    onPointerEnter={cancel}
                    className={`absolute inset-x-0 top-full border-t border-line bg-paper shadow-[0_28px_48px_-28px_rgb(0_0_0/0.28),0_1px_0_0_rgb(0_0_0/0.08)] ${
                      fresh ? 'menu-in' : ''
                    }`}
                  >
                    <MenuSheet menu={item} pathname={pathname} onNavigate={hide} />
                  </div>
                </li>
              )
            })}
            {NAV_DIRECT.map(item => (
              <li key={item.href} className="flex">
                <Link
                  href={item.href}
                  aria-current={item.href === pathname ? 'page' : undefined}
                  onPointerEnter={hideSoon}
                  className={`flex items-center px-4 text-[0.9375rem] tracking-[-0.01em] transition-colors duration-150 hover:text-ink ${
                    item.href === pathname ? 'text-ink' : 'text-graphite'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-5" onPointerEnter={hideSoon}>
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
            aria-expanded={panel}
            aria-controls="site-menu"
            onClick={() => setPanel(v => !v)}
          >
            <span className="sr-only">{panel ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
            <span aria-hidden="true" className="relative block h-3 w-5">
              <span
                className={`absolute left-0 top-0 h-px w-5 bg-ink transition-transform duration-200 ease-out ${
                  panel ? 'translate-y-[6px] rotate-45' : ''
                }`}
              />
              <span
                className={`absolute bottom-0 left-0 h-px w-5 bg-ink transition-transform duration-200 ease-out ${
                  panel ? '-translate-y-[5px] -rotate-45' : ''
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      <div
        id="site-menu"
        hidden={!panel}
        className="h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-line bg-paper lg:hidden"
      >
        <nav aria-label="Menu" className="shell-wide flex min-h-full flex-col pb-8 pt-2">
          <ul>
            {NAV_MENUS.map(item => {
              const open = section === item.id
              return (
                <li key={item.id} className="border-b border-line">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`section-${item.id}`}
                    onClick={() => setSection(open ? null : item.id)}
                    className="flex w-full items-center justify-between py-5 text-left text-[1.5rem] font-semibold leading-none tracking-[-0.03em]"
                  >
                    {item.label}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      className={`shrink-0 transition-transform duration-200 ease-out ${open ? 'rotate-45' : ''}`}
                    >
                      <path d="M8 1.5v13M1.5 8h13" />
                    </svg>
                  </button>
                  <div id={`section-${item.id}`} hidden={!open} className="pb-5">
                    {item.groups.map(group => (
                      <div key={group.title} className="mt-1 first:mt-0">
                        <p className="pb-1 pt-3 text-[0.8125rem] text-graphite">{group.title}</p>
                        <ul>
                          {group.links.map(link => (
                            <li key={link.href}>
                              <NavAnchor
                                link={link}
                                pathname={pathname}
                                onNavigate={() => setPanel(false)}
                                className="block py-2.5 text-[1.0625rem] tracking-[-0.015em]"
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </li>
              )
            })}
            {NAV_DIRECT.map(item => (
              <li key={item.href} className="border-b border-line">
                <NavAnchor
                  link={item}
                  pathname={pathname}
                  onNavigate={() => setPanel(false)}
                  className="block py-5 text-[1.5rem] font-semibold leading-none tracking-[-0.03em]"
                />
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-3 pt-10">
            <Link href="/contact" className="btn btn-primary" onClick={() => setPanel(false)}>
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

function NavAnchor({
  link,
  pathname,
  onNavigate,
  className,
  children,
}: {
  link: NavLink
  pathname: string
  onNavigate: () => void
  className: string
  children?: React.ReactNode
}) {
  return (
    <Link
      href={link.href}
      prefetch={link.app ? false : undefined}
      aria-current={link.href === pathname ? 'page' : undefined}
      onClick={onNavigate}
      className={className}
    >
      {children ?? link.label}
    </Link>
  )
}

/** Content of a desktop menu: the main groups on the left, the quieter side column on the right. */
function MenuSheet({
  menu,
  pathname,
  onNavigate,
}: {
  menu: NavMenu
  pathname: string
  onNavigate: () => void
}) {
  const main = menu.groups.filter(group => !group.aside)
  const aside = menu.groups.filter(group => group.aside)
  // One group of described links spreads over two columns; several groups sit side by side.
  const spread = main.length === 1 && main[0].links.length > 3

  return (
    <div className="shell-wide grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-x-16 pb-10 pt-8">
      <div className={`grid gap-x-12 ${main.length > 1 ? 'grid-cols-2' : ''}`}>
        {main.map(group => {
          const titleId = `menu-${menu.id}-${group.title.toLowerCase().replace(/\W+/g, '-')}`
          return (
            <div key={group.title}>
              <p id={titleId} className="text-[0.8125rem] text-graphite">
                {group.title}
              </p>
              <ul
                aria-labelledby={titleId}
                className={`-mx-3 mt-3 grid gap-x-6 gap-y-1 ${spread ? 'grid-cols-2' : ''}`}
              >
                {group.links.map(link => (
                  <li key={link.href}>
                    <NavAnchor
                      link={link}
                      pathname={pathname}
                      onNavigate={onNavigate}
                      className="block rounded px-3 py-2.5 transition-colors duration-150 hover:bg-mist aria-[current=page]:bg-mist"
                    >
                      <span className="block text-[0.9375rem] font-medium tracking-[-0.01em]">
                        {link.label}
                      </span>
                      {link.hint ? (
                        <span className="mt-0.5 block text-[0.8125rem] leading-[1.45] text-graphite">
                          {link.hint}
                        </span>
                      ) : null}
                    </NavAnchor>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <div className="border-l border-line pl-10">
        {aside.map(group => {
          const titleId = `menu-${menu.id}-${group.title.toLowerCase().replace(/\W+/g, '-')}`
          return (
            <div key={group.title}>
              <p id={titleId} className="text-[0.8125rem] text-graphite">
                {group.title}
              </p>
              <ul aria-labelledby={titleId} className="mt-3">
                {group.links.map(link => (
                  <li key={link.href}>
                    <NavAnchor
                      link={link}
                      pathname={pathname}
                      onNavigate={onNavigate}
                      className="block py-2 text-[0.9375rem] tracking-[-0.01em] text-carbon transition-colors duration-150 hover:text-accent aria-[current=page]:font-medium aria-[current=page]:text-ink"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
