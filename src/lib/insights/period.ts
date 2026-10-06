import { unprocessable } from '@/lib/api/route'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Reads ?from&to (defaults: the last 30 days), at most one year. */
export function periodFrom(sp: URLSearchParams): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  const to = sp.get('to') ?? today
  const from = sp.get('from') ?? new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw unprocessable('Période invalide (from ≤ to, AAAA-MM-JJ)', 'PERIOD')
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw unprocessable('Période limitée à un an', 'PERIOD')
  return { from, to }
}
