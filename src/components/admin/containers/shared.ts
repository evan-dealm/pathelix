import { STATUS_LABEL, type ContainerStatus } from '@/lib/containers/lifecycle'

export { STATUS_LABEL }

/** Status chip colours — semantic, shared by the list, the detail panel and the fleet bars. */
export const STATUS_TONE: Record<ContainerStatus, { chip: string; bar: string }> = {
  AVAILABLE:   { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-500' },
  RESERVED:    { chip: 'bg-sky-50 text-sky-700 ring-sky-200',             bar: 'bg-sky-400' },
  IN_TRANSIT:  { chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200',    bar: 'bg-indigo-500' },
  AT_CUSTOMER: { chip: 'bg-surface-100 text-surface-700 ring-surface-200', bar: 'bg-[#0055A4]' },
  FULL:        { chip: 'bg-amber-50 text-amber-800 ring-amber-200',       bar: 'bg-amber-500' },
  TO_COLLECT:  { chip: 'bg-orange-50 text-orange-800 ring-orange-200',    bar: 'bg-orange-500' },
  AT_EXUTOIRE: { chip: 'bg-teal-50 text-teal-700 ring-teal-200',          bar: 'bg-teal-500' },
  MAINTENANCE: { chip: 'bg-violet-50 text-violet-700 ring-violet-200',    bar: 'bg-violet-400' },
  IMMOBILIZED: { chip: 'bg-red-50 text-red-700 ring-red-200',             bar: 'bg-red-500' },
  LOST:        { chip: 'bg-red-100 text-red-800 ring-red-300',            bar: 'bg-red-700' },
  ARCHIVED:    { chip: 'bg-surface-50 text-surface-400 ring-surface-200', bar: 'bg-surface-300' },
}

export interface ContainerRow {
  id: string
  number: string
  qrToken: string
  status: ContainerStatus
  condition: string
  locationLabel: string
  placedAt: string | null
  lastRotationAt: string | null
  lastMovementAt: string | null
  latitude: number | null
  longitude: number | null
  daysOnSite: number | null
  type: { id: string; name: string; capacityM3: number }
  client: { id: string; name: string } | null
  site: { id: string; name: string; address: string } | null
}

export interface ContainerTypeRow {
  id: string
  name: string
  capacityM3: number
  tareKg: number | null
  dailyRentalPrice: number | null
  lengthM: number | null
  widthM: number | null
  heightM: number | null
  allowedMaterials: string[]
  counts: Partial<Record<ContainerStatus, number>>
}

export function frDate(d: string | null | undefined): string {
  if (!d) return '—'
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function whereLabel(c: Pick<ContainerRow, 'client' | 'site' | 'locationLabel'>): string {
  if (c.client || c.site) return [c.client?.name, c.site?.name].filter(Boolean).join(' — ')
  return c.locationLabel || '—'
}

/** URL printed in the QR code: any camera opens /c/<token>, the driver app reads the token. */
export function qrUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/c/${token}`
}
