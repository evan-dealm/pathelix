'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapLibreMap } from '@/hooks/useMapLibreMap'
import { STATUS_LABEL, type ContainerRow } from './shared'

const DOT: Record<string, string> = {
  AVAILABLE: '#10B981', RESERVED: '#38BDF8', IN_TRANSIT: '#6366F1', AT_CUSTOMER: '#0055A4', FULL: '#F59E0B',
  TO_COLLECT: '#F97316', AT_EXUTOIRE: '#14B8A6', MAINTENANCE: '#A78BFA', IMMOBILIZED: '#EF4444', LOST: '#B91C1C', ARCHIVED: '#CBD5E1',
}

/**
 * Bins with a known position. Several bins at one site are one marker with their count; the
 * list stays the accessible alternative (every bin is reachable from it).
 */
export function ContainersMap({ rows, onSelect }: { rows: ContainerRow[]; onSelect: (_id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { map, isStyleLoaded } = useMapLibreMap(ref, { center: [2.35, 46.6], zoom: 5 })
  const markers = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!map || !isStyleLoaded) return
    for (const m of markers.current) m.remove()
    markers.current = []
    const groups = new Map<string, ContainerRow[]>()
    for (const r of rows) {
      if (r.latitude === null || r.longitude === null) continue
      const key = `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`
      groups.set(key, [...(groups.get(key) ?? []), r])
    }
    const bounds = new maplibregl.LngLatBounds()
    for (const group of groups.values()) {
      const first = group[0]
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'grid place-items-center rounded-full text-[11px] font-semibold text-white shadow ring-2 ring-white'
      el.style.width = el.style.height = group.length > 1 ? '26px' : '18px'
      el.style.background = DOT[first.status] ?? '#64748B'
      el.textContent = group.length > 1 ? String(group.length) : ''
      const where = first.client?.name ?? first.site?.name ?? first.locationLabel
      el.setAttribute('aria-label', group.length > 1
        ? `${group.length} bennes — ${where}`
        : `Benne ${first.number}, ${STATUS_LABEL[first.status]} — ${where}`)
      el.title = group.map(g => `${g.number} (${STATUS_LABEL[g.status]})`).join('\n')
      el.addEventListener('click', () => onSelect(first.id))
      const marker = new maplibregl.Marker({ element: el }).setLngLat([first.longitude!, first.latitude!]).addTo(map)
      markers.current.push(marker)
      bounds.extend([first.longitude!, first.latitude!])
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 })
  }, [map, isStyleLoaded, rows, onSelect])

  return <div ref={ref} className="h-full w-full overflow-hidden rounded-xl ring-1 ring-surface-200" role="region" aria-label="Carte des bennes" />
}
