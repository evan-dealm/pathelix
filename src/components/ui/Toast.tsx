'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
  duration: number
}

interface ToastContextValue {
  toast: (_message: string, _type?: ToastType, _duration?: number) => void
  success: (_message: string) => void
  error: (_message: string) => void
  warning: (_message: string) => void
  info: (_message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [exiting, setExiting] = useState<Set<string>>(new Set())
  const counterRef = useRef(0)

  const removeToast = useCallback((id: string) => {
    setExiting(prev => new Set(prev).add(id))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      setExiting(prev => { const next = new Set(prev); next.delete(id); return next })
    }, 300)
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info', duration: number = 4000) => {
    const id = `toast-${++counterRef.current}`
    setToasts(prev => [...prev.slice(-4), { id, type, message, duration }])

    const dismissMs = duration > 0 ? duration : 60_000
    setTimeout(() => removeToast(id), dismissMs)
  }, [removeToast])

  const value: ToastContextValue = {
    toast: addToast,
    success: useCallback((msg: string) => addToast(msg, 'success', 3000), [addToast]),
    error: useCallback((msg: string) => addToast(msg, 'error', 5000), [addToast]),
    warning: useCallback((msg: string) => addToast(msg, 'warning', 4000), [addToast]),
    info: useCallback((msg: string) => addToast(msg, 'info', 3000), [addToast]),
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const { type, message } = (e as CustomEvent).detail ?? {}
      if (message) addToast(message, type || 'error', 5000)
    }
    window.addEventListener('pathelix:toast', handler)
    return () => window.removeEventListener('pathelix:toast', handler)
  }, [addToast])

  const iconMap: Record<ToastType, string> = {
    success: '✓',
    error: '!',
    warning: '!',
    info: 'i',
  }

  const styleMap: Record<ToastType, string> = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-300',
    warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300',
  }

  const iconStyleMap: Record<ToastType, string> = {
    success: 'bg-emerald-500 text-white',
    error: 'bg-red-500 text-white',
    warning: 'bg-amber-500 text-white',
    info: 'bg-blue-500 text-white',
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-elevated max-w-sm
              transition-all duration-300
              ${exiting.has(t.id) ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0 animate-slide-in'}
              ${styleMap[t.type]}`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${iconStyleMap[t.type]}`}>
              {iconMap[t.type]}
            </span>
            <span className="text-sm font-medium flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="flex-shrink-0 text-current opacity-40 hover:opacity-70 transition-opacity"
              aria-label="Fermer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 4L4 10M4 4l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
