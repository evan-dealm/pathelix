'use client'

import { useState, useEffect } from 'react'
import { TL_START, TL_RANGE } from './types'
export { today } from '@/lib/dateUtils'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin')

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00')
}

export function displayFull(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function displayShort(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function displayMonth(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export function getWeekDays(dateStr: string): string[] {
  const d = parseDate(dateStr)
  const dow = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return day.toISOString().split('T')[0]
  })
}

export function getMonthWeeks(dateStr: string): string[][] {
  const d = parseDate(dateStr)
  const year = d.getFullYear()
  const month = d.getMonth()
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  const offset = (first.getDay() === 0 ? 6 : first.getDay() - 1)
  const days: string[] = []
  for (let i = offset - 1; i >= 0; i--) {
    const prev = new Date(first); prev.setDate(first.getDate() - i - 1)
    days.push(prev.toISOString().split('T')[0])
  }
  for (let i = 1; i <= last.getDate(); i++) {
    days.push(new Date(year, month, i).toISOString().split('T')[0])
  }
  while (days.length % 7 !== 0) {
    const lastDay = parseDate(days[days.length - 1])
    lastDay.setDate(lastDay.getDate() + 1)
    days.push(lastDay.toISOString().split('T')[0])
  }
  const weeks: string[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

export function sameMonth(dateStr: string, refStr: string): boolean {
  const d = parseDate(dateStr); const r = parseDate(refStr)
  return d.getFullYear() === r.getFullYear() && d.getMonth() === r.getMonth()
}

export function tlLeft(min: number): string {
  return `${Math.max(0, Math.min(100, ((min - TL_START) / TL_RANGE) * 100)).toFixed(3)}%`
}
export function tlWidth(min: number): string {
  return `${Math.max(0.3, (Math.max(0, min) / TL_RANGE) * 100).toFixed(3)}%`
}

export function minToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
export function hhmmToMin(v: string): number {
  const [h, m] = v.split(':').map(Number)
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return 420
  return (h ?? 0) * 60 + (m ?? 0)
}

export function mTitle(m: { clientName?: string; outletName?: string; address: string }): string {
  return m.clientName || m.outletName || m.address
}

export function logErr(context: string) {
  return (err: unknown) => {
    log.error(context, { err: err instanceof Error ? err.message : String(err) })
  }
}

// The API middleware caps every non-public request at 300/min per IP — shared across the
// whole admin SPA's background polling (driver-status, missions, plans...), not per-route. A
// CSV import firing its rows as a tight sequential POST loop can burn through that budget on
// its own past ~100 rows and start 429ing the rest, silently, on top of whatever polling is
// already running. Pace each row so a bulk import never floods faster than ~5 req/s.
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
