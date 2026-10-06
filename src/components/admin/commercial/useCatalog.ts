'use client'

import { useEffect, useState } from 'react'
import { apiRequest, fetchAllPages } from '@/lib/apiClient'

export interface CatalogData {
  clients:        Array<{ id: string; name: string; email: string; clientSites?: Array<{ site: { id: string; name: string; address: string; zipCode?: string } }> }>
  containerTypes: Array<{ id: string; name: string; capacityM3: number }>
  materials:      Array<{ id: string; name: string }>
  loading:        boolean
}

let cache: { at: number; data: Omit<CatalogData, 'loading'> } | null = null

/** Customers (with sites), bin types and materials for the commercial editors — cached 60 s. */
export function useCommercialCatalog(): CatalogData {
  const [data, setData] = useState<Omit<CatalogData, 'loading'>>(cache?.data ?? { clients: [], containerTypes: [], materials: [] })
  const [loading, setLoading] = useState(!cache)
  useEffect(() => {
    if (cache && Date.now() - cache.at < 60_000) return
    let cancelled = false
    void Promise.all([
      fetchAllPages<CatalogData['clients'][number]>('/api/clients').catch(() => []),
      apiRequest<{ data: CatalogData['containerTypes'] }>('/api/container-types'),
      apiRequest<{ data: CatalogData['materials'] }>('/api/materials'),
    ]).then(([clients, types, mats]) => {
      const d = { clients, containerTypes: types.ok ? types.data.data : [], materials: mats.ok ? mats.data.data : [] }
      cache = { at: Date.now(), data: d }
      if (!cancelled) { setData(d); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [])
  return { ...data, loading }
}

export function invalidateCommercialCatalog(): void { cache = null }
