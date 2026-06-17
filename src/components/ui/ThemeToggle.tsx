'use client'

import { useState, useEffect } from 'react'

export function useTheme() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark') {
      setDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  function toggle() {
    setDark(prev => {
      const next = !prev
      if (next) {
        document.documentElement.classList.add('dark')
        localStorage.setItem('theme', 'dark')
      } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('theme', 'light')
      }
      return next
    })
  }

  return { dark, toggle }
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme()

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Mode clair' : 'Mode sombre'}
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.4 3.4l1.4 1.4M13.2 13.2l1.4 1.4M3.4 14.6l1.4-1.4M13.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.5 10.5a6.5 6.5 0 01-8-8A6.5 6.5 0 1015.5 10.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
      )}
    </button>
  )
}
