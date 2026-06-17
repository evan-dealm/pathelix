import { Metadata }         from 'next'
import { TrackingContent }  from '@/components/tracking/TrackingContent'

export const metadata: Metadata = { title: 'Suivi de livraison — Pathélix' }

async function fetchInitialData(token: string) {
  try {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const res  = await fetch(`${base}/api/tracking?token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token }      = await params
  const initialData    = await fetchInitialData(token)

  return <TrackingContent token={token} initialData={initialData} />
}
