'use client'

import { STATUS_LABEL, STATUS_TONE } from './shared'

export interface TypeAvailability {
  typeId: string
  name: string
  capacityM3: number
  total: number
  available: number
  reserved: number
  atCustomer: number
  inTransit: number
  outOfService: number
}

const SEGMENTS = [
  { key: 'available',    status: 'AVAILABLE' },
  { key: 'reserved',     status: 'RESERVED' },
  { key: 'inTransit',    status: 'IN_TRANSIT' },
  { key: 'atCustomer',   status: 'AT_CUSTOMER' },
  { key: 'outOfService', status: 'MAINTENANCE' },
] as const

/**
 * Where the fleet is, one bar per bin size: available / reserved / on a truck / at customers /
 * out of service. Clicking a size filters the list on it.
 */
export function FleetBars({ types, activeTypeId, onPickType }: {
  types: TypeAvailability[]
  activeTypeId: string
  onPickType: (_typeId: string) => void
}) {
  if (types.length === 0) return null
  return (
    <section aria-label="Disponibilité par type de benne" className="space-y-2">
      {types.map(t => {
        const active = activeTypeId === t.typeId
        return (
          <button key={t.typeId} type="button" onClick={() => onPickType(active ? '' : t.typeId)} aria-pressed={active}
            className={`group grid w-full grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-surface-100'}`}>
            <span className="truncate text-sm font-medium text-surface-800">{t.name}</span>
            <span className="flex h-2.5 overflow-hidden rounded-full bg-surface-100" aria-hidden>
              {SEGMENTS.map(s => {
                const n = t[s.key]
                if (n === 0 || t.total === 0) return null
                return <span key={s.key} className={STATUS_TONE[s.status].bar} style={{ width: `${(n / t.total) * 100}%` }} title={`${STATUS_LABEL[s.status]} : ${n}`} />
              })}
            </span>
            <span className="text-sm tabular-nums text-surface-600">
              <strong className={`font-display text-base font-semibold ${t.available === 0 ? 'text-red-600' : 'text-surface-900'}`}>{t.available}</strong>
              <span className="text-surface-400"> / {t.total} disponibles</span>
            </span>
          </button>
        )
      })}
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-surface-500">
        {SEGMENTS.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_TONE[s.status].bar}`} aria-hidden />
            {s.key === 'outOfService' ? 'Hors service' : STATUS_LABEL[s.status]}
          </span>
        ))}
      </p>
    </section>
  )
}
